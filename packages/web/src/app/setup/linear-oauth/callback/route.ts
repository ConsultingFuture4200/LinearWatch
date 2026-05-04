import { completeLinearOAuth } from '@/lib/setup';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Linear OAuth callback handler — Plan 01.09 step 3.
 *
 * Linear redirects here after the user approves the OAuth app:
 *   GET /setup/linear-oauth/callback?code=<code>&state=<state>
 *
 * We exchange the code via the internal server (which holds
 * LINEAR_CLIENT_SECRET) and forward to step 4.
 *
 * The exchange is intentionally minimal in P1 — see
 * setup.ts route handler for the full rationale. P2/P3 will use the
 * resulting access token for agentwatch-as-agent endpoints.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code || !state) {
    const reason = error ?? 'missing_code_or_state';
    return NextResponse.redirect(
      new URL(`/setup/linear-oauth?error=${encodeURIComponent(reason)}`, req.url),
    );
  }

  try {
    await completeLinearOAuth(code, state);
  } catch {
    return NextResponse.redirect(new URL('/setup/linear-oauth?error=callback_failed', req.url));
  }

  return NextResponse.redirect(new URL('/setup/github-pat', req.url));
}
