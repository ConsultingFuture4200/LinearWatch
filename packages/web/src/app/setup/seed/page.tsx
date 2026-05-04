import { Button } from '@/components/ui/button';
import { WizardStepIndicator } from '@/components/wizard-step-indicator';
import { seedAction, skipSeedAction } from './actions';

/**
 * Step 6 — Seed offer (D-07 / DASH-06 / SETUP-04).
 *
 * "Try with synthetic data" inserts ~50 sessions and redirects to the
 * Done step. The synthetic-data banner appears on /cost automatically.
 *
 * "Wait for real webhooks" advances without seeding.
 */
const HEADING = 'Want to see the dashboard with synthetic data?';

export default function SeedOfferPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">
      <WizardStepIndicator current={6} />
      <div className="space-y-4">
        <h1 className="text-[28px] font-semibold leading-tight">{HEADING}</h1>
        <p className="text-sm text-muted-foreground">
          Inserts ~50 demo sessions across 14 days, 3 fake agents (cursor-demo, devin-demo,
          internal-bot-demo), and 2 teams. The dashboard shows a persistent banner so you don't
          accidentally screenshot demo data. Clear at any time with{' '}
          <code className="font-mono">agentwatch admin clear-seed</code>.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <form action={seedAction}>
          <Button type="submit">Try with synthetic data</Button>
        </form>
        <form action={skipSeedAction}>
          <Button type="submit" variant="ghost">
            Wait for real webhooks
          </Button>
        </form>
      </div>
    </div>
  );
}
