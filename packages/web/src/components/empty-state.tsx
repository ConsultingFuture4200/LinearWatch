import { MonoCopyBlock } from '@/components/mono-copy-block';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

/**
 * UI-SPEC §Empty dashboard state — shown on /cost when zero events have
 * arrived for the workspace. Copy strings are verbatim from the spec.
 *
 * The webhook URL host falls back to a placeholder when the env var isn't
 * set; the wizard (Plan 01.09) is responsible for surfacing the real
 * host. The cURL block is the same form as wizard Step 7.
 */
const CURL_TEMPLATE = `curl -X POST {host}/webhooks/linear \\
  -H "Content-Type: application/json" \\
  -H "Linear-Delivery: $(uuidgen)" \\
  -H "Linear-Signature: $(echo -n '{}' | openssl dgst -sha256 -hmac "$LINEAR_WEBHOOK_SECRET" | awk '{print $2}')" \\
  -d '{}'`;

interface EmptyStateProps {
  /** Optional public host override; defaults to AGENTWATCH_PUBLIC_URL or a placeholder. */
  publicHost?: string;
}

export function EmptyState({ publicHost }: EmptyStateProps = {}): React.JSX.Element {
  const host = publicHost ?? process.env.AGENTWATCH_PUBLIC_URL ?? 'https://your-host.example';
  const webhookUrl = `${host}/webhooks/linear`;
  const curlBody = CURL_TEMPLATE.replace('{host}', host);

  return (
    <main className="mx-auto max-w-screen-2xl px-6 py-12 space-y-6">
      <h1 className="text-[28px] font-semibold leading-tight">Waiting for your first webhook.</h1>
      <p className="text-sm text-muted-foreground max-w-2xl">
        Send a Linear AgentSession event to the URL below. The dashboard refreshes automatically
        when events arrive.
      </p>
      <div className="space-y-4 max-w-3xl">
        <MonoCopyBlock value={webhookUrl} ariaLabel="Webhook URL" />
        <MonoCopyBlock value={curlBody} multiline size="sm" ariaLabel="cURL test command" />
      </div>
      <div className="flex flex-wrap items-center gap-4 pt-2">
        <Button variant="secondary" asChild>
          <Link href="/setup?step=6">Try with synthetic data</Link>
        </Button>
        <Link
          href="/docs/troubleshooting"
          className="text-sm text-foreground underline underline-offset-4 decoration-muted-foreground hover:decoration-foreground"
        >
          Troubleshooting →
        </Link>
      </div>
    </main>
  );
}
