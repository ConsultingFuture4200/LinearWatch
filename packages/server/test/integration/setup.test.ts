import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import authPlugin from '../../src/plugins/auth.js';
import setupRoutes from '../../src/routes/api/v1/setup.js';

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;
type Db = ReturnType<typeof drizzle>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://agentwatch:agentwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/agentwatch_setup');

async function adminReachable(): Promise<boolean> {
  const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
  const admin = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 1500 });
  try {
    await admin.query('SELECT 1');
    await admin.end();
    return true;
  } catch {
    try {
      await admin.end();
    } catch {
      /* noop */
    }
    return false;
  }
}

const dbReachable = await adminReachable();

async function makeApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify();
  // biome-ignore lint/suspicious/noExplicitAny: minimal env decoration for tests
  app.decorate('env', {} as any);
  app.decorate('db', db);
  // biome-ignore lint/suspicious/noExplicitAny: ServerDb type structural
  await app.register(authPlugin, { db: db as any });
  await app.register(setupRoutes);
  return app;
}

describe.skipIf(!dbReachable)('Setup wizard endpoints', () => {
  let pool: PoolInstance;
  let db: Db;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS agentwatch_setup');
    await admin.query('CREATE DATABASE agentwatch_setup');
    await admin.end();

    pool = new Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    // Each test starts from a clean workspaces table so the bootstrap
    // (409-on-second-call) semantics are observable.
    await pool.query('TRUNCATE workspaces CASCADE');
  });

  describe('GET /api/v1/setup/state', () => {
    it('returns has_workspace=false when no workspace exists', async () => {
      const app = await makeApp(db);
      const r = await app.inject({ method: 'GET', url: '/api/v1/setup/state' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ has_workspace: false, has_seed_data: false });
    });

    it('returns has_workspace=true after bootstrap', async () => {
      const app = await makeApp(db);
      await app.inject({
        method: 'POST',
        url: '/api/v1/setup/workspace',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'acme-test' },
      });
      const r = await app.inject({ method: 'GET', url: '/api/v1/setup/state' });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { has_workspace: boolean; workspace_name: string };
      expect(body.has_workspace).toBe(true);
      expect(body.workspace_name).toBe('acme-test');
    });
  });

  describe('POST /api/v1/setup/workspace', () => {
    it('400 on invalid body', async () => {
      const app = await makeApp(db);
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/setup/workspace',
        headers: { 'content-type': 'application/json' },
        payload: { name: '' },
      });
      expect(r.statusCode).toBe(400);
    });

    it('returns plaintext_api_key matching agw_<base64url> + sha256 stored', async () => {
      const app = await makeApp(db);
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/setup/workspace',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'acme' },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { workspace_id: string; plaintext_api_key: string };
      expect(body.plaintext_api_key).toMatch(/^agw_[A-Za-z0-9_-]+$/);
      // Verify hash matches what's persisted.
      const expectedHash = createHash('sha256').update(body.plaintext_api_key).digest('hex');
      const row = await pool.query(
        'SELECT api_key_hash, workspace_salt FROM workspaces WHERE id=$1',
        [body.workspace_id],
      );
      expect(row.rows[0].api_key_hash).toBe(expectedHash);
      // workspace_salt was generated.
      expect(row.rows[0].workspace_salt).toMatch(/^[a-f0-9]{64}$/);
    });

    it('409 on second call (bootstrap-once)', async () => {
      const app = await makeApp(db);
      const r1 = await app.inject({
        method: 'POST',
        url: '/api/v1/setup/workspace',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'first' },
      });
      expect(r1.statusCode).toBe(200);
      const r2 = await app.inject({
        method: 'POST',
        url: '/api/v1/setup/workspace',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'second' },
      });
      expect(r2.statusCode).toBe(409);
    });
  });

  describe('POST /api/v1/setup/linear-oauth/callback', () => {
    it('200 on valid body', async () => {
      const app = await makeApp(db);
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/setup/linear-oauth/callback',
        headers: { 'content-type': 'application/json' },
        payload: { code: 'mock-code', state: 'mock-state' },
      });
      expect(r.statusCode).toBe(200);
      expect((r.json() as { ok: boolean }).ok).toBe(true);
    });

    it('400 when code is missing', async () => {
      const app = await makeApp(db);
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/setup/linear-oauth/callback',
        headers: { 'content-type': 'application/json' },
        payload: { state: 'foo' },
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/setup/github-pat', () => {
    it('401 without bearer', async () => {
      const app = await makeApp(db);
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/setup/github-pat',
        headers: { 'content-type': 'application/json' },
        payload: { pat: 'ghp_xxx' },
      });
      expect(r.statusCode).toBe(401);
    });

    it('200 with bearer + persists PAT base64-encoded', async () => {
      const app = await makeApp(db);
      const ws = await app.inject({
        method: 'POST',
        url: '/api/v1/setup/workspace',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'pat-ws' },
      });
      const wsBody = ws.json() as { plaintext_api_key: string; workspace_id: string };
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/setup/github-pat',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${wsBody.plaintext_api_key}`,
        },
        payload: { pat: 'ghp_TESTTOKEN1234' },
      });
      expect(r.statusCode).toBe(200);
      const row = await pool.query(
        'SELECT github_pat_encoded FROM workspaces WHERE id=$1',
        [wsBody.workspace_id],
      );
      const encoded = row.rows[0].github_pat_encoded as string;
      expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('ghp_TESTTOKEN1234');
    });
  });
});
