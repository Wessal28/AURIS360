# Objective definition saves

The objective editor uses one `save_objective_definition` transaction for the objective and its audit event. It captures `definition_revision` when opened. A competing update returns HTTP 409 and preserves the entered text for review. Every objective update advances the revision, including older REST writes. Drafts from a different revision cannot be automatically restored.

The server checks active manager/admin/SEPHS-admin access and the selected tenant, validates name/year/colour, and assigns the creator from the signed-in account. Archived objectives cannot be revived through this editor. An objective with linked KPIs cannot change reporting year through this save route. The existing KPI definition RPC shares the objective lock so a competing KPI creation or reparenting and a year change cannot leave the new KPI in the wrong year.

Blank codes are allocated inside the transaction under a company/year lock. Competing RPC saves receive different automatic codes. Manual codes and legacy REST code writers retain their existing semantics; this is not a universal unique-code constraint. Existing RLS and storage permissions are unchanged. General legacy archive/restore and REST workflows remain separate and are not made transactional by this slice.

The client verifies the returned identity, tenant, fields and next revision, then verifies its scoped refresh before publishing the objective list. Lost responses and later changes retain a review-only draft and block duplicate submissions. A confirmed save followed by a refresh failure is identified as saved and is never automatically repeated. Other KPI, indicator and monthly-result caches are preserved.

## Release prerequisite

Apply `supabase/migrations/20260913040000_objective_definition_save.sql` before promoting this version. It adds one revision column, two routines and one trigger. It does not delete business records or change RLS/storage policies. An older editor remains compatible; the new editor refuses to edit an existing objective without a revision. New-objective saves also require the RPC; there is no REST fallback.

The ordered replay expects 30 migrations, 270 tables, 435 policies and 134 routines. PostgreSQL tests run only in the explicitly named local disposable replay database, never on staging or production.

## Verification

Client behavior tests cover captured revisions, stale drafts, colour persistence, changed context, malformed acknowledgements, refresh races and uncertain-save repeat prevention. The real form is also available in the synthetic browser fixture.

The migration replay tests actual SQL authorization, field validation, attribution, audit-failure rollback, archived records, legacy revision advancement and preservation of linked KPI records. Competing authenticated PostgreSQL sessions test stale edits, automatic code allocation, legacy updates and both orderings of a KPI creation against an objective year change.

## Remaining programme work

Atomic monthly reporting, general archive/restore, configured multi-stage approval adoption and shared editor adoption for Incidents, Risk, Inspections and Documents remain subsequent slices. Offline synchronization, backup restoration and representative role/mobile acceptance also remain outstanding.
