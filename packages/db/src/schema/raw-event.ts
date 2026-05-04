import {
  bigserial,
  boolean,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * `events.raw_event` — informational Drizzle mirror of the partitioned parent.
 *
 * The actual partitioning DDL (`PARTITION BY RANGE (received_at)`) lives ONLY in
 * `migrations/0000_init.sql` because Drizzle has no partition DSL. Running
 * `drizzle-kit generate` would emit a non-partitioned `CREATE TABLE` for this
 * row — DO NOT use the generated SQL for raw_event.
 *
 * This file exists so:
 * 1. Server/worker code can import the table reference for typed inserts.
 * 2. The drizzle-kit snapshot tracks the columns (it intentionally does not
 *    track the partition strategy).
 *
 * Idempotency: UNIQUE (source, upstream_id, received_at) — Pitfall 1 dedup key.
 * NO GIN index on `payload` — Pitfall 9 (raw store is for replay, not query).
 */
export const eventsSchema = pgSchema('events');

export const rawEvent = eventsSchema.table(
  'raw_event',
  {
    id: bigserial('id', { mode: 'bigint' }),
    source: text('source').notNull(),
    upstreamId: text('upstream_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.receivedAt] }),
    uniqDelivery: unique().on(t.source, t.upstreamId, t.receivedAt),
  }),
);
