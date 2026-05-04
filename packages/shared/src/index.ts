/**
 * @agentwatch/shared — package entry.
 *
 * Privacy (D-26 / D-27 / Pitfall 4 / Pitfall 13):
 *   `hashTitle()` is the ONLY function permitted to read raw issue titles.
 *   `TitleHash` is a branded string — assigning a non-branded string to a
 *   `TitleHash`-typed field is a compile-time error.
 *
 * Query API (API-02 / API-04 / API-05):
 *   `MetricName`, `DimensionName`, `QueryRequest`, `QueryResponse` are
 *   closed Zod enums — the dispatcher (Plan 01.06) maps them to STATIC SQL
 *   functions. `parse()` throws on any out-of-set value, making arbitrary-SQL
 *   injection a runtime impossibility before the dispatcher even runs.
 *
 * SDK events (INGEST-03 / D-10):
 *   `SdkEventBody` is a Zod discriminated union over `session_start`,
 *   `session_end`, `cost_recorded` — validated at the SDK endpoint boundary.
 *   `cost_usd` is non-negative; `tokens_in`/`tokens_out` are non-negative ints.
 */
export * from './privacy';
export * from './query';
export * from './events';
