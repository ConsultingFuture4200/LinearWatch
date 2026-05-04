'use client';

import { confirmAgentAction } from '@/app/(dashboard)/cost/actions';
import type { AgentRow } from '@/components/agents-table';
import { MonoCopyBlock } from '@/components/mono-copy-block';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

interface IdentitySidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentRow | null;
}

/**
 * UI-SPEC §Identity confirmation side panel (DASH-04 / D-17).
 *
 * Configured as a Radix Dialog with `modal={false}` so the table behind
 * remains scrollable for batch-confirmation of 3-5 rows on first install.
 * Width 480px (`w-[480px]`); height `h-[calc(100vh-3.5rem)]`. Backdrop
 * `bg-foreground/10` (subtle scrim — does not block the table).
 *
 * All copy verbatim from UI-SPEC. On confirm CTA, calls confirmAgent via
 * a Server Action; success → sonner toast "{agent name} confirmed.";
 * failure → "Could not confirm {agent name}. Refresh and try again — your
 * changes were not saved." then router.refresh() to re-execute the
 * server fetch.
 */
export function IdentitySidePanel({
  open,
  onOpenChange,
  agent,
}: IdentitySidePanelProps): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleConfirm(): Promise<void> {
    if (!agent) return;
    setPending(true);
    try {
      const agentId = agent.agentId ?? agent.key;
      const linearAppUserId = agent.linearAppUserId ?? '';
      await confirmAgentAction(agentId, linearAppUserId);
      toast.success(`${agent.key} confirmed.`);
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(
        `Could not confirm ${agent.key}. Refresh and try again — your changes were not saved.`,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="fixed right-0 top-14 left-auto translate-x-0 translate-y-0 w-[480px] h-[calc(100vh-3.5rem)] max-w-none rounded-none border-l border-y-0 border-r-0 sm:max-w-none data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right p-0 overflow-y-auto"
        showCloseButton={false}
      >
        <div className="flex h-full flex-col">
          <header className="space-y-2 border-b px-6 py-5">
            <DialogTitle className="text-lg font-semibold">Confirm agent identity</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Confirming locks this agent's identity for all future sessions. You can re-open this
              panel from the table at any time.
            </p>
          </header>
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Signals
              </h3>
              <dl className="space-y-3 text-sm">
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">Linear app user ID</dt>
                  <dd>
                    <MonoCopyBlock
                      value={agent?.linearAppUserId ?? '—'}
                      size="sm"
                      ariaLabel="Linear app user ID"
                    />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-xs text-muted-foreground">Observed sessions</dt>
                  <dd className="font-mono tabular-nums">{agent?.count ?? 0}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-xs text-muted-foreground">First seen</dt>
                  <dd className="font-mono text-xs">—</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-xs text-muted-foreground">Last seen</dt>
                  <dd className="font-mono text-xs">—</dd>
                </div>
              </dl>
            </section>
            <Separator />
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Confidence
              </h3>
              <p className="text-sm">
                0.5 / 1.0 — single Linear signal. Cross-source signals (GitHub login, vendor session
                pattern) ship in Phase 2 and will lift confidence automatically.
              </p>
            </section>
          </div>
          <footer className="flex items-center justify-end gap-2 border-t px-6 py-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={pending || !agent}>
              {pending ? 'Confirming…' : 'Confirm this agent'}
            </Button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
