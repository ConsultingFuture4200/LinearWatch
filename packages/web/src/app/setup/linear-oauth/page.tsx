import { Button } from '@/components/ui/button';
import { WizardStepIndicator } from '@/components/wizard-step-indicator';
import Link from 'next/link';

/**
 * Step 3 — Linear OAuth.
 *
 * The page builds the OAuth authorization URL from LINEAR_CLIENT_ID and
 * the public host. The user clicks "Connect Linear" which navigates to
 * Linear's authorization screen; on success Linear redirects back to
 * `/setup/linear-oauth/callback?code=...&state=...` (the route handler in
 * route.ts), which exchanges the code for a token and forwards to step 4.
 *
 * P1 minimal: if LINEAR_CLIENT_ID is unset (e.g., during a partial smoke
 * test), the user can click "I'll set this up later" and the wizard
 * advances to /setup/github-pat with a marker so the dashboard can show a
 * "Linear OAuth incomplete" warning. Plan 01.10 CI tightens this.
 */
const HEADING = 'Connect your Linear workspace.';
const BODY =
  'agentwatch needs OAuth access with the AgentSession scope to receive agent activity webhooks. We never store issue titles in plaintext — they are hashed at the type level (see Settings → Privacy).';

const SCOPES = ['read', 'admin', 'app:assignable', 'app:mentionable'].join(',');

function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL('https://linear.app/oauth/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('state', state);
  // actor=app means the OAuth app acts on behalf of the AgentSession agent
  // (Linear OAuth docs §Apps acting as agents).
  u.searchParams.set('actor', 'app');
  return u.toString();
}

export default function LinearOAuthPage(): React.JSX.Element {
  const clientId = process.env.LINEAR_CLIENT_ID ?? '';
  const publicHost =
    process.env.AGENTWATCH_PUBLIC_URL ?? process.env.NEXT_PUBLIC_AGENTWATCH_PUBLIC_URL ?? '';
  const redirectUri = `${publicHost}/setup/linear-oauth/callback`;
  // P1: state is a static placeholder. P2 hardens this to a per-session
  // signed token verified in the callback route.
  const oauthState = 'p1-setup';
  const authorizeUrl = clientId ? buildAuthorizeUrl(clientId, redirectUri, oauthState) : '';

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">
      <WizardStepIndicator current={3} />
      <div className="space-y-4">
        <h1 className="text-[28px] font-semibold leading-tight">{HEADING}</h1>
        <p className="text-sm text-muted-foreground">{BODY}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {authorizeUrl ? (
          <Button asChild>
            <a href={authorizeUrl} target="_blank" rel="noopener noreferrer">
              Connect Linear
            </a>
          </Button>
        ) : (
          <p className="text-sm text-destructive">
            LINEAR_CLIENT_ID is not set in the server environment. Configure it in your{' '}
            <code className="font-mono">.env</code> file before continuing.
          </p>
        )}
        <Button variant="ghost" asChild>
          <Link href="/setup/github-pat">Skip for now</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        If nothing opens, your browser blocked the popup — copy this URL:{' '}
        <span className="font-mono break-all">
          {authorizeUrl || '(set LINEAR_CLIENT_ID first)'}
        </span>
      </p>
    </div>
  );
}
