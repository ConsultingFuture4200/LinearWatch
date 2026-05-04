import { redirect } from 'next/navigation';

/**
 * Root path redirects to the cost view — UI-SPEC §App shell makes Cost the
 * active P1 tab. Reliability + Lineage are P2 stubs in the same nav.
 */
export default function Home(): never {
  redirect('/cost');
}
