# Feature Research

**Domain:** AI agent observability platform (self-hosted, Linear-anchored)
**Researched:** 2026-05-03
**Confidence:** MEDIUM-HIGH (LLM/APM ecosystem well-documented; agent-specific patterns extrapolated from adjacent spaces)

---

## Research Method

Five adjacent spaces surveyed: APM (Datadog, Sentry, New Relic), data pipeline observability (Definity, Monte Carlo, Acceldata), LLM observability (Langfuse, Helicone, Arize Phoenix), build/CI observability (LinearB, Sleuth), and self-hosted analytics (Plausible, Umami, PostHog self-hosted). Each feature below is annotated with which adjacent space informed it.

---

## Feature Landscape

### Table Stakes — Must Ship in v0 or Show HN Bombs

Features the target self-hoster assumes exist. Missing these = product feels incomplete or untrustworthy. No credit for having them, heavy penalty for missing them.

| Feature | Why Expected | Source Analog | Complexity | v0 Status |
|---------|--------------|--------------|------------|-----------|
| **Cost per agent, per team, per cycle** | Every APM/LLM tool ships per-dimension cost breakdown as the first metric | Langfuse, Helicone, Datadog FinOps | M | In PRD |
| **Cost-per-closed-issue** | Outcome-anchored cost is the core value prop; without it linearwatch is just a cost log | Emerging in LLM observability (Langfuse + outcome correlation) | M | In PRD |
| **Success rate definition** | Users won't trust a "reliability" view without a clear, documented formula for what counts as success vs failure | Datadog APM, Sentry | S | In PRD (outcome column) |
| **Revert-within-N-days tracking** | DORA's change failure rate is the closest analog; 14-day revert window is already the PRD spec | DORA metrics, Sleuth, LinearB | M | In PRD (14d window) |
| **Time-to-resolution distribution (p50/p95)** | APM users expect latency histograms; TTR distribution is the agent-space equivalent | Datadog APM p99 latency, LinearB lead time | M | In PRD |
| **Per-issue agent timeline (lineage view)** | No existing tool shows cross-agent history per issue; this is the single most-cited gap in the problem statement | Definity column-level lineage pattern | M | In PRD |
| **Anomaly highlight / cost spike alert** | Rolling-average anomaly detection is standard; without it the cost view is passive noise | Datadog Watchdog, Monte Carlo anomaly detection | M | In PRD |
| **YAML-defined alert rules, version-controlled** | Self-hosters expect config-as-code. UI-only alert builders are a SaaS pattern they reject | Prometheus Alertmanager, Grafana rules | S | In PRD |
| **Slack webhook notification** | Default notification channel for engineering teams at this company size | Universal across observability tools | S | In PRD |
| **Generic webhook notification** | Required for teams routing to tools not on the default list (Opsgenie, custom ticketing) | Prometheus Alertmanager, Datadog | S | In PRD |
| **Email notification** | Not primary, but expected as fallback by solo operators and smaller teams | Universal | S | In PRD |
| **`docker compose up` in < 5 min** | Plausible/Umami/Langfuse all ship this as the primary onboarding path; anything harder is a Show HN liability | Plausible, Umami, Langfuse self-hosted | S | In PRD |
| **Prometheus `/metrics` endpoint** | Self-hosters running k8s or any Prometheus stack will scrape this on day one; missing it is a trust signal failure | SigNoz, Langfuse self-hosted | S | In PRD |
| **Structured JSON logs** | Self-hosters pipe logs to existing stacks (Loki, ELK, CloudWatch); unstructured logs won't integrate | Universal for self-hosted tools targeting DevOps users | S | In PRD |
| **CLI `query` and `report` commands** | Self-hosters expect terminal-first access; a web-only tool signals it wasn't built for them | OneUptime CLI, Definity CLI patterns | M | In PRD |
| **CLI `tail` command** | Live event stream for debugging ingestion and webhook delivery is the first debugging step after install | Sentry live feed, Datadog event stream | S | In PRD |
| **`linearwatch setup` wizard** | PostHog's self-hosted onboarding shows this is expected: account creation, validation checks, first integration | PostHog setup wizard | S | In PRD |
| **Issue title hashing by default** | Langfuse and Helicone ship this as a client-side masking default; any tool handling issue content that ships with titles in plaintext will be rejected by privacy-conscious teams | Langfuse masking, Helicone data sovereignty | S | In PRD |
| **Raw event replay / 30-day retention** | Pipeline observability tools (Monte Carlo, Definity) store raw events for replay; without it, schema bugs or resolver errors require manual re-fetch | Monte Carlo, Definity raw event patterns | M | In PRD |
| **Identity resolver confidence surfaced in dashboard** | Low-confidence attribution is unique to this domain; without it, incorrect cross-agent attributions erode all trust in the tool | No direct analog — linearwatch-specific | M | In PRD |
| **Opt-in anonymized telemetry (off by default)** | Self-hosters are acutely privacy-sensitive; PostHog found 90% opt out, so default-off with clear docs is the only acceptable approach | PostHog ethical telemetry guide | S | In PRD |

