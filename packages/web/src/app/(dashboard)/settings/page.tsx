import { MonoCopyBlock } from '@/components/mono-copy-block';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { SettingsActions } from './settings-actions';

/**
 * UI-SPEC §Settings page (minimal in P1) — three cards:
 *   1. Workspace identity (name, regenerate API key)
 *   2. Privacy ("Store full issue titles" toggle)
 *   3. Identity resolver (read-only IDENTITY_CONFIDENCE_THRESHOLD)
 *
 * The regenerate-API-key flow shows the destructive confirmation modal +
 * one-time reveal pattern from UI-SPEC §Destructive actions; the actual
 * server endpoint that rotates the workspace key is P2 — the button is
 * wired, but the call surface is documented as a stub in 01-08-SUMMARY.md.
 */
export default function SettingsPage(): React.JSX.Element {
  // Workspace name display: read from a server env in P1 — the wizard
  // (Plan 01.09) is responsible for setting this. Falls back to a
  // placeholder when unset.
  const workspaceName = process.env.LINEARWATCH_WORKSPACE_NAME ?? 'workspace';
  const threshold = process.env.IDENTITY_CONFIDENCE_THRESHOLD ?? '0.8';

  return (
    <main className="mx-auto max-w-screen-2xl px-6 py-12 space-y-6">
      <header>
        <h1 className="text-[28px] font-semibold leading-tight">Settings</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Workspace name</Label>
            <MonoCopyBlock value={workspaceName} ariaLabel="Workspace name" />
            <p className="text-xs text-muted-foreground">
              Edit via <code className="font-mono">linearwatch admin set-workspace-name</code> (CLI
              parity in P2).
            </p>
          </div>
          <Separator />
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">API key</h3>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Regenerating revokes your current key. Every running SDK or CLI client will fail until
              they're updated with the new key.
            </p>
            <SettingsActions />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
        </CardHeader>
        <CardContent>
          <PrivacyToggleRow />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identity resolver</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="font-mono text-sm">IDENTITY_CONFIDENCE_THRESHOLD = {threshold}</div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Set via environment variable on the <code className="font-mono">web</code> and{' '}
            <code className="font-mono">worker</code> containers. Default is 0.8. P1 confidence
            ceiling is 0.5 (single Linear signal), so all P1 agents land in PENDING_CONFIRMATION
            until you confirm them from the cost dashboard.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function PrivacyToggleRow(): React.JSX.Element {
  // Privacy toggle is rendered server-side as a static read-only display
  // in P1. The full client-side toggle + confirmation lands when the
  // workspace settings PATCH endpoint ships (P2 alongside the wizard
  // settings flow).
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label>Store full issue titles</Label>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Off by default. When off, titles are SHA-256 hashed with a per-workspace salt before
            storage and never appear in API responses. Turning this on does not retroactively
            recover already-hashed titles.
          </p>
        </div>
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wide">Off</span>
      </div>
    </div>
  );
}
