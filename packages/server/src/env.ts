import { z } from 'zod';

/**
 * D-24 / DEPLOY-03: server fails fast at startup with a single readable line
 * per missing required env var.
 *
 * Required vars: DATABASE_URL, LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET,
 * LINEAR_WEBHOOK_SECRET, AGENTWATCH_INTERNAL_API_KEY.
 *
 * AGENTWATCH_INTERNAL_API_KEY is required so the web container can authenticate
 * to the server.
 *
 * WORKSPACE_ID is optional at boot (set after the setup wizard runs).
 *
 * Pitfall 7 (P1 prep): TELEMETRY_OPT_IN is read here and printed in the boot
 * banner so users can verify it is off. The actual telemetry rollup pipeline
 * ships in P3.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  LINEAR_CLIENT_ID: z.string().min(1),
  LINEAR_CLIENT_SECRET: z.string().min(1),
  LINEAR_WEBHOOK_SECRET: z.string().min(1),
  AGENTWATCH_INTERNAL_API_KEY: z.string().min(16),

  // Set by setup wizard, not at first boot
  WORKSPACE_ID: z.string().uuid().optional(),

  // Optional with sensible defaults
  IDENTITY_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TELEMETRY_OPT_IN: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
});

export type Env = z.infer<typeof EnvSchema>;

export interface LoadEnvOptions {
  exitOnError?: boolean;
}

/**
 * Parse env, fail-fast with one readable line per error.
 *
 * In tests, pass `{ exitOnError: false }` so vitest can assert the thrown error
 * instead of the process being terminated.
 */
export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
  opts: LoadEnvOptions = { exitOnError: true },
): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const lines: string[] = [];
    for (const issue of result.error.issues) {
      const key = issue.path.join('.');
      lines.push(`FATAL: missing env ${key}: ${issue.message}`);
    }
    for (const line of lines) {
      console.error(line);
    }
    if (opts.exitOnError) {
      process.exit(1);
    }
    throw new Error(`env validation failed:\n${lines.join('\n')}`);
  }
  return result.data;
}

interface BannerLogger {
  info: (msg: string) => void;
}

/**
 * D-30 / Pitfall 7 (P1 prep): print one boot banner with the values users care
 * about — port, telemetry status, identity threshold, log level. Logged at
 * info so it appears in production logs without LOG_LEVEL=debug.
 */
export function logBootBanner(env: Env, log: BannerLogger): void {
  log.info(`agentwatch starting on port ${env.PORT}`);
  log.info(`telemetry: ${env.TELEMETRY_OPT_IN ? 'on' : 'off'}`);
  log.info(`identity_confidence_threshold: ${env.IDENTITY_CONFIDENCE_THRESHOLD}`);
  log.info(`log_level: ${env.LOG_LEVEL}`);
}
