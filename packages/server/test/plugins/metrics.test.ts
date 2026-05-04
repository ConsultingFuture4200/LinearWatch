import client from 'prom-client';
import { describe, expect, it } from 'vitest';
import {
  enrichmentLagSeconds,
  eventsReceived,
  jobsQueueDepth,
  resolverConfidenceHistogram,
  webhookAckSeconds,
} from '../../src/plugins/metrics';

describe('metrics registry (D-30)', () => {
  it('exports all five named metrics with the agentwatch_ prefix', async () => {
    eventsReceived.inc({ source: 'linear' }, 0);
    webhookAckSeconds.observe({ source: 'linear' }, 0.001);
    jobsQueueDepth.set({ job_name: 'resolve_identity' }, 0);
    resolverConfidenceHistogram.observe(0.5);
    enrichmentLagSeconds.set({ source: 'linear' }, 0);

    const text = await client.register.metrics();
    expect(text).toContain('agentwatch_events_received_total');
    expect(text).toContain('agentwatch_webhook_ack_seconds');
    expect(text).toContain('agentwatch_jobs_queue_depth');
    expect(text).toContain('agentwatch_identity_resolver_confidence');
    expect(text).toContain('agentwatch_enrichment_lag_seconds');
  });

  it('webhook_ack_seconds buckets cover the 200ms SLA', async () => {
    // Force at least one observation so the histogram serializes its buckets.
    webhookAckSeconds.observe({ source: 'linear' }, 0.001);
    const text = await client.register.metrics();
    // Prom-client serialises buckets as `le="0.2"` (etc.) in the exposition.
    expect(text).toMatch(/agentwatch_webhook_ack_seconds_bucket\{[^}]*le="0\.2"/);
  });
});
