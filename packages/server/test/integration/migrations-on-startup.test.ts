import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Integration test for the [BLOCKING] migrate-on-startup gate (D-05).
 *
 * Verifies:
 *   1. Server starts cleanly against a fresh DB, applies migrations, and
 *      exposes /health=200 + /metrics text/plain.
 *   2. Server exits non-zero when migrations fail (bad DATABASE_URL).
 *
 * Self-skips when:
 *   - DATABASE_URL_TEST is not set or its admin DB is unreachable.
 *
 * Spawn strategy:
 *   - In CI (CI=true) and when `dist/index.js` exists, spawn the prebuilt
 *     `node dist/index.js` — the same path Docker production uses.
 *   - Otherwise, spawn `tsx src/index.ts` so contributors can run the gate
 *     locally without first building every workspace package. The migration
 *     ordering is identical regardless of how main() is loaded; this gate
 *     verifies the ordering, not the bundling.
 *   - End-to-end Docker boot is covered by `scripts/smoke-compose.sh`.
 */
const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://agentwatch:agentwatch_dev_password@localhost:5432/agentwatch_startup';

const DIST_PATH = resolve(__dirname, '..', '..', 'dist', 'index.js');
const SRC_PATH = resolve(__dirname, '..', '..', 'src', 'index.ts');
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const TSX_BIN = resolve(REPO_ROOT, 'node_modules', '.bin', 'tsx');

const useDist = !!process.env.CI && existsSync(DIST_PATH);
const SPAWN_CMD = useDist ? 'node' : TSX_BIN;
const SPAWN_ARGS = useDist ? [DIST_PATH] : [SRC_PATH];

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
      // ignore
    }
    return false;
  }
}

// Synchronous module-level probe so vitest's collection-time `skipIf` sees a
// stable boolean before any test body runs.
const canReachAdmin = await adminReachable();

describe.skipIf(!canReachAdmin)('migrations run at startup before listen [BLOCKING]', () => {
  let proc: ChildProcess | null = null;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS agentwatch_startup');
    await admin.query('CREATE DATABASE agentwatch_startup');
    await admin.end();
  }, 30_000);

  afterAll(() => {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  });

  it('starts cleanly, applies schema, exposes /health=200 and /metrics text/plain', async () => {
    proc = spawn(SPAWN_CMD, SPAWN_ARGS, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: TEST_DB_URL,
        LINEAR_CLIENT_ID: 'cid',
        LINEAR_CLIENT_SECRET: 'sec',
        LINEAR_WEBHOOK_SECRET: 'whs',
        AGENTWATCH_INTERNAL_API_KEY: 'integration-test-key-12345',
        PORT: '8090',
        LOG_LEVEL: 'info',
      },
      stdio: 'pipe',
    });

    proc.stderr?.on('data', (b: Buffer) => {
      if (process.env.DEBUG_INTEGRATION === '1') {
        process.stderr.write(`[server stderr] ${b.toString()}`);
      }
    });

    const start = Date.now();
    let ready = false;
    while (Date.now() - start < 30_000) {
      try {
        const r = await fetch('http://127.0.0.1:8090/health');
        if (r.ok) {
          const body = (await r.json()) as { status: string };
          expect(body.status).toBe('ok');
          const m = await fetch('http://127.0.0.1:8090/metrics');
          expect(m.headers.get('content-type')).toMatch(/text\/plain/);
          const text = await m.text();
          expect(text).toContain('agentwatch_events_received_total');
          expect(text).toContain('agentwatch_webhook_ack_seconds');
          expect(text).toContain('agentwatch_jobs_queue_depth');
          expect(text).toContain('agentwatch_identity_resolver_confidence');
          expect(text).toContain('agentwatch_enrichment_lag_seconds');
          ready = true;
          break;
        }
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!ready) {
      throw new Error('server did not become ready within 30s');
    }
  }, 60_000);

  it('exits non-zero when migration fails (bad DATABASE_URL)', async () => {
    const bad = spawn(SPAWN_CMD, SPAWN_ARGS, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://nope:nope@127.0.0.1:1/nope',
        LINEAR_CLIENT_ID: 'cid',
        LINEAR_CLIENT_SECRET: 'sec',
        LINEAR_WEBHOOK_SECRET: 'whs',
        AGENTWATCH_INTERNAL_API_KEY: 'integration-test-key-12345',
        PORT: '8091',
        LOG_LEVEL: 'info',
      },
      stdio: 'pipe',
    });
    const code = await new Promise<number>((res) => {
      bad.on('exit', (c) => res(c ?? -1));
    });
    expect(code).not.toBe(0);
  }, 30_000);
});
