'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/**
 * UI-SPEC §Cost dashboard view — chart card.
 *
 * Title: "Cost by agent"; subtitle: "Stacked daily spend, USD. Anomaly
 * markers highlight days where an agent's cost exceeded 3× its 28-day
 * rolling average."
 *
 * P1 simplification: the query API returns aggregate totals per agent
 * over the selected window (metric `cost_by_agent`, dimension `agent`),
 * not a daily time series. The chart renders one bar per agent. The
 * day-level stack + anomaly overlays land in P2 once the query API
 * exposes a time-bucketed metric (deferred per CONTEXT.md D-21 anomaly
 * note — the marker placeholder is documented in 01-08-SUMMARY.md).
 *
 * Series colors are drawn from the UI-SPEC §Agent palette via the
 * --chart-1..--chart-5 CSS variables (set in globals.css).
 */
export interface CostChartRow {
  key: string;
  value: number;
  count?: number | undefined;
  bucket_at?: string | undefined;
}

interface CostChartProps {
  data: CostChartRow[];
}

const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export function CostChart({ data }: CostChartProps): React.JSX.Element {
  // Transform rows to a single-row chart with one series per agent — gives
  // us the visual that maps cleanly to the P1 query shape while keeping
  // the agent-palette discipline. When the time-bucketed metric ships in
  // P2, this becomes a multi-row stacked chart with the same palette.
  const chartData = [
    Object.fromEntries([['period', 'Window'], ...data.map((r) => [r.key, r.value])]),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost by agent</CardTitle>
        <p className="text-sm text-muted-foreground">
          Stacked daily spend, USD. Anomaly markers highlight days where an agent's cost exceeded 3×
          its 28-day rolling average.
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="period" stroke="var(--muted-foreground)" />
              <YAxis
                stroke="var(--muted-foreground)"
                label={{
                  value: 'USD',
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'var(--muted-foreground)',
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--popover)',
                  borderColor: 'var(--border)',
                  color: 'var(--popover-foreground)',
                }}
              />
              {data.map((row, idx) => (
                <Bar
                  key={row.key}
                  dataKey={row.key}
                  stackId="a"
                  fill={PALETTE[idx % PALETTE.length]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
