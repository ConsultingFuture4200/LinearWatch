import type { WorkspaceWarning } from '@/lib/api';
import { TriangleAlert } from 'lucide-react';

/**
 * UI-SPEC §Workspace warnings banner — driven by `workspace_warnings`
 * rows surfaced through `fetchActiveWarnings()`. Stacks below the
 * synthetic-data banner if both apply.
 *
 * P1 simplification: Dismiss is a no-op placeholder — the server endpoint
 * to write `dismissed_at` is P2 (the warning rows expire on their own
 * once the underlying signal stops). Documented in 01-08-SUMMARY.md.
 */
interface WorkspaceWarningsBannerProps {
  warnings: WorkspaceWarning[];
}

export function WorkspaceWarningsBanner({
  warnings,
}: WorkspaceWarningsBannerProps): React.JSX.Element | null {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-1">
      {warnings.map((w) => (
        <output
          key={w.id}
          className="flex items-start gap-3 border-l-4 border-warning bg-warning/10 px-4 py-3 text-foreground"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="flex-1 text-sm">
            <span className="mr-2 font-mono text-xs uppercase tracking-wide">{w.severity}</span>
            <span>{w.message}</span>
          </div>
        </output>
      ))}
    </div>
  );
}
