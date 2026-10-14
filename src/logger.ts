import pino from 'pino';
import { config } from './config.js';

/**
 * pino-pretty is a dev-only convenience; production emits newline-delimited
 * JSON for log aggregation.
 */
export const logger = pino({
  level: config.server.logLevel,
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

export type Logger = typeof logger;
