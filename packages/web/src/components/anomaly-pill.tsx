import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface AnomalyPillProps {
  /** Multiple of 28-day rolling average — appears as `↑{multiple}×`. */
  multiple: number;
  /** Date the anomaly occurred (rendered in tooltip). */
  date: string;
  /** Agent name (rendered in tooltip). */
  agent: string;
  /** Spend on that day (rendered in tooltip). */
  amount: number;
  /** 28-day rolling baseline (rendered in tooltip). */
  baseline: number;
}

/**
 * UI-SPEC §Cost dashboard view → Anomaly pill content.
 *
 * Pill marker overlays bar segments where an agent's daily cost exceeded
 * 3× its 28-day rolling average. Color does not stand alone — the
 * `↑{multiple}×` text is required so colorblind users can read the
 * magnitude (UI-SPEC §Contrast and accessibility).
 */
export function AnomalyPill({
  multiple,
  date,
  agent,
  amount,
  baseline,
}: AnomalyPillProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center rounded-full border border-warning bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
          ↑{multiple.toFixed(1)}×
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">
          On {date}, {agent} spent ${amount.toFixed(2)} — {multiple.toFixed(1)}× its 28-day rolling
          average of ${baseline.toFixed(2)}.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
