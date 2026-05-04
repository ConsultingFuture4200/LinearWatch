import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * D-29 webhook log line.
 *
 * The whitelist of fields is fixed: `delivery_id`, `source`, `event_type`,
 * `bytes_received`, `latency_ms`. At LOG_LEVEL=debug we add `payload_keys` —
 * the TOP-LEVEL keys of the parsed JSON body. We never log values.
 *
 * Pitfall 5 / 12 mitigation: NEVER log `req.body`, header values, or
 * signatures here. The pino redact paths in `index.ts` are the second line of
 * defense; this function is the first.
 */
export type WebhookSource = 'linear' | 'github' | 'sdk';

export function logWebhookReceipt(
  req: FastifyRequest,
  reply: FastifyReply,
  source: WebhookSource,
): void {
  const start = process.hrtime.bigint();
  reply.raw.on('finish', () => {
    const latencyMs = Number((process.hrtime.bigint() - start) / 1_000_000n);

    const linearDelivery = req.headers['linear-delivery'];
    const githubDelivery = req.headers['x-github-delivery'];
    const deliveryId =
      (typeof linearDelivery === 'string' ? linearDelivery : null) ??
      (typeof githubDelivery === 'string' ? githubDelivery : null);

    const body = req.body as Record<string, unknown> | undefined; // allow-req-body: D-29 top-level keys only
    let eventType: string | null = null;
    if (body && typeof body === 'object') {
      const t = body.type;
      const e = body.event_type;
      if (typeof t === 'string') eventType = t;
      else if (typeof e === 'string') eventType = e;
    }

    const bytes = req.rawBody?.length ?? 0;

    const fields: Record<string, unknown> = {
      delivery_id: deliveryId,
      source,
      event_type: eventType,
      bytes_received: bytes,
      latency_ms: latencyMs,
    };
    if (process.env.LOG_LEVEL === 'debug' && body && typeof body === 'object') {
      // D-29: top-level keys ONLY. Never values.
      fields.payload_keys = Object.keys(body);
    }
    req.log.info(fields, 'webhook_received');
  });
}