### Differentiators — Competitive Advantage Worth Investing In

Features that set linearwatch apart. Not expected by users on day one, but highly valued once they exist and difficult for point solutions to replicate.

| Feature | Value Proposition | Source Analog | Complexity | Notes |
|---------|-------------------|--------------|------------|-------|
| **Cross-vendor identity resolver** | No other tool stitches Linear app user ID + GitHub bot login + vendor session ID into a single agent identity. This is the core IP. | No analog — this is the gap linearwatch fills | L | Phase 2 exit criteria |
| **Cost-per-outcome (not cost-per-call)** | LLM observability tools track cost-per-call; linearwatch tracks cost-per-closed-issue and cost-per-reverted-change. Different denominator, higher business value. | Emerging in Langfuse (trace + outcome correlation) but not anchored in issue outcomes | M | Requires identity resolver + GitHub enrichment |
| **Revert-rate as a first-class reliability signal** | DORA's change failure rate is the closest concept, but linearwatch's 14-day revert window tied to a specific agent and issue is more granular than any existing tool | Sleuth tracks rollbacks, LinearB tracks CFR — neither ties it to agent identity | M | Requires GitHub PR enrichment |
| **"Who fixed who's bug" lineage** | Tracking which agent handed off to another agent and who ultimately closed the issue reveals collaboration patterns invisible to any single-vendor tool | Definity column-level lineage (data pipeline analog) | L | Phase 2; requires multi-agent session detection |
| **Public benchmark dataset from opt-in telemetry** | If design partners opt in, linearwatch can publish "what does $1 of agent spend produce across N teams" — no other tool has this data | Plausible publishes aggregate stats; LinearB publishes DORA benchmarks — linearwatch can own the agent-cost benchmark | M | Phase 3; differentiator for Show HN and SEO |
| **Two default rule packs (cost spike + revert spike) shipping in-box** | Prometheus gives you the rule engine; linearwatch gives you the rules that matter for agent ops. Lowers time-to-first-alert from hours to minutes. | Prometheus Alertmanager gives the mechanism; community rule registries (Awesome Prometheus) give the pattern | S | Phase 2; must include in v0.1 for Show HN |
| **`linearwatch lineage LIN-1234` CLI command** | One command to see every agent that touched an issue, in order, with cost and outcome. No other tool ships this for the Linear context. | No direct analog | S | Phase 2; depends on lineage view in dashboard |
| **Model-tier cost breakdown (frontier/mid/small)** | Helicone tracks cost per model; linearwatch buckets by tier, which is more stable across model version changes and more actionable for optimization decisions | Helicone per-model breakdown; linearwatch adds tier bucketing | S | Phase 1 enhancement; add to `agent_sessions.model_tier` |
| **Helm chart as secondary deployment** | Most observability tools start docker-compose-only; shipping Helm in v0 signals platform-team readiness and differentiates from quick hacks | Langfuse ships Helm; most LLM tools don't | M | Phase 3 |

