'use client';

import { MonoCopyBlock } from '@/components/mono-copy-block';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { generateApiKeyAction } from './actions';

/**
 * Client form for step 5 (D-14 / SETUP-03 / DASH-05 one-time API key
 * reveal).
 *
 * Two screens:
 *  (1) Workspace name input + "Generate workspace API key" CTA.
 *  (2) After generation: the plaintext key in a MonoCopyBlock with mask
 *      toggle, an acknowledgement checkbox, and the Continue CTA.
 */
const REVEAL_HEADING = 'Your workspace API key';
const REVEAL_BODY =
  'Copy this now. It will not be shown again. If you lose it, regenerate from Settings — every existing SDK and CLI client will need the new key.';
const ACK_LABEL = "I've copied the key and stored it somewhere safe.";

export function WorkspaceForm(): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  function onSubmit(formData: FormData): void {
    setError(null);
    startTransition(async () => {
      const result = await generateApiKeyAction(formData);
      if (!result.ok) {
        setError(result.error ?? 'Generation failed.');
        return;
      }
      setPlaintextKey(result.plaintextKey ?? null);
    });
  }

  if (plaintextKey) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">{REVEAL_HEADING}</h2>
          <p className="text-sm text-muted-foreground">{REVEAL_BODY}</p>
        </div>
        <MonoCopyBlock value={plaintextKey} maskable ariaLabel="Workspace API key" />
        <div className="flex items-start gap-3">
          <Checkbox
            id="ack"
            checked={ack}
            onCheckedChange={(checked) => setAck(checked === true)}
          />
          <Label htmlFor="ack" className="text-sm font-normal cursor-pointer">
            {ACK_LABEL}
          </Label>
        </div>
        <div className="flex justify-end">
          <Button disabled={!ack} onClick={() => router.push('/setup/seed')}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          placeholder="acme-prod"
          required
          autoComplete="off"
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">
          Used in the dashboard header. Lower-kebab-case recommended.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Generating…' : 'Generate workspace API key'}
        </Button>
      </div>
    </form>
  );
}
