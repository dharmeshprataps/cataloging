import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

/**
 * All environment parsing lives here. Anything that can vary between local dev
 * and production is a config value, never a hardcoded constant, so that the
 * only difference between the simulator and real WhatsApp is env.
 */

const ChannelSchema = z.enum(['simulator', 'whatsapp', 'console']);

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-nano-banana-2.1'),
  GEMINI_TEXT_MODEL: z.string().default('gemini-flash-latest'),

  STORAGE_DIR: z.string().default('./data/uploads'),
  DATABASE_PATH: z.string().default('./data/bot.db'),

  MESSAGING_CHANNEL: ChannelSchema.default('simulator'),

  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),

  MESSAGE_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(3000),
  MAX_GENERATIONS_PER_SESSION: z.coerce.number().int().positive().default(15),
  VARIATIONS_COUNT: z.coerce.number().int().positive().max(8).default(4),
});

export type Channel = z.infer<typeof ChannelSchema>;
export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

const env = loadEnv();

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',

  server: {
    port: env.PORT,
    host: env.HOST,
    logLevel: env.LOG_LEVEL,
    publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ''),
  },

  gemini: {
    apiKey: env.GEMINI_API_KEY,
    imageModel: env.GEMINI_IMAGE_MODEL,
    /**
     * Text model used to turn free-form briefs into structured JSON. Kept in
     * config and separately overridable because text and image model
     * generations are on independent release cadences.
     */
    textModel: env.GEMINI_TEXT_MODEL,
    /** Hard ceiling on a single generation call. */
    timeoutMs: 120_000,
    /** Transient-failure retry policy (429 / 5xx / network). */
    maxAttempts: 3,
    baseBackoffMs: 1_500,
  },

  storage: {
    dir: path.resolve(env.STORAGE_DIR),
    databasePath: path.resolve(env.DATABASE_PATH),
    /** Reject uploads larger than this (WhatsApp caps inbound images ~5MB). */
    maxUploadBytes: 8 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  },

  messaging: {
    channel: env.MESSAGING_CHANNEL,
    whatsapp: {
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN,
      appSecret: env.WHATSAPP_APP_SECRET,
      apiVersion: env.WHATSAPP_API_VERSION,
    },
    /** WhatsApp free-form replies are only allowed within 24h of user contact. */
    serviceWindowMs: 24 * 60 * 60 * 1000,
  },

  pipeline: {
    debounceMs: env.MESSAGE_DEBOUNCE_MS,
    maxGenerationsPerSession: env.MAX_GENERATIONS_PER_SESSION,
    variationsCount: env.VARIATIONS_COUNT,
    defaultAspectRatio: '4:5',
    defaultImageSize: '2K',
  },
} as const;

export type AppConfig = typeof config;

/**
 * Fail fast with an actionable message rather than a confusing 401 later.
 * Called by the server at boot when a live Gemini call is possible.
 */
export function assertGeminiConfigured(): void {
  if (!config.gemini.apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Copy .env.example to .env and add your key, ' +
        'or run with MESSAGING_CHANNEL=console and a stub provider for a dry run.',
    );
  }
}

export function assertWhatsAppConfigured(): void {
  const wa = config.messaging.whatsapp;
  const missing = (
    [
      ['WHATSAPP_ACCESS_TOKEN', wa.accessToken],
      ['WHATSAPP_PHONE_NUMBER_ID', wa.phoneNumberId],
      ['WHATSAPP_VERIFY_TOKEN', wa.verifyToken],
      ['WHATSAPP_APP_SECRET', wa.appSecret],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `MESSAGING_CHANNEL=whatsapp requires: ${missing.join(', ')}. ` +
        'See docs/meta-setup.md for how to obtain these.',
    );
  }
}
