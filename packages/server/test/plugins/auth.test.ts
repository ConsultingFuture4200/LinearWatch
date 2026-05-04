import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { ServerDb } from '../../src/db';
import authPlugin from '../../src/plugins/auth';

const PLAINTEXT_KEY = 'lw_test_plaintext_key';
const STORED_HASH = createHash('sha256').update(PLAINTEXT_KEY).digest('hex');

function makeFakeDb(): ServerDb {
  return {
    execute: vi.fn().mockResolvedValue({ rows: [{ id: 'ws-1', api_key_hash: STORED_HASH }] }),
    // biome-ignore lint/suspicious/noExplicitAny: test double for the Drizzle interface
  } as any;
}

async function makeApp(db: ServerDb = makeFakeDb()): ReturnType<typeof Fastify> {
  const f = Fastify();
  await f.register(authPlugin, { db });
  f.get('/protected', { preHandler: f.authBearer }, async (req) => ({ wid: req.workspaceId }));
  return f;
}

describe('authBearer (API-06)', () => {
  it('401 on missing Authorization header', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/protected' });
    expect(r.statusCode).toBe(401);
  });

  it('401 on malformed Authorization header (no Bearer prefix)', async () => {
    const app = await makeApp();
    const r = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic abc' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('401 on wrong key (constant-time compare)', async () => {
    const app = await makeApp();
    const r = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('401 when no workspace row exists', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test double for the Drizzle interface
    const emptyDb = { execute: vi.fn().mockResolvedValue({ rows: [] }) } as any;
    const app = await makeApp(emptyDb);
    const r = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${PLAINTEXT_KEY}` },
    });
    expect(r.statusCode).toBe(401);
  });

  it('200 on correct key + sets req.workspaceId', async () => {
    const app = await makeApp();
    const r = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${PLAINTEXT_KEY}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).wid).toBe('ws-1');
  });
});
