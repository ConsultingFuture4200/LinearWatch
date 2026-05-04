import { describe, expect, it } from 'vitest';
import { type TitleHash, hashTitle } from '../src/privacy';

describe('hashTitle', () => {
  const SALT = 'workspace-salt-v1';

  it('returns 64-char hex string (sha256)', () => {
    const h = hashTitle('Hello', SALT);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes case (D-27)', () => {
    expect(hashTitle('Foo', SALT)).toBe(hashTitle('foo', SALT));
    expect(hashTitle('FOO', SALT)).toBe(hashTitle('foo', SALT));
  });

  it('normalizes whitespace (D-27)', () => {
    expect(hashTitle('  bar  ', SALT)).toBe(hashTitle('bar', SALT));
    expect(hashTitle('\tbar\n', SALT)).toBe(hashTitle('bar', SALT));
  });

  it('different salts produce different hashes', () => {
    expect(hashTitle('x', 'salt-a')).not.toBe(hashTitle('x', 'salt-b'));
  });

  it('different inputs produce different hashes', () => {
    expect(hashTitle('a', SALT)).not.toBe(hashTitle('b', SALT));
  });

  it('handles empty input deterministically', () => {
    expect(() => hashTitle('', SALT)).not.toThrow();
    expect(hashTitle('', SALT)).toBe(hashTitle('', SALT));
  });

  it('TitleHash brand prevents assigning raw strings (compile-time check)', () => {
    // @ts-expect-error - cannot assign plain string to TitleHash
    const _bad: TitleHash = 'plain-string';
    // The branded type is the runtime value's static guarantee.
    const ok: TitleHash = hashTitle('x', SALT);
    expect(typeof ok).toBe('string');
    // Reference _bad to satisfy noUnusedLocals while keeping the @ts-expect-error.
    expect(typeof _bad).toBe('string');
  });
});
