import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import rawBody from '../../src/plugins/raw-body';
import { logWebhookReceipt } from '../../src/plugins/request-logger';

interface CapturedLog {
  msg?: string;
  delivery_id?: string | null;
  source?: string;
  event_type?: string | null;
  bytes_received?: number;
  latency_ms?: number;
  payload_keys?: string[];
}

function makeStreamCollector(): { lines: CapturedLog[]; write: (s: string) => void } {
  const lines: CapturedLog[] = [];
  return {
    lines,
    write: (s: string) => {
      try {
        lines.push(JSON.parse(s) as CapturedLog);
      } catch {
        // pino may write non-JSON in error paths; ignore
      }
    },
  };
}

describe('logWebhookReceipt (D-29)', () => {
  it('emits exactly the D-29 whitelist fields at LOG_LEVEL=info', async () => {
    const collector = makeStreamCollector();
    const fastify = Fastify({
      // biome-ignore lint/suspicious/noExplicitAny: pino LoggerOptions stream type is loose
      logger: { level: 'info', stream: { write: collector.write } as any },
    });
    await fastify.register(rawBody);
    fastify.post('/test', async (req, reply) => {
      logWebhookReceipt(req, reply, 'linear');
      return { ok: true };
    });

    const res = await fastify.inject({
      method: 'POST',
      url: '/test',
      headers: { 'content-type': 'application/json', 'linear-delivery': 'd-1' },
      payload: { type: 'AgentSession', issue: { title: 'SECRET-TITLE' } },
    });
    expect(res.statusCode).toBe(200);

    // Allow the reply.raw 'finish' handler to run.
    await new Promise((r) => setImmediate(r));

    const log = collector.lines.find((l) => l.msg === 'webhook_received');
    expect(log).toBeDefined();
    if (!log) return;
    expect(log.delivery_id).toBe('d-1');
    expect(log.source).toBe('linear');
    expect(log.event_type).toBe('AgentSession');
    expect(typeof log.bytes_received).toBe('number');
    expect(typeof log.latency_ms).toBe('number');
    // SECRET-TITLE must not appear anywhere in the line.
    expect(JSON.stringify(log)).not.toContain('SECRET-TITLE');
    // payload_keys is debug-only.
    expect(log.payload_keys).toBeUndefined();
  });

  it('emits payload_keys (top-level only, no values) at LOG_LEVEL=debug', async () => {
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';
    try {
      const collector = makeStreamCollector();
      const fastify = Fastify({
        // biome-ignore lint/suspicious/noExplicitAny: pino LoggerOptions stream type is loose
        logger: { level: 'debug', stream: { write: collector.write } as any },
      });
      await fastify.register(rawBody);
      fastify.post('/test', async (req, reply) => {
        logWebhookReceipt(req, reply, 'linear');
        return { ok: true };
      });

      await fastify.inject({
        method: 'POST',
        url: '/test',
        headers: { 'content-type': 'application/json', 'linear-delivery': 'd-1' },
        payload: { type: 'AgentSession', issue: { title: 'SECRET-TITLE' } },
      });
      await new Promise((r) => setImmediate(r));

      const log = collector.lines.find((l) => l.msg === 'webhook_received');
      expect(log).toBeDefined();
      if (!log) return;
      expect(log.payload_keys).toEqual(expect.arrayContaining(['type', 'issue']));
      // Still no values from the body.
      expect(JSON.stringify(log)).not.toContain('SECRET-TITLE');
    } finally {
      if (prev === undefined) process.env.LOG_LEVEL = undefined;
      else process.env.LOG_LEVEL = prev;
    }
  });
});
