'use server';

import { bootstrapWorkspace, saveGithubPat, setSetupKeyCookie } from '@/lib/setup';
import { cookies } from 'next/headers';

const PAT_COOKIE = 'agw_setup_github_pat';

export interface GenerateKeyResult {
  ok: boolean;
  plaintextKey?: string;
  error?: string;
}

/**
 * Bootstrap the workspace, generate the API key, then (if a PAT was
 * collected in step 4) persist it. Sets the setup-key cookie so steps 6-7
 * can authenticate to /api/v1/seed without exposing the key in the URL.
 *
 * Returns the plaintext key once for one-time client display. After this
 * action returns, the key is also stored in the httpOnly cookie — but the
 * cookie is server-only, so the client cannot read it. The displayed
 * plaintext is the user's one chance to copy it.
 */
export async function generateApiKeyAction(formData: FormData): Promise<GenerateKeyResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    return { ok: false, error: 'Workspace name is required.' };
  }
  try {
    const ws = await bootstrapWorkspace(name);
    await setSetupKeyCookie(ws.plaintext_api_key);

    // If the user supplied a GitHub PAT in step 4, persist it now using the
    // fresh key. Best-effort: a PAT-save failure does not abort the wizard.
    const c = await cookies();
    const pat = c.get(PAT_COOKIE)?.value;
    if (pat) {
      try {
        await saveGithubPat(pat, ws.plaintext_api_key);
        c.delete(PAT_COOKIE);
      } catch {
        // Surface a soft error in the UI if we want; for P1 we silently
        // continue. The Settings page will let the user re-enter the PAT.
      }
    }

    return { ok: true, plaintextKey: ws.plaintext_api_key };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    return { ok: false, error: msg };
  }
}
