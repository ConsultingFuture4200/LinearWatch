import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WizardStepIndicator } from '@/components/wizard-step-indicator';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

/**
 * Step 4 — GitHub PAT (optional).
 *
 * The PAT is stored in an httpOnly cookie until step 5 (workspace creation)
 * persists it via POST /api/v1/setup/github-pat using the freshly minted
 * workspace API key. This avoids requiring the user to refresh / set env
 * vars mid-wizard.
 */
const PAT_COOKIE = 'agw_setup_github_pat';
const HEADING = 'Add a GitHub Personal Access Token (optional).';
const BODY =
  'Phase 2 uses this token to enrich agent sessions with PR merge/revert outcomes — that\'s how the "Cost / closed issue" column gets populated. You can skip this now and add it later from Settings.';

async function savePatAction(formData: FormData): Promise<void> {
  'use server';
  const pat = String(formData.get('pat') ?? '').trim();
  const c = await cookies();
  if (pat) {
    c.set(PAT_COOKIE, pat, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 30,
    });
  }
  redirect('/setup/workspace');
}

async function skipPatAction(): Promise<void> {
  'use server';
  const c = await cookies();
  c.delete(PAT_COOKIE);
  redirect('/setup/workspace');
}

export default function GithubPatPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">
      <WizardStepIndicator current={4} />
      <div className="space-y-4">
        <h1 className="text-[28px] font-semibold leading-tight">{HEADING}</h1>
        <p className="text-sm text-muted-foreground">{BODY}</p>
      </div>
      <form action={savePatAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pat">GitHub PAT</Label>
          <Input id="pat" name="pat" type="password" placeholder="ghp_…" autoComplete="off" />
          <p className="text-xs text-muted-foreground">
            Required scopes: <code className="font-mono">repo</code>,{' '}
            <code className="font-mono">read:org</code>. Stored encrypted at rest. Used only by the
            enrichment worker.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">Save and continue</Button>
          <form action={skipPatAction}>
            <Button type="submit" variant="ghost">
              Skip — I'll add this later
            </Button>
          </form>
          <Button variant="ghost" asChild>
            <Link href="/setup/linear-oauth">Back</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
