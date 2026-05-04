/**
 * Privacy primitives shared across the agentwatch monorepo.
 *
 * P1 scope (this commit): expose the `TitleHash` branded type so that
 * the Drizzle schema in `@agentwatch/db` can type the `issues.title_hash`
 * column without a `title: string` field anywhere on the row (D-26 / Pitfall 13).
 *
 * Plan 01.03 lands `hashTitle(raw: string, workspaceSalt: string): TitleHash`,
 * the only function permitted to produce a `TitleHash`. Until then, the brand
 * still prevents accidental string-literal insertion at compile time.
 */

/**
 * Branded string type representing a hashed Linear issue title.
 *
 * Construction is restricted to `hashTitle()` in this package (lands in 01.03).
 * The `__brand` field is a phantom — it does not exist at runtime.
 */
export type TitleHash = string & { readonly __brand: 'TitleHash' };
