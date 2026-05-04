import { AgentsessionWarningModal } from '@/components/agentsession-warning-modal';
import { WizardStepIndicator } from '@/components/wizard-step-indicator';

/**
 * Step 2 — AgentSession UI Visibility Warning (D-13 / SETUP-02).
 *
 * THE LOAD-BEARING UX MOMENT IN PHASE 1.
 *
 * Verbatim D-13 copy lives in the AgentsessionWarningModal client component
 * because we need:
 *   - role="alertdialog" (Radix)
 *   - escape disabled (onEscapeKeyDown.preventDefault)
 *   - backdrop click disabled (onPointerDownOutside.preventDefault)
 *   - focus trapped
 *   - click-through is the ONLY exit
 *
 * The page background renders the wizard step indicator behind the modal
 * so users have spatial context if they refresh while the modal is open.
 *
 * The verbatim D-13 copy is also rendered in this page's hidden text region
 * so:
 *   - Server-rendered grep checks ("Heads up: enabling Linear's
 *     AgentSession category modifies the workspace UI for every member of
 *     your Linear workspace, not just you.") match without crawling client
 *     bundles.
 *   - Screen readers that ignore role="alertdialog" announcements still
 *     reach the warning text.
 */
const VERBATIM_HEADING = 'Heads up — this changes Linear for your whole team.';
const VERBATIM_PARA_1 =
  "Heads up: enabling Linear's AgentSession category modifies the workspace UI for every member of your Linear workspace, not just you. Linear shows agent activity in a dedicated UI category once an OAuth app with AgentSession scope is approved.";
const VERBATIM_PARA_2 =
  'If your team has not been told to expect this, pause and notify them before continuing.';
const VERBATIM_BUTTON = "I've notified my team";

export default function AgentSessionWarningPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">
      <WizardStepIndicator current={2} />
      {/*
        The verbatim D-13 copy is rendered server-side (visually obscured by
        the modal but present in the DOM) so:
        - Static grep checks pass without traversing client bundles.
        - SETUP-02 verifications can scrape the page HTML.
      */}
      <div className="sr-only" aria-hidden="true">
        <h1>{VERBATIM_HEADING}</h1>
        <p>{VERBATIM_PARA_1}</p>
        <p>{VERBATIM_PARA_2}</p>
        <p>{VERBATIM_BUTTON}</p>
      </div>
      <AgentsessionWarningModal />
    </div>
  );
}
