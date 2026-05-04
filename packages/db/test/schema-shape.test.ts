import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  agentSessions,
  agents,
  alertEvents,
  costByAgentDaily,
  cycles,
  identityMappings,
  issues,
  repos,
  teams,
  workspaceWarnings,
  workspaces,
} from '../src/schema';

const cols = (tbl: Parameters<typeof getTableConfig>[0]): string[] =>
  getTableConfig(tbl).columns.map((c) => c.name);

describe('schema shape — Pitfall 13 / D-26 (issues table has no `title`)', () => {
  it('issues has title_hash and NO title column', () => {
    const issueCols = cols(issues);
    expect(issueCols).toContain('title_hash');
    expect(issueCols).not.toContain('title');
  });
});

describe('schema shape — P2 GDPR purge (PRIV-04)', () => {
  it('agents has deleted_at for soft delete', () => {
    expect(cols(agents)).toContain('deleted_at');
  });
});

describe('schema shape — Pitfall 7 (vendor cost re-poll guard)', () => {
  it('agent_sessions has cost_enriched_at', () => {
    expect(cols(agentSessions)).toContain('cost_enriched_at');
  });
});

describe('schema shape — D-15/D-16 resolver state', () => {
  it('identity_mappings has confidence, signal_weights, and state', () => {
    expect(cols(identityMappings)).toEqual(
      expect.arrayContaining(['confidence', 'signal_weights', 'state']),
    );
  });
});

describe('schema shape — D-27 title hashing salt', () => {
  it('workspaces has workspace_salt', () => {
    expect(cols(workspaces)).toContain('workspace_salt');
  });

  it('workspaces has api_key_hash and store_titles_plain (D-14, PRIV-02)', () => {
    expect(cols(workspaces)).toEqual(
      expect.arrayContaining(['api_key_hash', 'store_titles_plain']),
    );
  });
});

describe('schema shape — Pitfall 10 fact-table columns', () => {
  it('agent_sessions has the analytics columns from PRD §6.1', () => {
    expect(cols(agentSessions)).toEqual(
      expect.arrayContaining([
        'workspace_id',
        'agent_id',
        'issue_id',
        'team_id',
        'cycle_id',
        'repo_id',
        'cost_usd',
        'tokens_in',
        'tokens_out',
        'outcome',
        'started_at',
        'ended_at',
        'reverted_at',
      ]),
    );
  });
});

describe('schema shape — dimension tables exist', () => {
  it.each([
    ['teams', teams],
    ['cycles', cycles],
    ['repos', repos],
    ['workspace_warnings', workspaceWarnings],
    ['alert_events', alertEvents],
    ['cost_by_agent_daily', costByAgentDaily],
  ])('%s has workspace_id', (_name, tbl) => {
    expect(cols(tbl)).toContain('workspace_id');
  });
});