### v2 Features — Users Will Ask, Can Wait

Features that will generate community requests but should not ship in v0 without validated demand. Deferring keeps the v0 codebase small and trustworthy.

| Feature | Why Defer | What Triggers Promotion to v0.x |
|---------|-----------|----------------------------------|
| **Period-over-period cost delta (WoW, MoM)** | Useful once users have 2+ weeks of data; no value at install. Add after design partners have been running for a cycle. | 3+ design partners with 14+ days of data |
| **Top-N cost consumers ranked table** | Directionally right but requires stable agent identity across sessions first; premature before resolver is hardened | After identity resolver confidence > 95% across design partners |
| **Projected spend / budget forecasting** | Cloud cost tools (AWS Cost Explorer, Datadog FinOps) ship this; requires multi-week baseline. Not meaningful at v0 data volumes. | 30+ days of data per workspace |
| **Discord and Microsoft Teams notifications** | Slack + generic webhook covers 90%+ of self-hoster use cases. Discord/Teams are low-friction additions but dilute test surface in v0. | Community PRs; add in v0.2 |
| **PagerDuty native integration** | Self-hosters at this company size (10-50 people) mostly route through Slack first; PagerDuty is enterprise overhead. Generic webhook covers teams that already use it. | Design partner request |
| **CLI `diff` command (compare two windows)** | Useful for "did the deploy make things worse?" but adds surface area before core flows are stable | After `report` command usage data shows comparative questions |
| **CLI `export` to CSV/JSON** | Power users will want this; raw query API plus jq covers the need today. Add when a community member asks for it in an issue. | First GitHub issue requesting it |
| **`rules test` dry-run output improvements** | Basic pass/fail is enough for v0; richer diff output (what would have fired, why) is a Phase 4 quality-of-life improvement | After alert rule community adoption |
| **Digest mode alerts (daily/weekly rollup)** | Realtime is correct for cost spikes; digest is for weekly reports. Builds on alert infrastructure. Add after users complain about alert fatigue. | User feedback post-launch |
| **Alert cooldown / grouping (Alertmanager-style)** | Prometheus Alertmanager pattern: group_wait, group_interval. Correct for v2 but adds config complexity. Default 5-minute cron already provides natural grouping. | After first report of alert storm from a user |
| **Triage Automations as passive lineage source** | Open question in PRD §12; low-priority until Linear ships stable API surface for it | Linear API stabilization + design partner use case |
| **GitHub App (vs PAT) for GitHub integration** | GitHub Apps have better rate limits, fine-grained permissions, and short-lived tokens; PAT is faster to ship and sufficient for v0 single-tenant use. Promote when workspace auth complexity warrants it. | Multi-user workspace management request |
| **Per-agent retention windows (independent of global 30d)** | Fine-grained retention is a data governance feature most self-hosters won't configure; adds schema complexity. | SOC2 or compliance-oriented design partner |
| **Natural language query interface** | Already explicitly deferred in PRD to v0.2 with LLM translator | v0.2 milestone |
| **Jira / GitHub Issues as primary issue source** | Explicitly out of scope in PRD; deferred to post-launch | Post v0.1 launch |

### Anti-Features — Explicit NO, With Reasoning

These will be requested. They should be actively refused. Document them so they don't drift back in during issue triage.

