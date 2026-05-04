'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useState } from 'react';

/**
 * AgentSession UI Visibility Warning — D-13 / SETUP-02 / Pitfall 2.
 *
 * THIS IS THE LOAD-BEARING UX MOMENT IN PHASE 1.
 *
 * - Verbatim D-13 copy (do NOT paraphrase).
 * - Radix Dialog with `modal={true}`, `role="alertdialog"`.
 * - Backdrop click DOES NOT close the modal.
 * - Escape DOES NOT close (default Radix behavior is intercepted via
 *   onEscapeKeyDown.preventDefault).
 * - Focus is trapped (Radix default).
 * - Click-through is the ONLY way to advance.
 *
 * Verbatim button label: "I've notified my team"
 * Secondary button: "Pause - I'll come back later" (closes via window.close
 *   or back-nav; stores `setup.paused_at` in localStorage so the dashboard
 *   can show a "Resume setup" pill in P2 — P1 just leaves the marker).
 */
const HEADING = 'Heads up — this changes Linear for your whole team.';

const WARNING_PARAGRAPH_1 =
  "Heads up: enabling Linear's AgentSession category modifies the workspace UI for every member of your Linear workspace, not just you. Linear shows agent activity in a dedicated UI category once an OAuth app with AgentSession scope is approved.";

const WARNING_PARAGRAPH_2 =
  'If your team has not been told to expect this, pause and notify them before continuing.';

const PRIMARY_LABEL = "I've notified my team";
const SECONDARY_LABEL = "Pause — I'll come back later";

export function AgentsessionWarningModal(): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  // Auto-open on mount (the page is the modal). If a parent attempts to
  // close us via state, we ignore that — the click-through is the only
  // exit path.
  useEffect(() => {
    setOpen(true);
  }, []);

  function handleContinue(): void {
    router.push('/setup/linear-oauth');
  }

  function handlePause(): void {
    // Best-effort marker for the future "Resume setup" pill (P2).
    try {
      localStorage.setItem('lw_setup_paused_at', new Date().toISOString());
    } catch {
      /* localStorage may be unavailable in private browsing — non-fatal */
    }
    // Navigate back to the start; the user can come back later.
    router.push('/setup');
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && setOpen(true)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/60" />
        <DialogPrimitive.Content
          role="alertdialog"
          // Disable Escape (D-13: click-through is the only exit).
          onEscapeKeyDown={(e) => e.preventDefault()}
          // Disable backdrop click.
          onPointerDownOutside={(e) => e.preventDefault()}
          // Disable any other autoclose interaction (focus loss, etc).
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed top-[50%] left-[50%] z-50 w-full max-w-2xl translate-x-[-50%] translate-y-[-50%] rounded-lg border-t-4 border-warning bg-background p-8 shadow-lg outline-none"
        >
          {/* Radix requires DialogTitle + DialogDescription as descendants of
              DialogContent for screen-reader compliance — registering custom
              aria-labelledby/aria-describedby IDs is not sufficient. */}
          <DialogPrimitive.Title className="text-[28px] font-semibold leading-tight">
            {HEADING}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-6 text-sm text-foreground">
            {WARNING_PARAGRAPH_1}
          </DialogPrimitive.Description>
          <p className="mt-4 text-sm text-foreground">{WARNING_PARAGRAPH_2}</p>
          <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={handlePause}>
              {SECONDARY_LABEL}
            </Button>
            <Button onClick={handleContinue} autoFocus>
              {PRIMARY_LABEL}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
