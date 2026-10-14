import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { Repo } from '../db/repo.js';
import type { Pipeline } from '../core/pipeline.js';
import { TurnCoordinator } from '../core/coordinator.js';
import { blobStore } from '../media/store.js';
import { MediaValidationError, inspectImage } from '../media/validate.js';
import { simBus, storeSimulatorUpload, blobUrlFor, type SimEvent } from '../messaging/simulator.js';
import type { InboundMessage } from '../types.js';
import { bodyOf } from './body.js';
import { SIMULATOR_HTML } from './simulator-ui.js';

/**
 * Local development surface.
 *
 * This is not a mock of the pipeline — it drives the *same* Pipeline, the same
 * state machine, and the same image provider as the WhatsApp channel. Only the
 * transport differs, which is what makes "wire up Meta later" a config change
 * rather than an integration project.
 */

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

type SseClient = {
  reply: FastifyReply;
  sessionKey?: string;
};

export function registerSimulatorRoutes(
  app: FastifyInstance,
  repo: Repo,
  pipeline: Pipeline,
): void {
  const enabled = config.messaging.channel === 'simulator';
  const clients = new Set<SseClient>();

  /**
   * The simulator's turn pipeline: batch bursty sends per contact, then run the
   * whole batch as one turn. Identical in shape to the WhatsApp path, so the two
   * channels behave the same way.
   */
  const coordinator = new TurnCoordinator(undefined, async (messages) => {
    try {
      await pipeline.handleBatch(messages);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err },
        'simulator turn failed',
      );
    }
  });

  coordinator.onTurn((turn) => {
    // Announce the user's turn to the UI now that it is assembled.
    for (const message of turn.messages) {
      broadcast({
        sessionKey: turn.contactId,
        direction: 'inbound',
        kind: message.attachments.length > 0 ? 'image' : 'text',
        ...(message.text ? { text: message.text } : {}),
        ...(message.attachments[0]?.externalId
          ? { url: message.attachments[0].externalId }
          : {}),
        at: message.receivedAt.toISOString(),
      });
    }
  });

  function broadcast(event: SimEvent): void {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.sessionKey && client.sessionKey !== event.sessionKey) continue;
      try {
        client.reply.raw.write(`data: ${payload}\n\n`);
      } catch {
        clients.delete(client);
      }
    }
  }

  // Outbound bot messages are published by the simulator delivery adapter.
  simBus.subscribe(broadcast);

  if (!enabled) {
    app.get('/sim', async (_req, reply) =>
      reply
        .status(409)
        .type('text/plain')
        .send(
          `Simulator is disabled because MESSAGING_CHANNEL=${config.messaging.channel}.\n` +
            'Set MESSAGING_CHANNEL=simulator in .env to use the local chat UI.',
        ),
    );
    logger.debug('simulator routes not registered (channel is not "simulator")');
    return;
  }

  app.get('/sim', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(SIMULATOR_HTML),
  );

  app.get('/sim/events', async (request, reply) => {
    const query = request.query as { session?: string };
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 2000\n\n');

    const client: SseClient = query.session ? { reply, sessionKey: query.session } : { reply };
    clients.add(client);

    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(': keep-alive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 25_000);
    keepAlive.unref?.();

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      clients.delete(client);
    });

    // This route owns the socket until the client disconnects.
    return reply;
  });

  /** Serves simulator-uploaded bytes before and after the pipeline adopts them. */
  app.get('/sim/blob/*', async (request, reply) => {
    const key = decodeURIComponent((request.params as Record<string, string>)['*'] ?? '');
    if (!key) return reply.status(400).send({ error: 'missing_key' });
    try {
      const data = await blobStore.get(key);
      return reply
        .header('Content-Type', MIME_BY_EXT[path.extname(key).toLowerCase()] ?? 'image/jpeg')
        .send(Buffer.from(data));
    } catch {
      return reply.status(404).send({ error: 'not_found' });
    }
  });

  app.post('/sim/message', async (request, reply) => {
    const body = bodyOf<{
      contactId?: unknown;
      text?: unknown;
      imageBase64?: unknown;
      filename?: unknown;
    }>(request);
    const contactId = typeof body?.contactId === 'string' ? body.contactId.trim() : '';
    if (!contactId) {
      return reply.status(400).send({ error: 'contactId_required' });
    }
    const contactKey = `sim:${contactId}`;
    const text = typeof body?.text === 'string' && body.text.trim() ? body.text : undefined;

    const attachments: InboundMessage['attachments'] = [];

    if (typeof body?.imageBase64 === 'string' && body.imageBase64.length > 0) {
      // Tolerate a data: URL prefix from the browser's FileReader.
      const base64 = body.imageBase64.replace(/^data:[^;]+;base64,/, '');
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length === 0) {
        return reply.status(400).send({ error: 'empty_image' });
      }

      // Validate before storing so the UI gets an immediate, specific error
      // rather than a silence followed by a confusing bot message.
      let ext: string;
      try {
        ext = inspectImage(new Uint8Array(bytes)).ext;
      } catch (err) {
        const message =
          err instanceof MediaValidationError
            ? err.userMessage
            : 'That file could not be read as an image.';
        return reply.status(400).send({ error: 'invalid_image', message });
      }

      const key = await storeSimulatorUpload(new Uint8Array(bytes), ext);
      attachments.push({ externalId: blobUrlFor(key) });
    }

    if (attachments.length === 0 && !text) {
      return reply.status(400).send({ error: 'nothing_to_send' });
    }

    const message: InboundMessage = {
      externalContactId: contactKey,
      displayName: 'Simulator user',
      externalMessageId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      receivedAt: new Date(),
      attachments,
      ...(text ? { text } : {}),
    };

    // Single path: the coordinator batches, renders the user's turn, and then
    // runs the pipeline. Deliberately not awaited — the UI tracks progress on
    // the SSE stream and generation takes tens of seconds.
    void coordinator.submit(message);

    return reply.send({ queued: true, contactKey });
  });

  logger.info('simulator UI available at /sim');
}