| Anti-Feature | Why It Gets Requested | Why We Refuse It | What We Do Instead |
|--------------|----------------------|------------------|--------------------|
| **Embedded LLM for natural language query in v0** | NL queries feel like a "modern" UX; Datadog and Helicone are adding them | Adds an LLM API key requirement to self-hosting, creating cost, latency, privacy, and operational complexity on day one. Kills the "no external dependencies" story. | Constrained DSL with good autocomplete in CLI; NL deferred to v0.2 as an opt-in capability |
| **Embedded LLM for auto-remediation ("fix this agent")** | Agent-of-agents pattern is fashionable; teams will ask "can it automatically kill the runaway agent?" | LinearWatch is an observability tool, not a control plane. Taking automated actions on agents changes the blast radius from "wrong dashboard" to "disrupted production workflow." The trust cost of one wrong remediation exceeds the value of many correct ones. | Ship actionable alerts that send to Slack/webhook; let teams decide. Document this philosophy in README. |
| **Multi-tenancy / multi-workspace in v0** | Teams with 2+ Linear workspaces will ask immediately | Tenant isolation is a security and data model problem that compounds every other problem. One Postgres = one workspace is a constraint that makes v0 auditable, testable, and deployable. Multi-tenant adds auth, RLS, connection pooling, schema isolation, and billing UI — all out of scope. | Explicit in README: run one instance per workspace. Simple, clear, honest. |
| **Billing UI / subscription management** | SaaS reflexes from users used to hosted tools | linearwatch is self-hosted. There is no billing. Adding billing UI inside the tool confuses the distribution model and signals a future paywall. | If a hosted tier ships, billing lives in a separate service, never in the OSS codebase |
| **Full Jira / GitHub Issues / Asana parity in v0** | PMs will ask "why only Linear?" | Go deep before going wide. Each issue source requires a separate webhook schema, identity resolver heuristic, and enrichment pipeline. Shallow support across 4 tools is worse than deep support on 1. | Linear-only v0; Jira spike by Day 90+30 |
| **Custom SQL expressions in rule engine** | Power users want escape hatches; it feels limiting to use a DSL | Arbitrary SQL in version-controlled YAML = SQL injection surface even in a single-tenant tool. DSL covers 95% of real rule patterns with none of the risk. | DSL with 2 built-in rule types; add more rule types based on community patterns, not arbitrary SQL |
| **Real-time WebSocket dashboard (sub-second updates)** | Looks impressive in demos | Requires stateful connections, Redis or SSE infrastructure, and complicates Postgres-only constraint. 60-second enrichment lag is the real bottleneck; sub-second UI updates don't help. | Polling with sane cache-control headers; 30-second dashboard refresh is fine for cost/reliability views |
| **SSO / OAuth for end users (SAML, OIDC)** | Enterprise teams will ask on day 1 of evaluation | Explicitly out of scope in PRD. SSO requires SAML/OIDC integration, session management, and role/group mapping — all of which belong in a future commercial hosted tier, not the OSS core. | Reverse-proxy auth (Nginx basic auth, Cloudflare Access, Tailscale) covers single-tenant self-hosting adequately |
| **Embedded user management UI** | Teams want to invite teammates without editing env files | Single-tenant in v0 means the operator is the admin. A full user management UI adds significant surface area (CRUD, password reset, invite flows) for a tool where the operator controls deployment. | Basic auth via env var; reverse-proxy for per-user access control. Document clearly. |
| **Mobile app** | Slack-channel alerts land on mobile; people expect a companion app | Web dashboard + CLI covers 100% of use cases for the target persona (platform engineers at desk). Mobile is months of work for a workflow that belongs in Slack notifications. | Rich Slack alert format with cost and reliability context in the notification body |

---

## Feature Dependencies

