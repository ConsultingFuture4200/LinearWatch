-- 0001_setup_github_pat.sql
--
-- Plan 01.09: setup wizard collects an optional GitHub PAT in step 4.
-- The PAT is used by the P2 GitHub enrichment worker (PRD §6.4); we
-- persist it now so the wizard does not need a follow-up migration.
--
-- Storage: base64-encoded text. P1 does not encrypt at rest (single-tenant
-- self-host; the same Postgres instance also holds the workspace's
-- session-level data). P2 may rotate this to a sealed-secret column once
-- the enrichment worker exists.
--
-- The column is nullable because the PAT is optional in the wizard
-- ("Skip - I'll add this later" CTA).

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS github_pat_encoded TEXT;
