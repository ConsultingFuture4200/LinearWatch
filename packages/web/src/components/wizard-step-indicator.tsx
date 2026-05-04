import { cn } from '@/lib/utils';

/**
 * 7 dots across the top of every wizard step (UI-SPEC §Setup wizard).
 *
 * - Current step  → `--primary`
 * - Completed     → `--foreground`
 * - Future        → `--muted-foreground`
 */
interface WizardStepIndicatorProps {
  /** 1-indexed current step (1..7). */
  current: number;
}

const TOTAL_STEPS = 7;

export function WizardStepIndicator({ current }: WizardStepIndicatorProps): React.JSX.Element {
  return (
    <ol
      aria-label={`Setup step ${current} of ${TOTAL_STEPS}`}
      className="flex items-center justify-center gap-2 py-4"
    >
      {Array.from({ length: TOTAL_STEPS }, (_, i) => {
        const stepNum = i + 1;
        const state = stepNum === current ? 'current' : stepNum < current ? 'completed' : 'future';
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: step indicator dots are positionally stable
            key={i}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'h-2 w-2 rounded-full transition-colors',
              state === 'current' && 'bg-primary',
              state === 'completed' && 'bg-foreground',
              state === 'future' && 'bg-muted-foreground/40',
            )}
          />
        );
      })}
    </ol>
  );
}
