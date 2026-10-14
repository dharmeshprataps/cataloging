import { ApiError, GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { estimateCostUsd } from '../media/validate.js';
import { BRIEF_JSON_SCHEMA, BriefSchema, type Brief } from '../types.js';
import {
  BRIEF_SYSTEM_INSTRUCTION,
  SYSTEM_INSTRUCTION,
  buildBriefPrompt,
  buildGarmentDescriptionPrompt,
} from './prompts.js';
import {
  ImageProviderError,
  type GenerateRequest,
  type GenerateResult,
  type ImageProvider,
  type ImageRef,
} from './types.js';

/**
 * Gemini implementation of the image provider.
 *
 * Uses the `interactions` API (verified against @google/genai 2.29.x), which
 * supports multiple reference images in one request and `previous_interaction_id`
 * for sequential edits — the two capabilities this product depends on.
 */

/** Blocks that the interactions API accepts as input. */
type InputBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mime_type: string; data: string };

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function statusOf(err: unknown): number | undefined {
  if (err instanceof ApiError) return err.status;
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return undefined;
}

/**
 * Detects a content-policy refusal. The API surfaces these as 400s with a
 * safety-related reason, and they must NOT be retried — retrying burns quota
 * and always fails the same way.
 */
function isContentPolicyError(err: unknown): boolean {
  const status = statusOf(err);
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (status === 400 && /safety|policy|prohibited|blocked|recitation/.test(message)) return true;
  return /content_policy|safety_violation|image_was_not_generated/.test(message);
}

function isRetryable(err: unknown): boolean {
  if (isContentPolicyError(err)) return false;
  const status = statusOf(err);
  if (status !== undefined) return RETRYABLE_STATUS.has(status);
  // Network-level failures (DNS, socket reset, timeout) are worth one more try.
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|aborted/i.test(
    err instanceof Error ? err.message : String(err),
  );
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiImageProvider implements ImageProvider {
  readonly name = 'gemini';
  readonly model: string;
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string, model = config.gemini.imageModel) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  /** Exponential backoff with full jitter, capped at config.gemini.maxAttempts. */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= config.gemini.maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (!isRetryable(err) || attempt === config.gemini.maxAttempts) break;
        const backoff =
          config.gemini.baseBackoffMs * 2 ** (attempt - 1) * (0.5 + Math.random());
        logger.warn(
          { err: err instanceof Error ? err.message : err, attempt, backoff: Math.round(backoff) },
          `${label}: retrying after transient failure`,
        );
        await sleep(backoff);
      }
    }
    throw lastError;
  }

  private toRefs(refs: ImageRef[]): InputBlock[] {
    return refs.map((ref) => ({
      type: 'image' as const,
      mime_type: ref.mime,
      data: toBase64(ref.data),
    }));
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const input: InputBlock[] = [
      { type: 'text', text: req.prompt },
      ...this.toRefs(req.refs),
    ];

    const started = Date.now();
    let interaction;
    try {
      interaction = await this.withRetry('image generation', () =>
        this.ai.interactions.create({
          model: this.model,
          input,
          system_instruction: SYSTEM_INSTRUCTION,
          response_format: {
            type: 'image',
            mime_type: 'image/jpeg',
            aspect_ratio: req.aspectRatio,
            image_size: req.imageSize,
          },
          ...(req.previousInteractionId
            ? { previous_interaction_id: req.previousInteractionId }
            : {}),
          store: true,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isContentPolicyError(err)) {
        throw new ImageProviderError(
          `content policy blocked the request: ${message}`,
          'content_policy',
          false,
          statusOf(err),
        );
      }
      throw new ImageProviderError(
        message,
        'provider',
        isRetryable(err),
        statusOf(err),
      );
    }

    const latencyMs = Date.now() - started;

    // Preferred path: the SDK's convenience field.
    let data = (interaction as { output_image?: { data?: string; mime_type?: string } })
      .output_image;
    let base64 = data?.data;
    let mime = data?.mime_type ?? 'image/jpeg';

    // Defensive fallback: walk the step tree. Keeps us working if the SDK
    // stops populating the convenience field.
    if (!base64) {
      const steps = (interaction as { steps?: unknown[] }).steps ?? [];
      for (const step of steps) {
        const content = (step as { content?: unknown[] }).content ?? [];
        for (const block of content) {
          const b = block as { type?: string; data?: string; mime_type?: string };
          if (b.type === 'image' && b.data) {
            base64 = b.data;
            mime = b.mime_type ?? mime;
            break;
          }
        }
        if (base64) break;
      }
    }

    if (!base64) {
      // The model answered with text instead of an image — usually a soft
      // refusal or an over-constrained prompt.
      const text =
        (interaction as { output_text?: string }).output_text?.trim() ||
        'the model returned no image';
      throw new ImageProviderError(
        `no image in response: ${text.slice(0, 300)}`,
        'content_policy',
        false,
      );
    }

    return {
      image: new Uint8Array(Buffer.from(base64, 'base64')),
      mime,
      interactionId: interaction.id,
      latencyMs,
      costUsd: estimateCostUsd(req.imageSize),
    };
  }

  async parseBrief(input: { text: string; hasImages: boolean }): Promise<Brief> {
    let interaction;
    try {
      interaction = await this.withRetry('brief parsing', () =>
        this.ai.interactions.create({
          model: config.gemini.textModel,
          input: buildBriefPrompt(input.text, input.hasImages),
          system_instruction: BRIEF_SYSTEM_INSTRUCTION,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: BRIEF_JSON_SCHEMA,
          },
        }),
      );
    } catch (err) {
      // A brief is a convenience, not a hard dependency: fall back to defaults
      // rather than failing the user's turn.
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        'brief parsing failed, using defaults',
      );
      return BriefSchema.parse({});
    }

    const raw = (interaction as { output_text?: string }).output_text ?? '';
    try {
      const parsed = JSON.parse(raw) as unknown;
      return BriefSchema.parse(parsed);
    } catch (err) {
      logger.warn({ raw: raw.slice(0, 300) }, 'brief JSON did not validate, using defaults');
      return BriefSchema.parse({});
    }
  }

  async describeGarment(refs: ImageRef[]): Promise<string> {
    if (refs.length === 0) return '';
    try {
      const interaction = await this.withRetry('garment description', () =>
        this.ai.interactions.create({
          model: config.gemini.textModel,
          input: [
            { type: 'text', text: buildGarmentDescriptionPrompt() },
            ...this.toRefs(refs),
          ],
        }),
      );
      return ((interaction as { output_text?: string }).output_text ?? '').trim();
    } catch (err) {
      // Enrichment only — never block a generation on this.
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        'garment description failed, continuing without it',
      );
      return '';
    }
  }
}
