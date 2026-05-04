import { randomUUID } from 'node:crypto';
import { hashTitle } from '@linearwatch/shared';
import { sql } from 'drizzle-orm';
import type { ServerDb } from '../db.js';

/**
 * D-07 — synthetic-data seed for the cost dashboard.
 *
 * Inserts ~50 synthetic agent sessions across 14 days, 3 demo agents
 * (`cursor-demo`, `devin-demo`, `internal-bot-demo`), 2 teams, 1 cycle,
 * distributed across cost buckets so the cost view renders multiple
 * states. One day is intentionally an anomaly (>3x rolling avg).
 *
 * Pitfall 13: every issue title flows through `hashTitle()` from
 * `@linearwatch/shared` — there is NO `title` column on `issues`.
 *
 * Idempotent: if a `*-demo` agent already exists for the workspace,
 * returns `{ inserted: 0 }` without re-seeding. The wizard's seed step
 * is therefore safe to re-run.
 */
export interface SeedResult {
  inserted: number;
}

interface AgentDef {
  id: string;
  name: string;
  vendor: string;
}

interface IssueDef {
  id: string;
  linearId: string;
  title: string;
}

interface SessionBucket {
  agentIdx: number;
  teamId: string;
  cost: number;
  issueIdx: number;
}

interface CountRow {
  n: number;
}

export async function insertSyntheticData(
  db: ServerDb,
  workspaceId: string,
  salt: string,
): Promise<SeedResult> {
  // Idempotent guard.
  const existing = await db.execute(sql`
    SELECT count(*)::int AS n
      FROM agents
     WHERE workspace_id = ${workspaceId}
       AND name LIKE '%-demo'
       AND deleted_at IS NULL
  `);
  const n = (existing.rows[0] as CountRow | undefined)?.n ?? 0;
  if (n > 0) return { inserted: 0 };

  // Two demo teams.
  const teamA = randomUUID();
  const teamB = randomUUID();
  await db.execute(sql`
    INSERT INTO teams (id, workspace_id, linear_id, key, name) VALUES
      (${teamA}, ${workspaceId}, 'demo-team-a', 'ENG', 'Engineering (demo)'),
      (${teamB}, ${workspaceId}, 'demo-team-b', 'OPS', 'Operations (demo)')
  `);

  // One demo cycle (Sprint 1).
  const cycleA = randomUUID();
  await db.execute(sql`
    INSERT INTO cycles (id, workspace_id, team_id, linear_id, name, starts_at, ends_at)
    VALUES (
      ${cycleA}, ${workspaceId}, ${teamA}, 'demo-cycle-a', 'Sprint 1 (demo)',
      now() - interval '14 days', now() + interval '7 days'
    )
  `);

  // Three demo agents.
  const agents: AgentDef[] = [
    { id: randomUUID(), name: 'cursor-demo', vendor: 'cursor' },
    { id: randomUUID(), name: 'devin-demo', vendor: 'devin' },
    { id: randomUUID(), name: 'internal-bot-demo', vendor: 'internal' },
  ];
  for (const a of agents) {
    await db.execute(sql`
      INSERT INTO agents (id, workspace_id, name, vendor, linear_app_user_id)
      VALUES (${a.id}, ${workspaceId}, ${a.name}, ${a.vendor}, ${`lap-demo-${a.name}`})
    `);
  }

  // Three demo issues. Titles flow through hashTitle — no raw title column.
  const issues: IssueDef[] = [
    {
      id: randomUUID(),
      linearId: 'DEMO-1',
      title: '[DEMO] Investigate flaky test in payment service',
    },
    {
      id: randomUUID(),
      linearId: 'DEMO-2',
      title: '[DEMO] Refactor user-profile API for new schema',
    },
    {
      id: randomUUID(),
      linearId: 'DEMO-3',
      title: '[DEMO] Add retry logic to webhook receiver',
    },
  ];
  for (const i of issues) {
    const titleHash = hashTitle(i.title, salt);
    await db.execute(sql`
      INSERT INTO issues (id, workspace_id, linear_id, team_id, cycle_id, title_hash)
      VALUES (${i.id}, ${workspaceId}, ${i.linearId}, ${teamA}, ${cycleA}, ${titleHash})
    `);
  }

  // Distribute ~50 sessions across 14 days, 3 agents, 2 teams.
  // Deterministic-enough cost distribution (no Math.random in tests would be
  // brittle; we accept jitter since the dashboard verifies "shape" not exact $).
  const buckets: SessionBucket[] = [];
  for (let i = 0; i < 24; i++) {
    buckets.push({ agentIdx: 0, teamId: teamA, cost: 0.4 + Math.random() * 4, issueIdx: i % 3 });
  }
  for (let i = 0; i < 18; i++) {
    buckets.push({ agentIdx: 1, teamId: teamB, cost: 1.0 + Math.random() * 7, issueIdx: i % 3 });
  }
  for (let i = 0; i < 8; i++) {
    buckets.push({ agentIdx: 2, teamId: teamA, cost: 0.4 + Math.random() * 1, issueIdx: i % 3 });
  }
  // Inject one anomaly day: 20 USD on cursor-demo (>3x rolling avg).
  if (buckets[0]) buckets[0].cost = 20;

  const dayMs = 86_400_000;
  const startTime = Date.now() - 14 * dayMs;
  let inserted = 0;
  for (let idx = 0; idx < buckets.length; idx++) {
    const b = buckets[idx];
    if (!b) continue;
    const agent = agents[b.agentIdx];
    const issue = issues[b.issueIdx];
    if (!agent || !issue) continue;
    const startedAt = new Date(startTime + (idx % 14) * dayMs + idx * 1000);
    const endedAt = new Date(startedAt.getTime() + 60_000);
    const costStr = b.cost.toFixed(2);
    const vendorSessionId = `${agent.name}-${idx}`;
    await db.execute(sql`
      INSERT INTO agent_sessions (
        workspace_id, agent_id, issue_id, team_id, cycle_id,
        vendor_session_id, model_tier, cost_usd, started_at, ended_at
      )
      VALUES (
        ${workspaceId}, ${agent.id}, ${issue.id}, ${b.teamId}, ${cycleA},
        ${vendorSessionId}, 'mid', ${costStr}::float8,
        ${startedAt}, ${endedAt}
      )
    `);
    inserted++;
  }
  return { inserted };
}

