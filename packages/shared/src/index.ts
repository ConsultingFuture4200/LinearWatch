/**
 * @agentwatch/shared — package entry.
 *
 * Privacy (D-26 / D-27 / Pitfall 4 / Pitfall 13):
 *   `hashTitle()` is the ONLY function permitted to read raw issue titles.
 *   `TitleHash` is a branded string — assigning a non-branded string to a
 *   `TitleHash`-typed field is a compile-time error.
 *
 * Query API (lands in Task 2): `MetricName`, `DimensionName`, `QueryRequest`.
 * SDK events (lands in Task 2): `SdkEventBody` discriminated union.
 */
export * from './privacy';
