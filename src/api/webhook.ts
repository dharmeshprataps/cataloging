import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { Repo } from '../db/repo.js';
import type { Pipeline } from '../core/pipeline.js';
import { TurnCoordinator } from '../core/coordinator.js';
import { bodyOf, rawBodyOf } from './body.js';
import { parseWebhook, verifySignature } from '../messaging/whatsapp.js';

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * Two hard requirements, both handled here and nowhere else:
 *  1. GET verification handshake (hub.challenge echo).
 *  2. HMAC-SHA256 signature over the RAW body on every POST.
 *
 * The handler always answers 200 quickly for well-formed payloads. Meta retries
 * anything non-2xx aggressively, so a slow or failing *processing* step must not
 * turn into duplicate deliveries.
 */

export function registerWebhookRoutes(
  app: FastifyInstance,
  repo: Repo,
  pipeline: Pipeline,
): void {
  // Batches bursty inbound events per contact, then hands the whole turn to the
  // pipeline in one call.
  const coordinator = new TurnCoordinator(undefined, async (messages) => {
    try {
      await pipeline.handleBatch(messages);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err },
        'webhook turn failed',
      );
    }
  });

  app.get('/webhook', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    const expected = config.messaging.whatsapp.verifyToken;
    if (!expected) {
      logger.warn('webhook verification attempted but WHATSAPP_VERIFY_TOKEN is unset');
      return reply.status(503).send({ error: 'whatsapp_not_configured' });
    }

    if (mode === 'subscribe' && token === expected && challenge) {
      logger.info('webhook verification succeeded');
      return reply.type('text/plain').send(challenge);
    }

    logger.warn({ mode }, 'webhook verification failed');
    return reply.status(403).send({ error: 'forbidden' });
  });

  app.post('/webhook', async (request, reply) => {
    const secret = config.messaging.whatsapp.appSecret;
    if (!secret) {
      logger.warn('inbound webhook rejected: WHATSAPP_APP_SECRET is unset');
      return reply.status(503).send({ error: 'whatsapp_not_configured' });
    }

    const raw = rawBodyOf(request);
    if (!raw) {
      return reply.status(400).send({ error: 'raw_body_unavailable' });
    }

    const signature = request.headers['x-hub-signature-256'];
    const signatureHeader = Array.isArray(signature) ? signature[0] : signature;

    if (!verifySignature(raw, signatureHeader, secret)) {
      // An unsigned or mis-signed request is either misconfiguration or an
      // attack; both warrant rejection and a loud log.
      logger.warn(
        { ip: request.ip, hasHeader: Boolean(signatureHeader) },
        'rejected webhook with invalid signature',
      );
      return reply.status(401).send({ error: 'invalid_signature' });
    }

    const parsed = bodyOf<Parameters<typeof parseWebhook>[0]>(request);
    const { messages, statuses } = parseWebhook(parsed ?? {});

    for (const status of statuses) {
      try {
        repo.updateMessageStatus(status.externalId, status.status, status.error);
      } catch (err) {
        logger.debug(
          { err: err instanceof Error ? err.message : err },
          'failed to record delivery status',
        );
      }
    }

    // Acknowledge first; process after. Keeps Meta's retry logic quiet.
    reply.status(200).send({ received: true });

    // Batching lives here for the same reason it does in the simulator: a user
    // sending three garment photos fires three separate webhook events, and
    // processing them individually would treat them as three garments.
    for (const message of messages) {
      void coordinator.submit(message).catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? err.message : err },
          'unhandled pipeline failure for inbound webhook message',
        );
      });
    }
  });
}
