import Link from 'next/link';

/**
 * UI-SPEC §P2 stub pages — Reliability tab. Verbatim copy.
 *
 * The slot is reserved in P1 so links and bookmarks remain stable when
 * the real Reliability view ships in Phase 2 (Enrichment).
 */
export default function ReliabilityPage(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-screen-2xl px-6 py-12">
      <h1 className="text-[28px] font-semibold leading-tight">
        Reliability — available in Phase 2
      </h1>
      <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
        This view ships in Phase 2 (Enrichment) once GitHub PR enrichment and cross-source identity
        resolution land. The navigation slot is reserved so links and bookmarks remain stable.
      </p>
      <Link
        href="/docs/roadmap"
        className="mt-6 inline-block text-sm text-foreground underline underline-offset-4 decoration-muted-foreground hover:decoration-foreground"
      >
        View the roadmap
      </Link>
    </main>
  );
}
