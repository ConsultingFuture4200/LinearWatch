'use server';

import { confirmAgent } from '@/lib/api';

/**
 * Server Action invoked by the identity side panel client component.
 *
 * Wraps the server-only `confirmAgent` HTTP call so the client component
 * can `await` it as if it were a regular function. Next.js handles the
 * RPC plumbing — the AGENTWATCH_INTERNAL_API_KEY never reaches the
 * browser (T-08-01).
 *
 * Errors propagate to the client as thrown exceptions, which the panel
 * catches and surfaces via sonner toast per UI-SPEC §After-confirm error
 * toast.
 */
export async function confirmAgentAction(
  agentId: string,
  linearAppUserId: string,
): Promise<{ ok: boolean; confirmed_count: number }> {
  return confirmAgent(agentId, linearAppUserId);
}
