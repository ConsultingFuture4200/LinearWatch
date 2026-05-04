'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

interface MonoCopyBlockProps {
  /** The literal text to display and copy. */
  value: string;
  /** When true, renders as a multi-line `<pre>` block (e.g., cURL command). */
  multiline?: boolean;
  /** When true, renders a Mask/Reveal toggle (used for API keys). */
  maskable?: boolean;
  /** Initial masked state — only meaningful when `maskable` is true. */
  defaultMasked?: boolean;
  /** Font size variant. UI-SPEC: 14px for keys/URLs, 12px for cURL/timestamps. */
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}

/**
 * Reusable mono-font block with a copy button and optional mask/reveal
 * toggle (UI-SPEC §Custom components → MonoCopyBlock; §Keyboard &
 * screen-reader contract).
 *
 * When masked, renders 16 bullet characters (`••••…`) so screen readers
 * announce "bullet bullet" instead of the actual key — matches the
 * UI-SPEC accessibility note exactly.
 */
export function MonoCopyBlock({
  value,
  multiline = false,
  maskable = false,
  defaultMasked = false,
  size = 'md',
  className,
  ariaLabel,
}: MonoCopyBlockProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [masked, setMasked] = useState(maskable && defaultMasked);

  const displayValue = masked ? '••••••••••••••••' : value;

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const fontSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div
      className={cn(
        'relative flex items-start gap-2 rounded-md border bg-muted px-3 py-2 font-mono',
        fontSize,
        className,
      )}
    >
      {multiline ? (
        <pre
          className="flex-1 overflow-x-auto whitespace-pre-wrap break-all"
          aria-label={ariaLabel}
        >
          {displayValue}
        </pre>
      ) : (
        <span className="flex-1 break-all" aria-label={ariaLabel}>
          {displayValue}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {maskable ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-pressed={masked}
            aria-label={masked ? 'Reveal' : 'Mask'}
            onClick={() => setMasked((m) => !m)}
          >
            {masked ? (
              <Eye className="h-4 w-4" aria-hidden="true" />
            ) : (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={copied ? 'Copied' : 'Copy'}
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}