```
Identity Resolver (Linear-only, Phase 1)
    └── requires ──> Webhook Receiver (Linear)
    └── enables ──> Cost Dashboard (per-agent breakdown)

Identity Resolver (cross-source, Phase 2)
    └── requires ──> Identity Resolver (Linear-only)
    └── requires ──> Webhook Receiver (GitHub)
    └── requires ──> Vendor API Enrichment (Cursor + 1)
    └── enables ──> Reliability View (revert-within-14d)
    └── enables ──> Lineage View (per-issue agent timeline)
    └── enables ──> Cost-per-outcome metric

Alert Engine
    └── requires ──> Cost Dashboard (cost spike rule)
    └── requires ──> Reliability View (revert-rate rule)
    └── enables ──> Slack / email / webhook notifications

CLI query + report
    └── requires ──> Internal Query API
    └── requires ──> Cost Dashboard data model

CLI lineage
    └── requires ──> Lineage View data model
    └── requires ──> Identity Resolver (cross-source)

CLI tail
    └── requires ──> Webhook Receiver (raw event store)
    └── independent of identity resolver

Anonymized Telemetry Pipeline
    └── requires ──> Enrichment Worker (outcome column populated)
    └── requires ──> Privacy controls (title hashing, anonymizer)
    └── enables ──> Benchmark Blog Post
    └── enables ──> Show HN narrative

GitHub App (v2)
    └── conflicts ──> GitHub PAT (v0) — parallel auth paths add confusion; migrate, don't dual-ship

Period-over-period deltas (v2)
    └── requires ──> 14+ days of data per workspace (runtime dependency, not code)
    └── requires ──> Cost Dashboard stable schema

NL Query (v0.2)
    └── requires ──> Constrained DSL (v0) — NL translates to DSL, not raw SQL
```

### Dependency Notes

- **Cross-source identity resolver requires Linear-only resolver:** Phase 1 must ship a working resolver before Phase 2 can stitch GitHub and vendor data. The resolver is the spine of the product.
- **Cost-per-outcome requires all three Phase 2 items:** vendor API enrichment (cost), GitHub enrichment (outcome: merge/revert), and cross-source resolver (connecting them). Can't ship as a meaningful metric until all three are stable.
- **Alert engine has a soft dependency on both metric views:** alert rules reference metric names. The DSL can be defined before the views exist, but it can't be tested meaningfully with real data until Phase 2 views ship.
- **Telemetry pipeline should not ship before title hashing is confirmed working in code:** privacy guarantee must be enforced before opt-in data leaves instances.

---

## MVP Definition

### Launch With (v0.1) — Show HN Readiness

These are the features that make the Show HN post credible. Missing any one of them will be the top HN comment.

- [ ] **Cost view per agent/team/cycle + cost-per-outcome** — the product's thesis in one view
- [ ] **Reliability view: success rate + revert-within-14d + TTR distribution** — the reliability thesis
- [ ] **Lineage view: per-issue agent timeline** — the cross-vendor story; nothing else shows this
- [ ] **Cross-source identity resolver** — without it, lineage and cost-per-outcome are fiction
- [ ] **`docker compose up` in < 5 min, Postgres only** — the deployment thesis; failure here is Show HN death
- [ ] **Two default alert rules (cost spike, revert-rate spike)** — makes the tool active, not passive
- [ ] **CLI `query`, `report`, `lineage`, `tail`** — self-hosters check for CLI in the README before installing
- [ ] **YAML rule format, version-controllable** — config-as-code signal; required for target persona
- [ ] **Slack + generic webhook notifications** — alert delivery is what makes the alerts matter
- [ ] **`linearwatch setup` first-run wizard** — PostHog pattern; reduces "how do I configure this?" GitHub issues
- [ ] **Issue title hashing by default** — privacy default must ship before public launch
- [ ] **Prometheus `/metrics` endpoint** — self-hosters will check for this; absence signals lack of ops maturity
- [ ] **Opt-in anonymized telemetry** — needed for the benchmark blog post that backs the Show HN launch
- [ ] **Documentation site: quickstart + SDK** — 3+ design partners + Show HN won't work without it

### Add After v0.1 Validation (v0.2)

Add these when design partner feedback or HN comments reveal the gap.

- [ ] **Period-over-period cost delta (WoW, MoM)** — add once 3+ partners have 14+ days of data
- [ ] **Digest mode for alerts** — add when first user complains about alert fatigue
- [ ] **Alert grouping / cooldown** — add when first report of alert storm
- [ ] **Top-N cost consumers ranked view** — add once identity resolver is hardened (confidence > 95%)
- [ ] **Discord / Teams notification channels** — community PR; add in v0.2 if contribution arrives
- [ ] **CLI `diff` command** — add when `report` usage data shows comparative questions
- [ ] **Natural language query (opt-in, LLM-backed)** — explicitly deferred to v0.2 per PRD

