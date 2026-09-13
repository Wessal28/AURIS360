# KPI definition save transaction

The definition editor sends one `save_kpi_definition` request. The database saves the KPI, retained/new indicators, removal of unused indicators, derived YTD values and an audit event together. An error rolls back the whole request. Indicator IDs, actual results, comments, evidence and authorship stay attached to their records.

Every KPI update advances `definition_revision`; indicator writes also advance the parent revision, including older REST writers. Opening the editor captures the revision and indicator baseline. The RPC locks the parent, checks both, and rejects stale or mixed-cache edits. Monthly writers acquire the same parent lock before changing results. Competing legacy writes can cause a database deadlock rejection; PostgreSQL rolls back the rejected transaction, and the editor asks the user to reload rather than silently retrying it.

The RPC checks the signed-in profile is active, has manager/admin/SEPHS-admin permission, and can access the selected company. It validates the objective's company/year, indicator ownership, review state and history. Its explicit security-definer boundary can detect inconsistent legacy history hidden by tenant RLS. Existing RLS policies and storage permissions are unchanged. Legacy REST endpoints keep their existing role permissions; this migration does not redesign authorization for every old writer.

Submitted, verified, approved, locked and archived definitions cannot use this save route. Approved and locked KPIs still accept their normal monthly results. Indicators with any monthly history cannot be removed. YTD is recalculated per recorded year for sum, average, last, maximum and minimum without modifying actuals or evidence.

The client checks the full returned definition, stable indicator IDs, revision and monthly company/year before updating its caches. A lost or malformed response keeps the form and its draft for review and blocks a repeated save. This is not an automatic retry/idempotency service. Reopen and check the server's record before trying again. Drafts from a different server revision are available for copying with automatic restoration disabled.

## Release prerequisite

Apply `supabase/migrations/20260913030000_kpi_atomic_definition_save.sql` before promoting this application version. It adds one revision column, three routines and three triggers; it does not delete stored records. The ordered replay expects 29 migrations, 270 tables, 435 policies and 132 public routines. Older application versions remain compatible with the added schema; a new editor without the migration refuses to save an existing KPI with no revision.

## Verification

Client behavior tests cover complete acknowledgements, empty/malformed results, changed company/account/role, captured revisions, draft recovery, preserved indicator identity, monthly-history guards and lost-response repeat prevention. The browser fixture uses the real editor and synthetic transaction responses.

The guarded migration replay executes real PostgreSQL behavior tests for failed multi-row rollback, stale revisions, mixed parent/indicator baselines, cross-company and role denial, lifecycle locks, all five YTD methods, negative rounding and preserved actual/history/authorship. A separate test opens competing authenticated PostgreSQL sessions to check stale saves, monthly locking and legacy indicator revision updates.

## Remaining programme work

Objective saves still need their own server conflict protection. Monthly result saves retain their existing request sequence; this slice serializes their database writes but does not make the entire legacy monthly reporting workflow transactional. General archive/restore, configured multi-stage approval adoption and the shared editor workflow for Incidents, Risk, Inspections and Documents remain separate slices. Offline synchronization, backup restoration and representative mobile/role acceptance also remain outstanding.
