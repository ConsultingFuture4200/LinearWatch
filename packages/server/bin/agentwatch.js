#!/usr/bin/env node
/**
 * `agentwatch` CLI — Phase 1 placeholder (D-11).
 *
 * The full CLI ships in Phase 2 (CLI-01..09: query, report, lineage, tail,
 * rules test, setup, admin clear-seed). For P1 the binary is a thin shell
 * that points users at the dashboard wizard.
 */
const dashboardUrl = process.env.AGENTWATCH_PUBLIC_URL || 'http://localhost:3000';
// biome-ignore lint/suspicious/noConsoleLog: CLI placeholder must print to stdout
console.log('agentwatch CLI — Phase 1 placeholder.');
// biome-ignore lint/suspicious/noConsoleLog: CLI placeholder must print to stdout
console.log(`Use the dashboard wizard at ${dashboardUrl}/setup to complete setup.`);
// biome-ignore lint/suspicious/noConsoleLog: CLI placeholder must print to stdout
console.log('Full CLI ships in Phase 2 (see .planning/ROADMAP.md).');
