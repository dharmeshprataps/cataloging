import Fastify, {
  type FastifyInstance,
  type FastifyError,
  type FastifyBaseLogger,
} from 'fastify';
import { config, assertWhatsAppConfigured } from './config.js';
import { getDb } from './db/migrate.js';
import { Repo } from './db/repo.js';
import { logger } from './logger.js';
import { Pipeline } from './core/pipeline.js';
import { getDeliveryAdapter, getImageProvider } from './providers.js';
import { registerRawBodyParser } from './api/body.js';
import { registerWebhookRoutes } from './api/webhook.js';
import { registerSimulatorRoutes } from './api/simulator.js';
import { registerMediaRoutes } from './api/media.js';

export type AppContext = {
  repo: Repo;
  pipeline: Pipeline;
  app: FastifyInstance;
};

/**
 * Builds the Fastify app. Exported separately from `start()` so integration
 * tests can drive the real HTTP surface without binding a port.
 */
export async function buildApp(options?: {
  repo?: Repo;
  /** Skip channel credential validation (used by tests). */
  skipChannelValidation?: boolean;
}): Promise<AppContext> {
  const repo = options?.repo ?? new Repo(getDb());

  if (!options?.skipChannelValidation && config.messaging.channel === 'whatsapp') {
    assertWhatsAppConfigured();
  }

  const app = Fastify({
    // pino's Logger satisfies FastifyBaseLogger structurally except for the
    // child() return type, which is intentionally narrower here.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    // Meta payloads include user text; keep them bounded but generous.
    bodyLimit: 12 * 1024 * 1024,
  });

  // Must be registered before routes: the webhook needs the raw bytes to verify
  // WhatsApp's HMAC signature, while other routes read `bodyOf(request)`.
  registerRawBodyParser(app);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error.message, stack: error.stack }, 'request failed');
    } else {
      request.log.warn({ err: error.message }, 'request rejected');
    }
    // Never leak internals to the channel.
    reply.status(status).send({
      error: status >= 500 ? 'internal_error' : 'bad_request',
      message: status >= 500 ? 'Something went wrong.' : error.message,
    });
  });

  const adapter = await getDeliveryAdapter();
  const pipeline = new Pipeline({ repo, adapter, provider: getImageProvider() });

  app.get('/healthz', async () => {
    // Touch the DB so a broken volume surfaces as unhealthy, not as a 500 later.
    repo.ensureDefaultOrg();
    return {
      status: 'ok',
      channel: config.messaging.channel,
      model: getImageProvider().model,
      providerConfigured: Boolean(config.gemini.apiKey),
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  registerMediaRoutes(app, repo);
  registerSimulatorRoutes(app, repo, pipeline);
  registerWebhookRoutes(app, repo, pipeline);

  logger.info(
    {
      channel: adapter.name,
      model: getImageProvider().model,
      providerConfigured: Boolean(config.gemini.apiKey),
    },
    'app built',
  );

  return { repo, pipeline, app };
}

export async function start(): Promise<void> {
  const { app } = await buildApp();

  if (!config.gemini.apiKey) {
    logger.warn(
      'GEMINI_API_KEY is not set — the bot will run but cannot generate images. ' +
        'Add it to .env, or use the simulator UI to test the conversation flow.',
    );
  }
  if (config.messaging.channel === 'simulator') {
    logger.info(
      `Local simulator ready: ${config.server.publicBaseUrl}  (no WhatsApp account needed)`,
    );
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.server.port, host: config.server.host });
}

/** Auto-start when run directly (`tsx src/server.ts` / `node dist/server.js`). */
const entry = process.argv[1];
if (entry && (await import('node:url')).fileURLToPath(import.meta.url) === (await import('node:path')).resolve(entry)) {
  await start();
}