### Defer to v1.0+ (Post PMF)

- [ ] **GitHub App (replace PAT)** — migrate when workspace auth complexity requires it
- [ ] **Projected spend / budget forecasting** — requires 30+ days baseline
- [ ] **Jira / GitHub Issues as primary issue sources** — post-launch spike
- [ ] **PagerDuty native integration** — enterprise feature; generic webhook covers it today
- [ ] **Per-agent retention windows** — compliance-driven; promote on SOC2 request

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Cross-source identity resolver | HIGH | HIGH | P1 |
| Cost per agent/team/cycle | HIGH | MEDIUM | P1 |
| Cost-per-closed-issue | HIGH | MEDIUM | P1 |
| Per-issue agent timeline (lineage) | HIGH | HIGH | P1 |
| `docker compose up` < 5 min | HIGH | LOW | P1 |
| Revert-within-14d tracking | HIGH | MEDIUM | P1 |
| Default alert rules (cost spike + revert) | HIGH | MEDIUM | P1 |
| YAML rule format | MEDIUM | LOW | P1 |
| Slack + webhook notifications | HIGH | LOW | P1 |
| Issue title hashing | HIGH | LOW | P1 |
| CLI `query`, `report`, `lineage`, `tail` | HIGH | MEDIUM | P1 |
| `linearwatch setup` wizard | MEDIUM | LOW | P1 |
| Prometheus `/metrics` endpoint | MEDIUM | LOW | P1 |
| Opt-in telemetry + anonymizer | MEDIUM | MEDIUM | P1 |
| Model-tier cost breakdown | MEDIUM | LOW | P1 |
| Success rate definition + TTR distribution | HIGH | MEDIUM | P1 |
| Identity resolver confidence in dashboard | HIGH | MEDIUM | P1 |
| Period-over-period cost delta | MEDIUM | LOW | P2 |
| Top-N cost consumers ranked | MEDIUM | LOW | P2 |
| Alert grouping / cooldown | MEDIUM | MEDIUM | P2 |
| Digest mode alerts | LOW | LOW | P2 |
| Discord / Teams notifications | LOW | LOW | P2 |
| CLI `diff` command | MEDIUM | LOW | P2 |
| GitHub App (replace PAT) | MEDIUM | HIGH | P3 |
| Projected spend forecasting | MEDIUM | HIGH | P3 |
| NL query (LLM-backed) | HIGH | HIGH | P3 |
| Jira / GitHub Issues source | HIGH | HIGH | P3 |
| PagerDuty native integration | LOW | LOW | P3 |

---

## Competitor Feature Analysis

| Feature | Langfuse | Helicone | LinearB/Sleuth | Definity | linearwatch approach |
|---------|----------|----------|----------------|----------|---------------------|
| Cost breakdown dimensions | User, session, model, tag | User, model, virtual key | N/A | Pipeline, job, team | Agent, team, cycle, issue — unique denominator |
| Revert / failure tracking | No | No | CFR, rollback events | Job failure, pipeline stop | Revert-within-14d tied to agent identity |
| Cross-source identity | No — single LLM app context | No | GitHub + Jira stitched | Spark job + dataset lineage | Linear + GitHub + vendor session — the core IP |
| Lineage view | Trace tree within one session | No | Deploy → incident links | Column-level data lineage | Issue-level agent sequence across vendors |
| Self-hostable | Yes (Docker, Helm) | Yes (Docker, Apache 2.0) | No | No | Yes — primary distribution path |
| YAML rule format | No — UI rules | No | No | No | Yes — config-as-code |
| CLI | No | No | No | No | Yes — `linearwatch` binary |
| Privacy: title hashing | Server-side masking (self-hosted) | Client-side masking | N/A | N/A | Title hashing by default; full title opt-in |
| Opt-in benchmark telemetry | No | No | Publishes aggregate benchmarks | No | Opt-in daily rollup; benchmark blog post |
| Setup wizard | Yes (admin account + validation) | No | SaaS onboarding | SaaS onboarding | `linearwatch setup` command |