/**
 * Hard-delete every demo row in the workspace. Used by
 * `POST /api/v1/admin/clear-seed` and the future `linearwatch admin clear-seed`
 * CLI command (P2). Demo rows are synthetic; we don't soft-delete.
 *
 * Order: agent_sessions → identity_mappings → issues → agents → cycles → teams,
 * because of FK constraints. Demo cycles are scoped by `linear_id LIKE 'demo-%'`
 * because cycles do not have a name marker.
 */
export interface ClearSeedResult {
  deleted_agents: number;
  deleted_sessions: number;
  deleted_issues: number;
  deleted_cycles: number;
  deleted_teams: number;
}

export async function clearSyntheticData(
  db: ServerDb,
  workspaceId: string,
): Promise<ClearSeedResult> {
  const sessRes = await db.execute(sql`
    DELETE FROM agent_sessions
     WHERE workspace_id = ${workspaceId}
       AND agent_id IN (
         SELECT id FROM agents
          WHERE workspace_id = ${workspaceId}
            AND name LIKE '%-demo'
       )
    RETURNING id
  `);
  const idmRes = await db.execute(sql`
    DELETE FROM identity_mappings
     WHERE workspace_id = ${workspaceId}
       AND agent_id IN (
         SELECT id FROM agents
          WHERE workspace_id = ${workspaceId}
            AND name LIKE '%-demo'
       )
    RETURNING id
  `);
  void idmRes;
  const issuesRes = await db.execute(sql`
    DELETE FROM issues
     WHERE workspace_id = ${workspaceId}
       AND linear_id LIKE 'DEMO-%'
    RETURNING id
  `);
  const agentsRes = await db.execute(sql`
    DELETE FROM agents
     WHERE workspace_id = ${workspaceId}
       AND name LIKE '%-demo'
    RETURNING id
  `);
  const cyclesRes = await db.execute(sql`
    DELETE FROM cycles
     WHERE workspace_id = ${workspaceId}
       AND linear_id LIKE 'demo-%'
    RETURNING id
  `);
  const teamsRes = await db.execute(sql`
    DELETE FROM teams
     WHERE workspace_id = ${workspaceId}
       AND linear_id LIKE 'demo-%'
    RETURNING id
  `);

  return {
    deleted_sessions: sessRes.rows.length,
    deleted_issues: issuesRes.rows.length,
    deleted_agents: agentsRes.rows.length,
    deleted_cycles: cyclesRes.rows.length,
    deleted_teams: teamsRes.rows.length,
  };
}
