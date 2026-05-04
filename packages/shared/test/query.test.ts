import { describe, expect, it } from 'vitest';
import { SdkEventBody } from '../src/events';
import { DimensionName, MetricName, QueryRequest } from '../src/query';

describe('MetricName', () => {
  it('accepts P1 metrics', () => {
    expect(() => MetricName.parse('cost_by_agent')).not.toThrow();
    expect(() => MetricName.parse('agent_session_count')).not.toThrow();
  });

  it('rejects unknown metrics (API-02)', () => {
    expect(() => MetricName.parse('arbitrary_sql_injection')).toThrow();
    expect(() => MetricName.parse('revert_rate')).toThrow(); // P2 metric
  });

  it('exposes exactly the two P1 enum values', () => {
    expect(MetricName.options).toEqual(['cost_by_agent', 'agent_session_count']);
  });
});

describe('DimensionName', () => {
  it('accepts P1 dimensions only', () => {
    for (const d of ['agent', 'team', 'cycle']) {
      expect(() => DimensionName.parse(d)).not.toThrow();
    }
  });

  it('rejects P2 dimensions', () => {
    expect(() => DimensionName.parse('repo')).toThrow();
    expect(() => DimensionName.parse('model_tier')).toThrow();
  });

  it('exposes exactly the three P1 enum values', () => {
    expect(DimensionName.options).toEqual(['agent', 'team', 'cycle']);
  });
});

describe('QueryRequest', () => {
  it('accepts a minimal cost_by_agent request', () => {
    expect(() =>
      QueryRequest.parse({
        metric: 'cost_by_agent',
        window: { last: '14d' },
      }),
    ).not.toThrow();
  });

  it('accepts a fully-specified request with filters', () => {
    expect(() =>
      QueryRequest.parse({
        metric: 'cost_by_agent',
        dimension: 'team',
        filters: [{ field: 'team_id', op: 'eq', value: 'uuid-1' }],
        window: { last: '30d' },
      }),
    ).not.toThrow();
  });

  it('accepts an absolute window with from/to', () => {
    expect(() =>
      QueryRequest.parse({
        metric: 'agent_session_count',
        window: { from: '2026-04-01T00:00:00Z', to: '2026-05-01T00:00:00Z' },
      }),
    ).not.toThrow();
  });

  it('rejects request without window', () => {
    expect(() => QueryRequest.parse({ metric: 'cost_by_agent' })).toThrow();
  });

  it('rejects window with neither `last` nor `from+to`', () => {
    expect(() =>
      QueryRequest.parse({
        metric: 'cost_by_agent',
        window: {},
      }),
    ).toThrow();
  });

  it('rejects window.last with bad format', () => {
    expect(() =>
      QueryRequest.parse({
        metric: 'cost_by_agent',
        window: { last: '14days' },
      }),
    ).toThrow();
  });
});

describe('SdkEventBody', () => {
  it('parses session_start with required fields', () => {
    expect(() =>
      SdkEventBody.parse({
        event_type: 'session_start',
        session_id: 's-1',
        agent_name: 'cursor-demo',
        occurred_at: '2026-05-04T00:00:00Z',
      }),
    ).not.toThrow();
  });

  it('parses session_end with outcome', () => {
    expect(() =>
      SdkEventBody.parse({
        event_type: 'session_end',
        session_id: 's-1',
        occurred_at: '2026-05-04T00:00:00Z',
        outcome: 'closed',
      }),
    ).not.toThrow();
  });

  it('parses cost_recorded with cost_usd', () => {
    expect(() =>
      SdkEventBody.parse({
        event_type: 'cost_recorded',
        session_id: 's-1',
        occurred_at: '2026-05-04T00:00:00Z',
        cost_usd: 1.42,
      }),
    ).not.toThrow();
  });

  it('accepts an optional caller-supplied idempotency_key (D-10)', () => {
    expect(() =>
      SdkEventBody.parse({
        event_type: 'session_start',
        session_id: 's-1',
        agent_name: 'cursor-demo',
        occurred_at: '2026-05-04T00:00:00Z',
        idempotency_key: 'caller-key-abc-123',
      }),
    ).not.toThrow();
  });

  it('rejects unknown event_type', () => {
    expect(() =>
      SdkEventBody.parse({
        event_type: 'unknown',
        session_id: 's-1',
        occurred_at: '2026-05-04T00:00:00Z',
      }),
    ).toThrow();
  });

  it('rejects negative cost_usd', () => {
    expect(() =>
      SdkEventBody.parse({
        event_type: 'cost_recorded',
        session_id: 's-1',
        occurred_at: '2026-05-04T00:00:00Z',
        cost_usd: -1,
      }),
    ).toThrow();
  });

  it('rejects non-int tokens_in', () => {
    expect(() =>
      SdkEventBody.parse({
        event_type: 'cost_recorded',
        session_id: 's-1',
        occurred_at: '2026-05-04T00:00:00Z',
        cost_usd: 1.0,
        tokens_in: 1.5,
      }),
    ).toThrow();
  });
});
