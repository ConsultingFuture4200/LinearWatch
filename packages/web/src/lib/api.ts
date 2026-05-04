/**
 * Server-only HTTP wrappers around the agentwatch internal API.
 *
 * These functions read `AGENTWATCH_INTERNAL_URL` and
 * `AGENTWATCH_INTERNAL_API_KEY` from the server process env. They MUST
 * NOT be imported from client components — Next.js inlines non-NEXT_PUBLIC
 * env at build time only on the server side, so a client import would
 * resolve to `undefined` at runtime AND would be a T-08-01 violation if
 * the key were ever inlined.
 */

interface ConfirmResponse {
  ok: boolean;
  confirmed_count: number;
}

export interface WorkspaceWarning {
  id: string;
  severity: string;
  message: string;
}

interface WarningsResponse {
  warnings: WorkspaceWarning[];
}

interface SeedStatusResponse {
  has_seed: boolean;
}

function internalHeaders(): HeadersInit {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${process.env.AGENTWATCH_INTERNAL_API_KEY ?? ''}`,
  };
}

/**
 * Confirm an agent identity from the dashboard side panel (DASH-04 / D-17).
 * Used as a Server Action invoked by the IdentitySidePanel client component.
 */
export async function confirmAgent(
  agentId: string,
  linearAppUserId: string,
): Promise<ConfirmResponse> {
  const url = `${process.env.AGENTWATCH_INTERNAL_URL}/api/v1/agents/${encodeURIComponent(agentId)}/confirm`;
  const r = await fetch(url, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify({ linear_app_user_id: linearAppUserId }),
    cache: 'no-store',
  });
  if (!r.ok) {
    throw new Error(`confirm failed: ${r.status}`);
  }
  return (await r.json()) as ConfirmResponse;
}

/**
 * Fetch active (non-dismissed) workspace warnings written by the
 * detect_shared_app heuristic (D-18). Renders into the
 * WorkspaceWarningsBanner in the dashboard layout.
 */
export async function fetchActiveWarnings(): Promise<WorkspaceWarning[]> {
  const url = `${process.env.AGENTWATCH_INTERNAL_URL}/api/v1/workspace/warnings`;
  const r = await fetch(url, {
    headers: internalHeaders(),
    cache: 'no-store',
  });
  if (!r.ok) return [];
  const json = (await r.json()) as WarningsResponse;
  return json.warnings ?? [];
}

/**
 * Returns true when at least one workspace row exists. The dashboard layout
 * uses this to redirect to `/setup` on first boot before any wizard step has
 * created the workspace + API key. Probes the seed-status endpoint, which
 * returns 401 `{"error":"no_workspace"}` when the workspace context cannot
 * be resolved.
 */
export async function hasWorkspace(): Promise<boolean> {
  const url = `${process.env.AGENTWATCH_INTERNAL_URL}/api/v1/workspace/seed-status`;
  try {
    const r = await fetch(url, {
      headers: internalHeaders(),
      cache: 'no-store',
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

/**
 * Returns true when any agent row in the workspace has a name ending in
 * `-demo` — the simplest signal the dashboard can use to decide whether
 * to render the synthetic-data banner (D-07). Server-side endpoint added
 * in this plan; documented in the SUMMARY.
 */
export async function fetchSeedStatus(): Promise<boolean> {
  const url = `${process.env.AGENTWATCH_INTERNAL_URL}/api/v1/workspace/seed-status`;
  const r = await fetch(url, {
    headers: internalHeaders(),
    cache: 'no-store',
  });
  if (!r.ok) return false;
  const json = (await r.json()) as SeedStatusResponse;
  return Boolean(json.has_seed);
}
