import type { QueryRequest, QueryResponse } from '@linearwatch/shared';

/**
 * The single typed client for `POST /api/v1/query` (DASH-01 / API-07).
 *
 * No React component should bypass this; the API-07 lint guard verifies
 * that no file under `packages/web/src/` imports `pg` or `drizzle-orm`.
 *
 * This function is server-only — it reads `LINEARWATCH_INTERNAL_API_KEY`
 * from the process env. Next.js does NOT inline non-`NEXT_PUBLIC_` env
 * vars into client bundles, so the Bearer key never reaches the browser
 * (T-08-01 mitigation).
 */
export async function fetchQuery(req: QueryRequest): Promise<QueryResponse> {
  const url = `${process.env.LINEARWATCH_INTERNAL_URL}/api/v1/query`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.LINEARWATCH_INTERNAL_API_KEY ?? ''}`,
    },
    body: JSON.stringify(req),
    cache: 'no-store',
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`query failed: ${r.status} ${text}`);
  }
  return (await r.json()) as QueryResponse;
}
