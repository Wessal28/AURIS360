# Inspection checklist and full report repair

## Causes and corrections

- Pre-start used the ordinary audit checklist builder, which always targets `if-checklist`. Its own `ps-checklist-body` therefore stayed empty, while Save still required answers. Pre-start now owns ten default items, namespaced radio groups, observations and a live score. It never changes an unsaved ordinary audit checklist. Saved duplicate prompts and legacy `item_name` prompts keep their independent answers; unanswered is never converted to N/A.
- Register row clicks intentionally opened a short generic preview. The inspection-specific read-only report now displays saved checklist answers/comments, overall observations, corrective actions, evidence links and sign-offs. Audit findings are loaded separately with company/inspection filters and an explicit incomplete-report warning on failure. Existing edit actions are unchanged. No historical answers are invented when only a score was saved.
- Pre-start already posted multiple fields absent from the checked-in `inspections` schema. Hazards, controls and PPE controls also had no save/load binding. The additive migration below covers the complete form payload, preserves existing tables/records/RLS, and separates the local signing timestamp from the legacy date-only column. New forms reset supplementary values; saved forms reload them.
- Validation and server errors stay inside the form. Pending saves suppress duplicate clicks; acknowledgement is checked before reporting success. Company changes cannot redirect an edit or close another company's view. Ambiguous network acknowledgements still require checking the register before retrying; this is not a server-side idempotency implementation.

## Database and release status

Required SQL: [20260909180000_inspection_prestart_form_fields.sql](supabase/migrations/20260909180000_inspection_prestart_form_fields.sql).

The migration is included, **not applied to staging or production by this task**. It adds nullable fields only: no data backfill, deletion, grants or RLS changes. Apply/replay and verify it in the isolated staging environment before release. The staging acceptance check now selects every new field and fails explicitly if setup is missing. Production release remains subject to the existing deployment/backup approval gates. Do not merge or promote this PR while the existing production hold remains.

The separate historical `prestart_inspections` table is not moved or overwritten. The current form continues using the `inspections` register. Reverting the frontend does not require dropping new columns or discarding records.

## Verification

- Five initial regression cases failed against the original code; all five pass after the repair.
- 21 focused behavioral checks; 997 full-suite tests; 564 readiness checks passed, with no failures/skips. Ordered inventory is 23 migrations and 180 offline routes. Cache version contracts and the generated offline manifest are updated.
- Browser skill: synthetic fixtures with the actual form markup/functions and local application styles, at 390×844, 768×1024 and 1280×900. Verified ten visible items, 44px answer labels/Close control, no document overflow, independent audit draft, keyboard selection, failed-save retention, successful acknowledgement, reopen with comments/hazards/PPE/Hold decision, 21-item site report plus action/finding, visible findings-load failure, focus wrap/Escape restoration and background scroll lock. Final browser console had no warnings/errors.
- Local fixture: `node scripts/serve-inspection-forms-qa.cjs` (loopback only; fabricated records, no credentials or remote mutations).
- Local evidence: ignored `release-evidence/inspection-full-tests.txt`, `inspection-readiness.txt`, `inspection-readiness.json`.
- These checks are not a real customer save, authenticated role acceptance, physical Android testing, or proof that a database migration is deployed. Hosted CI/replay and staging outcomes must be recorded separately in the PR.
