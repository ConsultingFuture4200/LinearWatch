'use client';

import { Badge } from '@/components/ui/badge';

interface UnconfirmedBadgeProps {
  onClick?: () => void;
}

/**
 * UI-SPEC §Cost dashboard view → "Unconfirmed" badge label.
 *
 * Renders the literal word "Unconfirmed" (color is NOT the only signal —
 * see UI-SPEC §Contrast and accessibility). Clicking opens the identity
 * side panel via the parent component's onClick handler.
 *
 * Color treatment: `border-warning text-warning bg-transparent` per
 * UI-SPEC.
 */
export function UnconfirmedBadge({ onClick }: UnconfirmedBadgeProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-full"
      aria-label="Open identity confirmation panel"
    >
      <Badge variant="outline" className="border-warning text-warning bg-transparent">
        Unconfirmed
      </Badge>
    </button>
  );
}
