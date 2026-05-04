import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/env';

const FULL_ENV = {
  DATABASE_URL: 'postgres://x:y@h:5432/db',
  LINEAR_CLIENT_ID: 'cid',
  LINEAR_CLIENT_SECRET: 'secret',
  LINEAR_WEBHOOK_SECRET: 'whsec',
  LINEARWATCH_INTERNAL_API_KEY: '1234567890123456abcdef',
} as const;

describe('loadEnv', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns parsed env when all required vars present', () => {
    const env = loadEnv({ ...FULL_ENV }, { exitOnError: false });
    expect(env.DATABASE_URL).toBe('postgres://x:y@h:5432/db');
    expect(env.IDENTITY_CONFIDENCE_THRESHOLD).toBe(0.8);
    expect(env.TELEMETRY_OPT_IN).toBe(false);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.PORT).toBe(8080);
  });

  it('throws (or exits) when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...partial } = FULL_ENV;
    void _omit;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => loadEnv(partial as NodeJS.ProcessEnv, { exitOnError: false })).toThrow();
    const stderr = errSpy.mock.calls.flat().join('\n');
    expect(stderr).toMatch(/FATAL: missing env DATABASE_URL/);
  });

  it('prints one FATAL line per missing var', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      loadEnv({}, { exitOnError: false });
    } catch {
      // expected
    }
    const lines = errSpy.mock.calls
      .flat()
      .filter((s): s is string => typeof s === 'string' && s.startsWith('FATAL'));
    // Five required vars: DATABASE_URL, LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET,
    // LINEAR_WEBHOOK_SECRET, LINEARWATCH_INTERNAL_API_KEY
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it('TELEMETRY_OPT_IN defaults to false; "true" is parsed to true', () => {
    const off = loadEnv({ ...FULL_ENV }, { exitOnError: false });
    expect(off.TELEMETRY_OPT_IN).toBe(false);
    const on = loadEnv({ ...FULL_ENV, TELEMETRY_OPT_IN: 'true' }, { exitOnError: false });
    expect(on.TELEMETRY_OPT_IN).toBe(true);
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() => loadEnv({ ...FULL_ENV, LOG_LEVEL: 'verbose' }, { exitOnError: false })).toThrow();
  });

  it('IDENTITY_CONFIDENCE_THRESHOLD coerces strings to numbers', () => {
    const env = loadEnv(
      { ...FULL_ENV, IDENTITY_CONFIDENCE_THRESHOLD: '0.9' },
      { exitOnError: false },
    );
    expect(env.IDENTITY_CONFIDENCE_THRESHOLD).toBe(0.9);
  });
});
