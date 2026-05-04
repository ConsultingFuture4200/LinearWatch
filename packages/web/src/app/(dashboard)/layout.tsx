import { NavTabs } from '@/components/nav-tabs';
import { SyntheticDataBanner } from '@/components/synthetic-data-banner';
import { ThemeToggle } from '@/components/theme-toggle';
import { WorkspaceWarningsBanner } from '@/components/workspace-warnings-banner';
import { fetchActiveWarnings, fetchSeedStatus } from '@/lib/api';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * UI-SPEC §App shell & navigation — top nav layout that wraps every
 * page in the (dashboard) route group: cost, reliability (P2 stub),
 * lineage (P2 stub), settings.
 *
 * Banners are server-rendered: the dashboard reads workspace_warnings
 * and seed-status through the internal query API on every request. This
 * avoids a client-side fetch + flicker on initial paint.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const [warnings, hasSeed] = await Promise.all([
    fetchActiveWarnings().catch(() => []),
    fetchSeedStatus().catch(() => false),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <nav className="mx-auto flex h-14 max-w-screen-2xl items-center gap-6 px-6">
          <Link href="/cost" className="font-mono text-sm text-foreground">
            agentwatch
          </Link>
          <div className="flex-1">
            <NavTabs />
          </div>
          <Link
            href="/settings"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Settings
          </Link>
          <ThemeToggle />
        </nav>
      </header>
      {hasSeed ? <SyntheticDataBanner /> : null}
      <WorkspaceWarningsBanner warnings={warnings} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
