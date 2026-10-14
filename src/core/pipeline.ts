import { config } from '../config.js';
import type { AssetRow, Repo, SessionRow } from '../db/repo.js';
import { logger } from '../logger.js';
import { loadRefs, persistGeneratedAsset, persistInboundAsset } from './ingest.js';
import { COPY, briefToLines } from './copy.js';
import { buildImagePrompt, variationNoteFor } from '../imaging/prompts.js';
import { ImageProviderError, type ImageProvider } from '../imaging/types.js';
import { MediaValidationError } from '../media/validate.js';
import type { DeliveryAdapter } from '../messaging/types.js';
import {
  BriefSchema,
  isPleasantry,
  parseReviewCommand,
  type Brief,
  type InboundMessage,
  type ReviewCommand,
} from '../types.js';

/**
 * Orchestrates a conversation turn.
 *
 * Design notes:
 * - The delivery adapter is the only channel dependency, so this class is
 *   identical under the simulator and real WhatsApp.
 * - Generation is the slow, expensive step, so the user is always acknowledged
 *   before it starts, and the state machine never leaves the session in a state
 *   that a restart would corrupt.
 * - Revisions prefer chained edits (`previous_interaction_id`) over fresh
 *   generation, because regenerating is what causes garment print/silhouette
 *   drift — the main quality risk in this product.
 */

