import type { DimensionName, Filter, QueryRequest, QueryRow } from '@agentwatch/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { ServerDb } from '../../db.js';
import { resolveWindow } from '../window.js';

/**
 * `agent_session_count` — COUNT(*) of agent_sessions in window + filters.
 *
 * Without a dimension, returns a single row keyed `'all'` with the total
 * count. With a dimension, returns one row per dimension value — useful for
 * the "sessions" column on the cost table view (DASH-01).
 *
 * Same closed-set discipline as `cost_by_agent`: dimension and filter shape
 * are selected via switch on Zod enum values; user-supplied values are
 * bound parameters.
 */
export async function agentSessionCount(
  req: QueryRequest,
  ctx: { workspaceId: string; db: ServerDb },
): Promise<QueryRow[]> {
  const { since, until } = resolveWindow(req.window);
  const filterSql = buildFilterSql(req.filters);

  if (!req.dimension) {
    const result = await ctx.db.execute(sql`
      SELECT 'all' AS key, COUNT(*)::int AS value
        FROM agent_sessions s
       WHERE s.workspace_id = ${ctx.workspaceId}
         AND s.started_at >= ${since}
         AND s.started_at <  ${until}
         ${filterSql}
    `);
    const rows = result.rows as Array<{ key: string; value: number | string }>;
    return rows.map((row) => ({ key: row.key, value: Number(row.value) }));
  }

  const dim: DimensionName = req.dimension;
  const join = dimJoin(dim);
  const keyExpr = dimKeyExpr(dim);
  const groupBy = dimGroupBy(dim);

  const result = await ctx.db.execute(sql`
    SELECT ${keyExpr} AS key, COUNT(*)::int AS value
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
  const rows = result.rows as Array<{ key: string; value: number | string }>;
  return rows.map((row) => ({ key: row.key, value: Number(row.value) }));
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
