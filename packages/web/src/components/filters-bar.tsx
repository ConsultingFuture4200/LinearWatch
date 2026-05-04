'use client';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

interface FiltersBarProps {
  selected: { team: string; cycle: string; window: string };
  teamOptions?: Array<{ id: string; name: string }>;
  cycleOptions?: Array<{ id: string; name: string }>;
}

const WINDOWS = ['7d', '14d', '30d', '90d'] as const;

/**
 * UI-SPEC §Cost dashboard view → top-bar filters.
 *
 * URL-stateful per UI-SPEC §Interaction & State Contracts: changing a
 * filter calls `router.replace(?...)` so the server component re-fetches
 * via the typed query client. Reload preserves state. Sharing a link
 * reproduces the view exactly.
 *
 * Team and cycle option lists are passed in by the server component;
 * P1 simplification renders only "All teams" / "All cycles" until the
 * query API exposes a dimension-list metric (deferred to P2 — documented
 * in 01-08-SUMMARY.md).
 */
export function FiltersBar({
  selected,
  teamOptions = [],
  cycleOptions = [],
}: FiltersBarProps): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function setParam(key: string, value: string): void {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (value === 'all' || value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    startTransition(() => {
      router.replace(`?${params.toString()}`);
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          TEAM
        </Label>
        <Select value={selected.team} onValueChange={(v) => setParam('team', v)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {teamOptions.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          CYCLE
        </Label>
        <Select value={selected.cycle} onValueChange={(v) => setParam('cycle', v)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cycles</SelectItem>
            {cycleOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          WINDOW
        </Label>
        <Select value={selected.window} onValueChange={(v) => setParam('window', v)}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => (
              <SelectItem key={w} value={w}>
                {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
