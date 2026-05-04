import type { Window } from '@agentwatch/shared';

/**
 * Resolve a query Window into an absolute `(since, until)` pair.
 *
 * The Window schema (`@agentwatch/shared`) accepts either:
 *   - `last: '14d'` / `'168h'` (relative, anchored at `now()`), OR
 *   - `from` + `to` (ISO datetimes, absolute).
 *
 * The dispatcher binds these as parameterized values into every metric SQL
 * function — never interpolated as a string. This helper centralises the
 * relative-to-absolute conversion so each metric file stays focused on its
 * shape, not its time math.
 */
export function resolveWindow(w: Window): { since: Date; until: Date } {
  const now = new Date();
  if (w.last) {
    const m = /^(\d+)(d|h)$/.exec(w.last);
    if (!m) throw new Error('invalid_window_last');
    const n = Number.parseInt(m[1] ?? '0', 10);
    const ms = m[2] === 'd' ? n * 86_400_000 : n * 3_600_000;
    return { since: new Date(now.getTime() - ms), until: now };
  }
  // Schema's .refine() guarantees both `from` and `to` are present here.
  const from = w.from;
  const to = w.to;
  if (!from || !to) throw new Error('invalid_window_absolute');
  return { since: new Date(from), until: new Date(to) };
}
