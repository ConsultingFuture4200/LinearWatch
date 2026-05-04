import { type AgentRow, AgentsTable } from '@/components/agents-table';
import { CostChart } from '@/components/cost-chart';
import { EmptyState } from '@/components/empty-state';
import { FiltersBar } from '@/components/filters-bar';
import { fetchQuery } from '@/lib/query';

/**
 * UI-SPEC §Cost dashboard view (DASH-01) — Server Component that fetches
 * cost data through `lib/query.ts` (the only path to the DB; API-07).
 *
 * No DB driver is imported here — the only data source is `fetchQuery`,
 * which calls `POST /api/v1/query` over the internal docker network.
 *
 * URL-stateful filters per UI-SPEC §Interaction & State Contracts:
 * `?team=…&cycle=…&window=…`. Defaults: `team=all`, `cycle=all`,
 * `window=14d`.
 */
type Window = '7d' | '14d' | '30d' | '90d';

interface SearchParams {
  team?: string;
  cycle?: string;
  window?: Window;
}

interface QueryFilter {
  field: 'agent_id' | 'team_id' | 'cycle_id';
  op: 'eq' | 'neq' | 'in';
  value: string | string[];
}

const VALID_WINDOWS: readonly Window[] = ['7d', '14d', '30d', '90d'] as const;

function isValidWindow(value: unknown): value is Window {
  return typeof value === 'string' && (VALID_WINDOWS as readonly string[]).includes(value);
}

export default async function CostPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const window: Window = isValidWindow(sp.window) ? sp.window : '14d';

  const filters: QueryFilter[] = [];
  if (sp.team && sp.team !== 'all') {
    filters.push({ field: 'team_id', op: 'eq', value: sp.team });
  }
  if (sp.cycle && sp.cycle !== 'all') {
    filters.push({ field: 'cycle_id', op: 'eq', value: sp.cycle });
  }

  const [byAgent, sessionCount] = await Promise.all([
    fetchQuery({
      metric: 'cost_by_agent',
      dimension: 'agent',
      filters: filters.length > 0 ? filters : undefined,
      window: { last: window },
    }),
    fetchQuery({
      metric: 'agent_session_count',
      dimension: 'agent',
      filters: filters.length > 0 ? filters : undefined,
      window: { last: window },
    }),
  ]);

  if (byAgent.rows.length === 0) {
    return <EmptyState />;
  }

  // Merge session counts into agent rows so the table shows both columns
  // from a single render. Both queries dimension on agent, so the keys
  // line up.
  const sessionMap = new Map(sessionCount.rows.map((r) => [r.key, r.count ?? r.value ?? 0]));
  const agentRows: AgentRow[] = byAgent.rows.map((r) => ({
    key: r.key,
    value: r.value,
    count: Number(sessionMap.get(r.key) ?? r.count ?? 0),
    // P1: every agent lands at confidence 0.5 (D-16) until human-confirmed,
    // so the "Unconfirmed" badge surfaces by default. The query API doesn't
    // expose state today; the dashboard will read this from a future
    // metric extension. For P1 we treat all rows as unconfirmed so the
    // confirmation flow is exercised end-to-end.
    unconfirmed: true,
  }));

  return (
    <main className="mx-auto max-w-screen-2xl space-y-8 px-6 py-12">
      <header>
        <h1 className="text-[28px] font-semibold leading-tight">Cost</h1>
        <p className="mt-2 text-sm text-muted-foreground">Spend per agent, by team and cycle.</p>
      </header>
      <FiltersBar
        selected={{
          team: sp.team ?? 'all',
          cycle: sp.cycle ?? 'all',
          window,
        }}
      />
      <CostChart data={byAgent.rows} />
      <AgentsTable agentRows={agentRows} />
    </main>
  );
}
