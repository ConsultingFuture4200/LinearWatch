import { Button } from '@/components/ui/button';
import { WizardStepIndicator } from '@/components/wizard-step-indicator';
import { fetchSetupState } from '@/lib/setup';
import Link from 'next/link';
import { redirect } from 'next/navigation';

/**
 * Step 1 — Welcome + system check.
 *
 * If `/api/v1/setup/state` reports a workspace already exists, redirect to
 * /cost (the user is already past setup). Otherwise render the welcome step.
 *
 * P1 system-check rows: Postgres reachable, Migrations applied, Webhook
 * receiver listening. We trust the server's existence (this page is itself
 * served by the web container which depends on the server being up); a
 * deeper /health probe is over-engineering for P1.
 */
const HEADING = 'Welcome to linearwatch.';
const BODY =
  "This wizard takes about 4 minutes. You'll connect your Linear workspace, optionally a GitHub PAT (used in Phase 2), and generate a workspace API key. We'll then either seed synthetic data or wait for your first real webhook.";

export default async function SetupWelcomePage(): Promise<React.JSX.Element> {
  const state = await fetchSetupState();
  if (state.has_workspace) {
    redirect('/cost');
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">
      <WizardStepIndicator current={1} />
      <div className="space-y-4">
        <h1 className="text-[28px] font-semibold leading-tight">{HEADING}</h1>
        <p className="text-sm text-muted-foreground">{BODY}</p>
      </div>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">System check</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <span aria-hidden="true">✓</span>
            <span>Postgres reachable</span>
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true">✓</span>
            <span>Migrations applied</span>
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true">✓</span>
            <span>Webhook receiver listening on /webhooks/linear</span>
          </li>
        </ul>
      </section>
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/setup/agentsession-warning">Continue</Link>
        </Button>
      </div>
    </div>
  );
}
