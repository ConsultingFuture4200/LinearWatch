'use server';

import { getSetupKeyCookie, postSeed } from '@/lib/setup';
import { redirect } from 'next/navigation';

/**
 * Step 6 actions — wired from the seed step page.
 *
 * `seedAction` reads the plaintext key from the setup cookie, posts to
 * /api/v1/seed, and redirects to /setup/done. The synthetic-data banner
 * will appear on /cost automatically once any -demo agent exists.
 *
 * `skipSeedAction` simply advances to step 7 without inserting demo data.
 */
export async function seedAction(): Promise<void> {
  const key = await getSetupKeyCookie();
  if (!key) {
    redirect('/setup/workspace?error=missing_key');
  }
  await postSeed(key);
  redirect('/setup/done');
}

export async function skipSeedAction(): Promise<void> {
  redirect('/setup/done');
}
