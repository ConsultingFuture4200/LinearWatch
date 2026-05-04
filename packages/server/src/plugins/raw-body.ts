import fp from 'fastify-plugin';

/**
 * Raw-body plugin (RESEARCH Pattern 1).
 *
 * Fastify 5's `addContentTypeParser` with `parseAs: 'buffer'` exposes the raw
 * request bytes on `req.rawBody` while still parsing JSON for downstream
 * handlers. Wave-2's webhook receiver (Plan 01.05) consumes `req.rawBody` to
 * verify Linear's HMAC-SHA256 signature against the EXACT bytes Linear hashed —
 * any whitespace/encoding round-trip through `JSON.parse(JSON.stringify(...))`
 * would break HMAC verification.
 */
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export default fp(async (fastify) => {
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      req.rawBody = body as Buffer;
      const text = (body as Buffer).toString('utf8');
      done(null, text.length === 0 ? {} : JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
});
