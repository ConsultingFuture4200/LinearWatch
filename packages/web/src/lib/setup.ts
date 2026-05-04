/**
 * Server-only HTTP wrappers around the linearwatch internal /api/v1/setup/*
 * endpoints (Plan 01.09). Mirrors lib/api.ts in style.
 *
 * Bootstrap-window calls (workspace creation, OAuth callback, /setup/state)
 * are unauthenticated by necessity: there is no API key until step 5.
 *
 * Calls AFTER step 5 (github-pat, /seed) read the plaintext key from a
 * short-lived cookie set by `setSetupKeyCookie` and read by
 * `getSetupKeyCookie`. This keeps the plaintext key out of the URL and
 * out of NEXT_PUBLIC_* env (T-09-01 / T-08-01).
 */

import { cookies } from 'next/headers';

const SETUP_COOKIE = 'lw_setup_key';

export interface SetupState {
  has_workspace: boolean;
  has_seed_data: boolean;
  workspace_name?: string;
}

export interface BootstrapResult {
  workspace_id: string;
  plaintext_api_key: string;
}

function internalUrl(path: string): string {
  const base = process.env.LINEARWATCH_INTERNAL_URL ?? 'http://localhost:8080';
  return `${base}${path}`;
}

export async function fetchSetupState(): Promise<SetupState> {
  const r = await fetch(internalUrl('/api/v1/setup/state'), { cache: 'no-store' });
  if (!r.ok) {
    return { has_workspace: false, has_seed_data: false };
  }
  return (await r.json()) as SetupState;
}

export async function bootstrapWorkspace(name: string): Promise<BootstrapResult> {
  const r = await fetch(internalUrl('/api/v1/setup/workspace'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
    cache: 'no-store',
  });
  if (!r.ok) {
    throw new Error(`bootstrap failed: ${r.status}`);
  }
  return (await r.json()) as BootstrapResult;
}

export async function completeLinearOAuth(code: string, state: string): Promise<void> {
  const r = await fetch(internalUrl('/api/v1/setup/linear-oauth/callback'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, state }),
    cache: 'no-store',
  });
  if (!r.ok) {
    throw new Error(`oauth callback failed: ${r.status}`);
  }
}

export async function saveGithubPat(pat: string, plaintextKey: string): Promise<void> {
  const r = await fetch(internalUrl('/api/v1/setup/github-pat'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${plaintextKey}`,
    },
    body: JSON.stringify({ pat }),
    cache: 'no-store',
  });
  if (!r.ok) {
    throw new Error(`github-pat save failed: ${r.status}`);
  }
}

export async function postSeed(plaintextKey: string): Promise<{ inserted: number }> {
  const r = await fetch(internalUrl('/api/v1/seed'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${plaintextKey}`,
    },
    body: JSON.stringify({}),
    cache: 'no-store',
  });
  if (!r.ok) {
    throw new Error(`seed failed: ${r.status}`);
  }
  return (await r.json()) as { inserted: number };
}

/**
 * Set the short-lived setup cookie holding the plaintext workspace key.
 *
 * httpOnly + sameSite=lax + path=/setup so the cookie is only sent to the
 * wizard subtree and never readable from JS. The cookie is cleared by
 * `clearSetupKeyCookie()` at step 7 / Done.
 */
export async function setSetupKeyCookie(plaintextKey: string): Promise<void> {
  const c = await cookies();
  c.set(SETUP_COOKIE, plaintextKey, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // 30 minutes: plenty of time to finish the wizard, expires if abandoned.
    maxAge: 60 * 30,
  });
}

export async function getSetupKeyCookie(): Promise<string | undefined> {
  const c = await cookies();
  return c.get(SETUP_COOKIE)?.value;
}

export async function clearSetupKeyCookie(): Promise<void> {
  const c = await cookies();
  c.delete(SETUP_COOKIE);
}
