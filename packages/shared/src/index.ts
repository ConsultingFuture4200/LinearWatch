/**
 * @agentwatch/shared — package entry.
 *
 * P1 (this plan, 01.02) needs only the `TitleHash` branded type so that
 * `packages/db/src/schema/issues.ts` typechecks without a full `hashTitle`
 * implementation. Plan 01.03 lands `hashTitle()` and the rest of the
 * shared utilities (Zod metric/dimension enums, event types, etc.).
 */
export type { TitleHash } from './privacy';
