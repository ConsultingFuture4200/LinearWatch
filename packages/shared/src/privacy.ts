import { createHash } from 'node:crypto';

/**
 * Branded string type for hashed issue titles.
 *
 * The ONLY way to obtain a value of type `TitleHash` is to call `hashTitle()`.
 * Drizzle's `issues.title_hash` column is typed as `TitleHash`, which makes
 * "accidentally insert a raw title string" a TypeScript compile error.
 *
 * D-26 (CONTEXT.md): "issues Drizzle schema has title_hash: TitleHash as the
 * column type — there is no title: string field anywhere on the row."
 *
 * The `__brand` field is a phantom — it does not exist at runtime.
 */
export type TitleHash = string & { readonly __brand: 'TitleHash' };

/**
 * The ONLY function permitted to read raw issue titles in the codebase.
 *
 * Algorithm (D-27):
 *   sha256(workspace_salt + ":" + raw.trim().toLowerCase())
 *
 * The workspace salt is generated at workspace creation (Plan 01.07 setup wizard)
 * and stored on `workspaces.workspace_salt`. Same title under same workspace
 * → same hash; different workspaces → different hashes (defense against
 * cross-workspace lookup attacks if hashes ever leak to the telemetry aggregator).
 *
 * Pitfalls 4 / 13: this is the single chokepoint for raw-title reads. The
 * branded return type makes a stray `issues.titleHash = 'raw'` a compile error.
 */
export function hashTitle(rawTitle: string, workspaceSalt: string): TitleHash {
  const normalized = rawTitle.trim().toLowerCase();
  const digest = createHash('sha256').update(`${workspaceSalt}:${normalized}`).digest('hex');
  return digest as TitleHash;
}
