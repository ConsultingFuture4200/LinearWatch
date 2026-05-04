'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useState } from 'react';

/**
 * Settings page client island — the destructive "Regenerate API key"
 * confirmation modal per UI-SPEC §Settings page → API key.
 *
 * The actual rotate-key server endpoint is a P2 deliverable; in P1 the
 * Yes button shows a placeholder toast/log. The UI flow is fully wired
 * so the P2 plan only has to call the endpoint — no UX rework.
 */
export function SettingsActions(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive/10"
        >
          Regenerate API key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate workspace API key?</DialogTitle>
          <DialogDescription>
            This revokes <code className="font-mono">lw_…</code> immediately. Existing SDK and CLI
            clients will return 401 until they're updated. There is no undo.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              // P2: call POST /api/v1/workspace/regenerate-key.
              // For P1 the UI flow is intact; the call is a placeholder.
              setOpen(false);
            }}
          >
            Yes, regenerate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
