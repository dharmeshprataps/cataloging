import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Raw-body capture.
 *
 * WhatsApp signs the exact bytes it sent, so the webhook needs the raw buffer and
 * cannot use Fastify's default JSON parser. We therefore register one custom
 * parser that keeps both the raw bytes and the parsed object.
 *
 * Consequence: every handler on this server receives `{ parsed, raw }` rather
 * than the payload itself. Always read bodies through `bodyOf` so that shape is
 * handled in exactly one place — otherwise routes silently see `undefined` for
 * every field.
 */

export type RawBody<T> = {
  parsed?: T;
  raw?: Buffer;
};

export function registerRawBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      const buffer = body as Buffer;
      if (buffer.length === 0) {
        done(null, { raw: buffer, parsed: {} });
        return;
      }
      try {
        done(null, { parsed: JSON.parse(buffer.toString('utf8')), raw: buffer });
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
}

/** Extracts the parsed payload from the raw-body envelope. */
export function bodyOf<T>(request: FastifyRequest): T {
  const body = request.body as RawBody<T> | undefined;
  return (body?.parsed ?? {}) as T;
}

/** Exposes the exact received bytes, required for signature verification. */
export function rawBodyOf(request: FastifyRequest): Buffer | undefined {
  return (request.body as RawBody<unknown> | undefined)?.raw;
}
