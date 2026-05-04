'use client';

import { IdentitySidePanel } from '@/components/identity-side-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UnconfirmedBadge } from '@/components/unconfirmed-badge';
import { useState } from 'react';

/**
 * UI-SPEC §Cost dashboard view — table card.
 *
 * Columns: Agent | Sessions | Total cost | Cost / closed issue
 *   - Money values use `tabular-nums` so columns align.
 *   - "Cost / closed issue" is `—` with the verbatim header tooltip
 *     "Available once GitHub PR enrichment is configured (Phase 2)."
 *   - Unconfirmed agents render `<UnconfirmedBadge />` next to their name;
 *     clicking opens the identity side panel.
 *
 * P1 caveat: the query API doesn't expose `agent_id` or
 * `linear_app_user_id` on the row (the metric returns
 * `{key, value, count}`), so the side panel here uses a synthetic id
 * (the agent name) and an empty linear_app_user_id placeholder. The
 * confirm action is wired but no-op until 01.09 wizard seeds real data
 * with agent metadata exposed via a P2 metric extension. Documented in
 * 01-08-SUMMARY.md.
 */
export interface AgentRow {
  /** Agent display name (also used as key in P1). */
  key: string;
  /** Total cost over the window in USD. */
  value: number;
  /** Number of sessions in the window. */
  count?: number;
  /** Whether the agent's identity is unconfirmed (state machine D-16). */
  unconfirmed?: boolean;
  /** Stable agent id for the confirm endpoint; falls back to `key` in P1. */
  agentId?: string;
  /** Candidate linear_app_user_id surfaced for confirmation. */
  linearAppUserId?: string;
}

interface AgentsTableProps {
  agentRows: AgentRow[];
}

export function AgentsTable({ agentRows }: AgentsTableProps): React.JSX.Element {
  const [openAgent, setOpenAgent] = useState<AgentRow | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Total cost</TableHead>
                <TableHead className="text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help underline underline-offset-4 decoration-muted-foreground decoration-dotted">
                        Cost / closed issue
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        Available once GitHub PR enrichment is configured (Phase 2).
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agentRows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{row.key}</span>
                      {row.unconfirmed ? (
                        <UnconfirmedBadge onClick={() => setOpenAgent(row)} />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.count ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">${row.value.toFixed(2)}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">—</TableCell>
                </TableRow>
              ))}
              {agentRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    No agents in this window.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <IdentitySidePanel
        open={openAgent !== null}
        onOpenChange={(open) => {
          if (!open) setOpenAgent(null);
        }}
        agent={openAgent}
      />
    </>
  );
}
