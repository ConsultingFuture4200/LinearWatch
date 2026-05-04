import { WizardStepIndicator } from '@/components/wizard-step-indicator';
import { WorkspaceForm } from './workspace-form';

const HEADING = 'Name your workspace and generate an API key.';

export default function WorkspaceStepPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">
      <WizardStepIndicator current={5} />
      <h1 className="text-[28px] font-semibold leading-tight">{HEADING}</h1>
      <WorkspaceForm />
    </div>
  );
}
