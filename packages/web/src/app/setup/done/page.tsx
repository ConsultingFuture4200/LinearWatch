import { MonoCopyBlock } from '@/components/mono-copy-block';
import { Button } from '@/components/ui/button';
import { WizardStepIndicator } from '@/components/wizard-step-indicator';
import { clearSetupKeyCookie } from '@/lib/setup';
import Link from 'next/link';

/**
 * Step 7 — Done (DASH-05 / SETUP-03).
 *
 * Shows the webhook URL and a working cURL test command. Both blocks are
 * mono with copy buttons (UI-SPEC §Step 7).
 *
 * Clears the short-lived setup key cookie. Once the user lands here they
 * should set AGENTWATCH_INTERNAL_API_KEY in `.env` from their copied key
 * (or accept the dashboard reads the env var). After clearing, subsequent
 * seed/clear-seed calls go through the normal env-driven path.
 */
const HEADING = "You're set up.";
const BODY =
  "Send your first Linear webhook to the URL below. We'll show events in the dashboard within seconds of receipt.";

const CURL_TEMPLATE = `curl -X POST {host}/webhooks/linear \\
  -H "Content-Type: application/json" \\
  -H "Linear-Delivery: $(uuidgen)" \\
  -H "Linear-Signature: $(echo -n '{}' | openssl dgst -sha256 -hmac "$LINEAR_WEBHOOK_SECRET" | awk '{print $2}')" \\
  -d '{}'`;

export default async function DonePage(): Promise<React.JSX.Element> {
  // Clear the setup key cookie now that the wizard is complete.
  await clearSetupKeyCookie();

  const host = process.env.AGENTWATCH_PUBLIC_URL ?? 'https://{your host}';
  const webhookUrl = `${host}/webhooks/linear`;
  const curlBody = CURL_TEMPLATE.replace('{host}', host);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-8">
      <WizardStepIndicator current={7} />
      <div className="space-y-4">
        <h1 className="text-[28px] font-semibold leading-tight">{HEADING}</h1>
        <p className="text-sm text-muted-foreground">{BODY}</p>
      </div>
      <div className="space-y-3">
        <MonoCopyBlock value={webhookUrl} ariaLabel="Webhook URL" />
      </div>
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Test from your terminal</h2>
        <MonoCopyBlock value={curlBody} multiline size="sm" ariaLabel="cURL test command" />
      </div>
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Next steps</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-foreground">
          <li>Configure your Linear webhook in Linear → Settings → API → Webhooks.</li>
          <li>Point it at the URL above.</li>
          <li>Watch the dashboard — the first event should appear within 2 seconds.</li>
        </ul>
      </div>
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/cost">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
