import { FlaskConical } from 'lucide-react';

/**
 * UI-SPEC §Synthetic-data banner — pinned to the top of the dashboard
 * when seed rows exist. Copy is verbatim:
 *   "Synthetic data — clear via `agentwatch admin clear-seed`"
 *
 * NOT dismissable (UI-SPEC: "screenshot-safety guarantee"). The dashboard
 * layout decides whether to render this based on `fetchSeedStatus()`.
 */
export function SyntheticDataBanner(): React.JSX.Element {
  return (
    <output className="flex items-start gap-3 border-l-4 border-warning bg-warning/10 px-4 py-3 text-foreground">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-sm">
        Synthetic data — clear via{' '}
        <code className="font-mono text-xs">agentwatch admin clear-seed</code>
      </p>
    </output>
  );
}