---

## Self-Hoster Lens: What This Persona Specifically Expects

Based on Plausible, Umami, Langfuse, and PostHog self-hosted patterns:

1. **Two containers max in the default compose file.** Plausible's multi-container requirement (Postgres + ClickHouse + Elixir) is cited as a friction point. linearwatch's Postgres-only constraint is a competitive advantage here — say so in the README.
2. **No cloud dependency, no phone-home by default.** Telemetry must be opt-in with `TELEMETRY_OPT_IN=true` env var, explicitly documented, and auditable in code. Not policy. This is PostHog's lesson.
3. **Environment variables for all configuration.** No UI-first config that breaks on container restart. Self-hosters expect `.env` + docker compose volume mounts.
4. **The README is the product.** The first 200 lines of README determine whether they clone or scroll past. Architecture diagram, quickstart, and an explicit "what's out of scope" section are non-optional.
5. **They will read the source code.** Anonymizer and identity resolver will be scrutinized. Name the files and functions clearly. Obfuscation of privacy logic = trust failure.
6. **Sample/seed data for first install matters more than they say.** Self-hosters hit an empty dashboard and close the tab. PostHog validates the integration on setup; linearwatch should seed with example data or clearly surface "no events yet — here's how to send one."
7. **GitHub PAT is fine for v0.** Self-hosters accept PAT-based integrations for tools they're evaluating. GitHub App is a v2 concern. Document the minimal PAT scopes required.

---

## Sources

- [Langfuse token and cost tracking docs](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
- [Langfuse data masking (self-hosted)](https://langfuse.com/self-hosting/security/data-masking)
- [Langfuse GDPR](https://langfuse.com/security/gdpr)
- [Helicone GitHub repo](https://github.com/Helicone/helicone)
- [Helicone cost calculation docs](https://docs.helicone.ai/references/how-we-calculate-cost)
- [Arize Phoenix overview](https://arize.com/docs/phoenix)
- [Datadog anomaly monitors](https://docs.datadoghq.com/monitors/types/anomaly/)
- [Datadog Watchdog alerts](https://docs.datadoghq.com/watchdog/alerts/)
- [Monte Carlo data observability blog](https://www.montecarlodata.com/blog-what-is-data-observability/)
- [Definity pipeline observability](https://www.definity.ai/pipeline-observability)
- [LinearB engineering metrics](https://linearb.io/platform/engineering-metrics)
- [Sleuth vs LinearB comparison](https://linearb.io/compare/sleuth-vs-linearb)
- [PostHog ethical telemetry guide](https://posthog.com/blog/open-source-telemetry-ethical)
- [PostHog self-host docs](https://posthog.com/docs/self-host)
- [Umami vs Plausible self-hosted comparison](https://selfhostwise.com/posts/self-hosted-website-analytics-in-2026-umami-vs-plausible-complete-guide/)
- [Prometheus Alertmanager docs](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [Grafana alerting best practices](https://drdroid.io/engineering-tools/grafana-alerting-advanced-alerting-configurations-best-practices)
- [GitHub App vs OAuth/PAT decision guide](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app)
- [DORA metrics 2025-2026 guide](https://dora.dev/guides/dora-metrics/)
- [AI cost observability tools 2026 comparison](https://www.getmaxim.ai/articles/ai-cost-observability-tools-in-2026-a-practical-comparison/)
- [AI agent observability platforms 2026](https://www.getmaxim.ai/articles/top-5-ai-agent-observability-platforms-in-2026/)
- [Agent observability platforms comparison 2026](https://www.digitalapplied.com/blog/agent-observability-platforms-langsmith-langfuse-arize-2026)

---

*Feature research for: linearwatch — self-hosted AI agent observability for Linear workspaces*
*Researched: 2026-05-03*
