import type { DimensionName, Filter, QueryRequest, QueryRow } from '@agentwatch/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { ServerDb } from '../../db.js';
import { resolveWindow } from '../window.js';

/**
 * `cost_by_agent` — SUM(cost_usd) and COUNT(*) grouped by dimension within
 * window + filters.
 *
 * API-03 enforcement: the SQL text is composed entirely from CLOSED-SET
 * switches on `dimension` (Zod enum `DimensionName`) and `filter.field`/
 * `filter.op` (Zod enums `FilterField`/`FilterOp`). User-supplied values
 * (workspace_id, since, until, filter values) are bound via Drizzle's `sql`
 * tag — no string concatenation of attacker-controlled input ever enters
 * the SQL text. NULL `cost_usd` rows count toward `count` and contribute 0
 * to `value` (Phase 1 — vendor cost enrichment lands in P2).
 */
export async function costByAgent(
  req: QueryRequest,
  ctx: { workspaceId: string; db: ServerDb },
): Promise<QueryRow[]> {
  const { since, until } = resolveWindow(req.window);
  const dim: DimensionName = req.dimension ?? 'agent';

  const join = dimJoin(dim);
  const keyExpr = dimKeyExpr(dim);
  const groupBy = dimGroupBy(dim);
  const filterSql = buildFilterSql(req.filters);

  const result = await ctx.db.execute(sql`
    SELECT ${keyExpr} AS key,
           COALESCE(SUM(s.cost_usd), 0)::float8 AS value,
           COUNT(*)::int AS count
      FROM agent_sessions s
      ${join}
     WHERE s.workspace_id = ${ctx.workspaceId}
       AND s.started_at >= ${since}
       AND s.started_at <  ${until}
       ${filterSql}
     GROUP BY ${groupBy}
     ORDER BY value DESC
     LIMIT 200
  `);

  const rows = result.rows as Array<{
    key: string;
    value: number | string;
    count: number | string;
  }>;
  return rows.map((row) => ({
    key: row.key,
    value: Number(row.value),
    count: Number(row.count),
  }));
}

function dimJoin(dim: DimensionName): SQL {
  switch (dim) {
    case 'agent':
      return sql`JOIN agents a ON a.id = s.agent_id AND a.deleted_at IS NULL`;
    case 'team':
      return sql`JOIN teams t ON t.id = s.team_id`;
    case 'cycle':
      return sql`JOIN cycles c ON c.id = s.cycle_id`;
  }
}

function dimKeyExpr(dim: DimensionName): SQL {
  switch (dim) {
    case 'agent':
      return sql`a.name`;
    case 'team':
      return sql`t.key`;
    case 'cycle':
      return sql`c.name`;
  }
}

function dimGroupBy(dim: DimensionName): SQL {
  switch (dim) {
    case 'agent':
      return sql`a.id, a.name`;
    case 'team':
      return sql`t.id, t.key`;
    case 'cycle':
      return sql`c.id, c.name`;
  }
}

/**
 * Build the optional filter clause.
 *
 * `filter.field` is the closed Zod enum `FilterField` (`agent_id` | `team_id`
 * | `cycle_id`); `filter.op` is the closed Zod enum `FilterOp` (`eq` | `in`
 * | `neq`). The column name is selected via switch — never interpolated from
 * the user payload. The filter VALUE is bound as a parameter.
 */
function buildFilterSql(filters: Filter[] | undefined): SQL {
  if (!filters || filters.length === 0) return sql``;

  const fragments: SQL[] = [];
  for (const f of filters) {
    const column = filterColumn(f.field);
    if (f.op === 'eq') {
      const value = Array.isArray(f.value) ? f.value[0] : f.value;
      fragments.push(sql`AND ${column} = ${value}`);
    } else if (f.op === 'neq') {
      const value = Array.isArray(f.value) ? f.value[0] : f.value;
      fragments.push(sql`AND ${column} <> ${value}`);
    } else if (f.op === 'in') {
      const arr = Array.isArray(f.value) ? f.value : [f.value];
      fragments.push(sql`AND ${column} = ANY(${arr}::uuid[])`);
    }
  }
  return sql.join(fragments, sql` `);
}

function filterColumn(field: 'agent_id' | 'team_id' | 'cycle_id'): SQL {
  switch (field) {
    case 'agent_id':
      return sql`s.agent_id`;
    case 'team_id':
      return sql`s.team_id`;
    case 'cycle_id':
      return sql`s.cycle_id`;
  }
}
