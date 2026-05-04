'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * UI-SPEC §App shell & navigation — the three top-nav tabs.
 *
 * Implemented as a `role="tablist"` with arrow-key navigation per the
 * UI-SPEC keyboard contract. Reliability and Lineage stay clickable (they
 * lead to P2 stub pages — see UI-SPEC §P2 stub pages); only the Cost
 * underline uses `--primary`, the others sit in `--muted-foreground`.
 */
const TABS = [
  { href: '/cost', label: 'Cost' },
  { href: '/reliability', label: 'Reliability' },
  { href: '/lineage', label: 'Lineage' },
] as const;

export function NavTabs(): React.JSX.Element {
  const pathname = usePathname();

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const focusables = Array.from(
      e.currentTarget.querySelectorAll<HTMLAnchorElement>('a[role="tab"]'),
    );
    const idx = focusables.findIndex((el) => el === document.activeElement);
    if (idx === -1) return;
    const nextIdx =
      e.key === 'ArrowLeft'
        ? (idx - 1 + focusables.length) % focusables.length
        : (idx + 1) % focusables.length;
    focusables[nextIdx]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Dashboard sections"
      className="flex gap-1"
      onKeyDown={handleKeyDown}
    >
      {TABS.map((tab) => {
        const active = pathname?.startsWith(tab.href) ?? false;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cn(
              'relative px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded',
              active
                ? 'text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