/** Serialises turns per session so concurrent webhooks cannot interleave state. */
class KeyedLock {
  private readonly chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.chains.get(key) ?? Promise.resolve();
    // Swallow the prior result so one failure does not reject the next turn.
    const next = prior.then(fn, fn);
    this.chains.set(
      key,
      next.catch(() => undefined),
    );
    void next.finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
    return next;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ImageProviderError(`${label} timed out after ${ms}ms`, 'provider', true)),
      ms,
    );
    timer.unref?.();
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const SKU_PATTERN = /\bsku[:\s#]*([A-Za-z0-9._-]{1,40})\b/i;
const GO_PATTERN = /^(go|yes|y|ok|okay|generate|do it|confirm)\b/i;

export type PipelineDeps = {
  repo: Repo;
  adapter: DeliveryAdapter;
  provider: ImageProvider;
  /** Overridable for tests; defaults to the configured image model. */
  model?: string;
};

export class Pipeline {
  private readonly repo: Repo;
  private readonly adapter: DeliveryAdapter;
  private readonly provider: ImageProvider;
  private readonly lock = new KeyedLock();

  constructor(deps: PipelineDeps) {
    this.repo = deps.repo;
    this.adapter = deps.adapter;
    this.provider = deps.provider;
  }

  /** Entry point for every inbound channel message. */
  /** Entry point for a single inbound channel message. */
  async handleInbound(message: InboundMessage): Promise<void> {
    return this.handleBatch([message]);
  }

  /**
   * Entry point for one assembled turn.
   *
   * Batching matters for correctness on WhatsApp: three photos arrive as three
   * separate webhook events, and if each were processed as its own turn the bot
   * would treat them as three garments.
   *
   * Idempotency is applied to the whole batch *before* any processing, so a
   * partial re-delivery cannot replay the messages that already succeeded.
   */
  async handleBatch(messages: InboundMessage[]): Promise<void> {
    if (messages.length === 0) return;

    const first = messages[0]!;
    const org = this.repo.ensureDefaultOrg();
    const contact = this.repo.ensureContact(
      org.id,
      first.externalContactId,
      first.displayName,
    );

    await this.lock.run(contact.id, async () => {
      try {
        let session = this.repo.ensureActiveSession(contact.id);

        const fresh: InboundMessage[] = [];
        for (const message of messages) {
          // The channel message id is what makes this gate effective: Meta
          // retries aggressively, and a retried turn would otherwise spend a
          // second generation on the same photo.
          const recorded = this.repo.recordInboundMessage({
            sessionId: session.id,
            kind: message.attachments.length > 0 ? 'image' : 'text',
            body: message.text ?? null,
            externalId: message.externalMessageId,
          });
          if (recorded) fresh.push(message);
          else
            logger.info(
              { externalId: message.externalMessageId },
              'duplicate inbound delivery ignored',
            );
        }

        for (const message of fresh) {
          const latest = this.repo.getSession(session.id) ?? session;
          session = await this.processOne(
            latest,
            message,
            message === fresh[fresh.length - 1],
          );
        }
      } catch (err) {
        logger.error(
          {
            err: err instanceof Error ? err.message : err,
            stack: err instanceof Error ? err.stack : undefined,
            contactId: contact.id,
          },
          'turn failed',
        );
        // Never leave the user with silence; a failed turn must still reply.
        try {
          await this.reply(
            await this.currentSessionId(contact.id),
            first.externalContactId,
            COPY.error,
          );
        } catch (replyErr) {
          logger.error(
            { err: replyErr instanceof Error ? replyErr.message : replyErr },
            'failed to send error reply',
          );
        }
      }
    });
  }

  private async currentSessionId(contactId: string): Promise<string> {
    const existing = this.repo.getActiveSession(contactId);
    if (existing) return existing.id;
    return this.repo.ensureActiveSession(contactId).id;
  }

  /**
   * Handles one message inside a turn.
   *
   * Text is only acted on for the *last* message of a batch. Otherwise a photo
   * batch with a trailing caption would be consumed mid-batch, before the
   * remaining photos had been attached to the item.
   */
  private async processOne(
    session: SessionRow,
    message: InboundMessage,
    isLastInBatch: boolean,
  ): Promise<SessionRow> {
    this.repo.updateSession(session.id, {
      last_inbound_at: message.receivedAt.toISOString(),
    });
    let current = this.repo.getSession(session.id)!;

    if (message.attachments.length > 0) {
      current = await this.handleAttachments(current, message);
    }

    const text = message.text?.trim() ?? '';
    if (text && isLastInBatch) {
      await this.handleText(current, message.externalContactId, text);
      current = this.repo.getSession(session.id) ?? current;
    }
    return current;
  }

  private async reply(sessionId: string, to: string, text: string): Promise<void> {
    const sent = await this.adapter.sendText(to, text);
    this.repo.insertMessage({
      sessionId,
      direction: 'outbound',
      kind: 'text',
      body: text,
      externalId: sent.externalId ?? null,
      status: 'sent',
    });
  }

  private async sendImage(
    sessionId: string,
    to: string,
    asset: AssetRow,
    caption?: string,
  ): Promise<void> {
    const data = await loadRefs([asset]);
    const first = data[0];
    if (!first) throw new Error(`asset ${asset.id} bytes unavailable`);
    // WhatsApp treats an empty caption as absent; undefined keeps it clean.
    const sent = await this.adapter.sendImage(
      to,
      { id: asset.id, mime: asset.mime, data: first.data },
      caption,
    );
    this.repo.insertMessage({
      sessionId,
      direction: 'outbound',
      kind: 'image',
      body: caption ?? null,
      assetId: asset.id,
      externalId: sent.externalId ?? null,
      status: 'sent',
    });
  }

  /** ---------------------------------------------------------------- images */

  private async handleAttachments(
    session: SessionRow,
    message: InboundMessage,
  ): Promise<SessionRow> {
    const to = message.externalContactId;
    const stored: AssetRow[] = [];

    for (const attachment of message.attachments) {
      try {
        const asset = await persistInboundAsset(
          this.repo,
          this.adapter,
          attachment,
          this.adapter.name,
        );
        stored.push(asset);
        this.repo.insertMessage({
          sessionId: session.id,
          direction: 'inbound',
          kind: 'image',
          assetId: asset.id,
          externalId: null,
          status: 'received',
        });
      } catch (err) {
        if (err instanceof MediaValidationError) {
          await this.reply(session.id, to, err.userMessage);
        } else {
          logger.error(
            { err: err instanceof Error ? err.message : err },
            'failed to persist inbound attachment',
          );
          await this.reply(
            session.id,
            to,
            'I had trouble downloading that photo. Please try sending it again.',
          );
        }
      }
    }

    if (stored.length === 0) return session;

    // New garment photos during an active review mean a new item: banking the
    // current one is better than silently mixing garments in one prompt.
    if (session.stage === 'review') {
      session = await this.startNewItem(session);
      await this.reply(session.id, to, 'Starting a new item. ✅');
    }

    const existingRefs = this.parseRefs(session);
    const merged = [...existingRefs.map((id) => ({ id })), ...stored.map((a) => ({ id: a.id }))];

    // Cap references: more than a handful dilutes garment fidelity and costs tokens.
    const capped = merged.slice(-4);
    this.repo.updateSession(session.id, {
      refs_json: JSON.stringify(capped.map((c) => c.id)),
    });
    session = this.repo.getSession(session.id)!;

    if (session.stage === 'idle') {
      this.repo.setStage(session.id, 'collecting_brief');
      session = this.repo.getSession(session.id)!;
      await this.reply(session.id, to, COPY.gotImagesNoBrief(stored.length));
    } else if (session.stage === 'confirm_brief') {
      await this.reply(session.id, to, COPY.gotAdditionalImages(stored.length));
    }

    return session;
  }

  /** Terminates the current session and opens a fresh one for a new SKU. */
  private async startNewItem(session: SessionRow): Promise<SessionRow> {
    this.repo.setStage(session.id, 'cancelled');
    return this.repo.ensureActiveSession(session.contact_id);
  }

  private parseRefs(session: SessionRow): string[] {
    if (!session.refs_json) return [];
    try {
      const parsed = JSON.parse(session.refs_json) as unknown;
      return Array.isArray(parsed) ? (parsed.filter((v) => typeof v === 'string') as string[]) : [];
    } catch {
      return [];
    }
  }

  private refAssets(session: SessionRow): AssetRow[] {
    return this.parseRefs(session)
      .map((id) => this.repo.getAsset(id))
      .filter((a): a is AssetRow => a !== undefined);
  }

  /** ---------------------------------------------------------------- text */

  private async handleText(session: SessionRow, to: string, text: string): Promise<void> {
    const lower = text.toLowerCase();

    if (/^(help|how|guide|\?)/.test(lower)) {
      await this.reply(session.id, to, COPY.help);
      return;
    }

    // An explicit reset works from any stage — a user who has changed their mind
    // mid-flow should never have to finish the old item to start a new one.
    if (/^(start over|new item|reset)\b/.test(lower)) {
      const fresh = await this.startNewItem(session);
      await this.reply(fresh.id, to, COPY.greeting);
      return;
    }

    if (/^(hi|hello|hey|start|new)\b/.test(lower) && session.stage === 'idle') {
      await this.reply(session.id, to, COPY.greeting);
      return;
    }

    // Review-stage commands take priority over free text.
    if (session.stage === 'review') {
      // Pleasantries must not be mistaken for revision feedback, which would
      // silently spend a generation on nothing.
      if (isPleasantry(text)) {
        await this.reply(session.id, to, COPY.youreWelcome);
        return;
      }
      const command = parseReviewCommand(text);
      if (command) {
        await this.runReviewCommand(session, to, command, text);
        return;
      }
      // Unrecognised text in review is treated as revision feedback — the most
      // likely intent, and the cheapest to undo.
      await this.revise(session, to, text);
      return;
    }

    if (session.stage === 'generating') {
      await this.reply(session.id, to, COPY.busyGenerating);
      return;
    }

    // Confirm-stage: "go" proceeds, anything else refines the brief.
    if (session.stage === 'confirm_brief') {
      if (GO_PATTERN.test(text)) {
        await this.shootFirst(session, to);
        return;
      }
      await this.collectBrief(session, to, text, { append: true });
      return;
    }

    if (session.stage === 'idle' || session.stage === 'collecting_images') {
      await this.reply(session.id, to, COPY.needImages);
      return;
    }

    if (session.stage === 'collecting_brief') {
      await this.collectBrief(session, to, text, { append: false });
      return;
    }

    await this.reply(session.id, to, COPY.unrecognised);
  }

  private async captureSku(session: SessionRow, text: string): Promise<SessionRow> {
    const match = SKU_PATTERN.exec(text);
    if (!match?.[1]) return session;

    const sku = match[1].toUpperCase();
    let productId = session.product_id;
    if (!productId) {
      const orgId =
        this.repo.getContactById(session.contact_id)?.org_id ??
        this.repo.ensureDefaultOrg().id;
      const product = this.repo.createProduct({ orgId, sku });
      productId = product.id;
      this.repo.updateSession(session.id, { product_id: productId });
    } else {
      this.repo.updateProduct(productId, { sku });
    }
    return this.repo.getSession(session.id)!;
  }

  private async collectBrief(
    session: SessionRow,
    to: string,
    text: string,
    opts: { append: boolean },
  ): Promise<void> {
    session = await this.captureSku(session, text);

    const accumulated = opts.append && session.pending_brief_text
      ? `${session.pending_brief_text}\nAdditional correction: ${text}`
      : text;

    const refs = this.refAssets(session);
    let brief: Brief;
    try {
      brief = await this.provider.parseBrief({
        text: accumulated,
        hasImages: refs.length > 0,
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        'brief parsing failed; falling back to defaults',
      );
      brief = BriefSchema.parse({});
    }

    this.repo.updateSession(session.id, {
      brief_json: JSON.stringify(brief),
      pending_brief_text: accumulated,
      stage: 'confirm_brief',
    });

    const updated = this.repo.getSession(session.id)!;
    await this.reply(updated.id, to, COPY.confirmBrief(briefToLines(brief)));
  }

  /** -------------------------------------------------------------- generate */

  private remainingGenerations(session: SessionRow): number {
    return config.pipeline.maxGenerationsPerSession - session.generation_count;
  }

  private async ensureProduct(session: SessionRow): Promise<string> {
    if (session.product_id) return session.product_id;
    // Fall back to the default org rather than an empty string: org_id is a
    // foreign key, and '' would violate it.
    const orgId =
      this.repo.getContactById(session.contact_id)?.org_id ?? this.repo.ensureDefaultOrg().id;
    const product = this.repo.createProduct({
      orgId,
      title: this.briefOf(session).garment,
    });
    this.repo.updateSession(session.id, { product_id: product.id });
    return product.id;
  }

  private briefOf(session: SessionRow): Brief {
    if (!session.brief_json) return BriefSchema.parse({});
    try {
      return BriefSchema.parse(JSON.parse(session.brief_json));
    } catch {
      return BriefSchema.parse({});
    }
  }

  private async generate(
    session: SessionRow,
    to: string,
    options: { revisionNote?: string; variationNote?: string; variationIndex?: number; silent?: boolean },
  ): Promise<AssetRow[]> {
    if (this.remainingGenerations(session) <= 0) {
      await this.reply(session.id, to, COPY.generationCap(config.pipeline.maxGenerationsPerSession));
      return [];
    }

    const refs = this.refAssets(session);
    if (refs.length === 0) {
      await this.reply(session.id, to, COPY.needImages);
      return [];
    }

    const brief = this.briefOf(session);
    const productId = await this.ensureProduct(session);

    // For a revision, the previous output becomes a reference so the model
    // edits rather than re-rolls.
    const previousOutput = session.last_output_asset_id
      ? this.repo.getAsset(session.last_output_asset_id)
      : undefined;
    const isRevision = Boolean(options.revisionNote) && previousOutput !== undefined;

    const prompt = buildImagePrompt({
      brief,
      garmentDescription: brief.garment,
      ...(options.revisionNote ? { revisionNote: options.revisionNote } : {}),
      ...(options.variationNote && !isRevision ? { variationNote: options.variationNote } : {}),
    });

    const inputAssets = isRevision ? [...refs, previousOutput!] : refs;

    const generation = this.repo.createGeneration({
      sessionId: session.id,
      productId,
      provider: this.provider.name,
      model: this.provider.model,
      prompt,
      prevInteractionId: isRevision ? session.last_interaction_id : null,
      status: 'pending',
      aspectRatio: brief.aspectRatio,
      imageSize: brief.imageSize,
    });

    for (const asset of inputAssets) {
      this.repo.linkGenerationAsset(generation.id, asset.id, 'input');
    }

    this.repo.incrementGenerationCount(session.id);
    this.repo.setStage(session.id, 'generating');

    if (!options.silent) {
      await this.reply(session.id, to, COPY.generating(1));
    }

    try {
      const imageRefs = await loadRefs(inputAssets);
      const result = await withTimeout(
        this.provider.generate({
          prompt,
          refs: imageRefs,
          aspectRatio: brief.aspectRatio,
          imageSize: brief.imageSize,
          ...(isRevision && session.last_interaction_id
            ? { previousInteractionId: session.last_interaction_id }
            : {}),
        }),
        config.gemini.timeoutMs,
        'image generation',
      );

      const asset = await persistGeneratedAsset(this.repo, result.image, result.mime);
      this.repo.completeGeneration(generation.id, {
        status: 'succeeded',
        interactionId: result.interactionId,
        latencyMs: result.latencyMs,
        costUsd: result.costUsd,
      });
      this.repo.linkGenerationAsset(generation.id, asset.id, 'output');
      this.repo.linkProductAsset(productId, asset.id, 'alternate');

      const latest = this.repo.getSession(session.id)!;
      this.repo.updateSession(session.id, {
        last_interaction_id: result.interactionId,
        last_output_asset_id: asset.id,
        stage: 'review',
        attempt_count: 0,
      });

      logger.info(
        {
          sessionId: session.id,
          generationId: generation.id,
          latencyMs: result.latencyMs,
          costUsd: result.costUsd,
          remaining: this.remainingGenerations(latest),
        },
        'generation succeeded',
      );

      return [asset];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const policy = err instanceof ImageProviderError && err.kind === 'content_policy';

      this.repo.completeGeneration(generation.id, {
        status: 'failed',
        error: message,
      });
      this.repo.updateSession(session.id, {
        // Return to a recoverable stage so the user can retry or re-brief.
        stage: previousOutput ? 'review' : 'confirm_brief',
        attempt_count: session.attempt_count + 1,
      });

      logger.error(
        { sessionId: session.id, generationId: generation.id, policy, err: message },
        'generation failed',
      );

      await this.reply(
        session.id,
        to,
        policy ? COPY.contentPolicy : COPY.regenerateFailed,
      );
      return [];
    }
  }

  /** ------------------------------------------------------- review commands */

  private async runReviewCommand(
    session: SessionRow,
    to: string,
    command: ReviewCommand,
    rawText: string,
  ): Promise<void> {
    switch (command) {
      case 'approve':
        await this.approve(session, to);
        return;
      case 'revise': {
        // "2, make the light warmer" — strip the leading digit and use the rest
        // as the revision instruction. Bare "2" re-generates with the same brief.
        const note = rawText.replace(/^\s*[2✎✏️]*[\s.,:-]*/, '').trim();
        await this.revise(session, to, note || 'a slightly different pose and framing');
        return;
      }
      case 'regenerate':
        // Same brief, fresh roll — no chaining, so the model re-composes.
        await this.regenerate(session, to);
        return;
      case 'variations':
        await this.variations(session, to);
        return;
      case 'details':
        await this.reply(session.id, to, COPY.confirmBrief(briefToLines(this.briefOf(session))));
        return;
      case 'cancel':
        this.repo.setStage(session.id, 'cancelled');
        await this.reply(session.id, to, COPY.cancelled);
        return;
    }
  }

  private async revise(session: SessionRow, to: string, note: string): Promise<void> {
    const outputs = await this.generate(session, to, { revisionNote: note });
    const first = outputs[0];
    if (!first) return;

    const fresh = this.repo.getSession(session.id)!;
    await this.sendImage(session.id, to, first, 'Revised ✏️');
    await this.reply(session.id, to, COPY.reviewPrompt(this.remainingGenerations(fresh)));
  }

  /** First shot of a new item: generate, deliver, then open the review loop. */
  private async shootFirst(session: SessionRow, to: string): Promise<void> {
    const outputs = await this.generate(session, to, {});
    const first = outputs[0];
    if (!first) return;

    const fresh = this.repo.getSession(session.id)!;
    await this.sendImage(session.id, to, first, 'Here it is 👍');
    await this.reply(session.id, to, COPY.reviewPrompt(this.remainingGenerations(fresh)));
  }

  /**
   * A fresh roll of the same brief. Deliberately does not chain and does not
   * carry the previous output as a reference, so the composition can change
   * rather than only the pixels the user complained about.
   */
  private async regenerate(session: SessionRow, to: string): Promise<void> {
    // Clear the chain so this is a clean re-shoot.
    this.repo.updateSession(session.id, { last_interaction_id: null });
    const reloaded = this.repo.getSession(session.id)!;
    const outputs = await this.generate(reloaded, to, {});
    const first = outputs[0];
    if (!first) return;

    const fresh = this.repo.getSession(session.id)!;
    await this.sendImage(session.id, to, first, 'Here you go 🎲');
    await this.reply(session.id, to, COPY.reviewPrompt(this.remainingGenerations(fresh)));
  }

  private async variations(session: SessionRow, to: string): Promise<void> {
    const count = config.pipeline.variationsCount;
    const available = this.remainingGenerations(session);
    const n = Math.min(count, available);
    if (n <= 0) {
      await this.reply(session.id, to, COPY.generationCap(config.pipeline.maxGenerationsPerSession));
      return;
    }

    await this.reply(session.id, to, COPY.generating(n));

    // Sequential rather than parallel: each call mutates session state
    // (last_output_asset_id / last_interaction_id), and a chatty burst of
    // concurrent calls against one session is exactly what causes drift.
    const produced: AssetRow[] = [];
    for (let i = 0; i < n; i += 1) {
      const fresh = this.repo.getSession(session.id)!;
      const outputs = await this.generate(fresh, to, {
        variationNote: variationNoteFor(i),
        variationIndex: i,
        silent: true,
      });
      if (outputs[0]) produced.push(outputs[0]);
    }

    if (produced.length === 0) return;

    for (const [index, asset] of produced.entries()) {
      await this.sendImage(
        session.id,
        to,
        asset,
        index === 0 ? `Variation ${index + 1} of ${produced.length}` : `Variation ${index + 1}`,
      );
    }

    const fresh = this.repo.getSession(session.id)!;
    await this.reply(session.id, to, COPY.reviewPrompt(this.remainingGenerations(fresh)));
  }

  private async approve(session: SessionRow, to: string): Promise<void> {
    const heroAssetId = session.last_output_asset_id;
    if (!heroAssetId) {
      await this.reply(session.id, to, COPY.noOutputYet);
      return;
    }
    const productId = await this.ensureProduct(session);
    const brief = this.briefOf(session);

    this.repo.updateProduct(productId, {
      title: brief.garment,
      description: [
        `Model: ${brief.model}`,
        `Pose: ${brief.pose}`,
        `Setting: ${brief.setting}`,
        `Lighting: ${brief.lighting}`,
        `Mood: ${brief.mood}`,
      ].join('\n'),
    });
    this.repo.linkProductAsset(productId, heroAssetId, 'hero', 0);
    this.repo.setStage(session.id, 'approved');

    const product = this.repo.getProduct(productId);
    await this.reply(
      session.id,
      to,
      COPY.approved(product?.sku ?? null, product?.title ?? brief.garment),
    );
  }
}
