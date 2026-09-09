# KPI and inspection release integration

9 September 2026. This branch combines the already merged inspection repair
with the tested KPI preview chain ending at PR #105.

## Included work

- PR #106 pre-start checklist restoration and complete inspection reports.
- PR #101 integration of PRs #97-#100: editor focus, reporting cut-offs,
  narrow monthly-table visibility and configuration impact validation.
- PRs #102-#105: scorecard/export consistency, CSV and print text safety, and
  honest configuration-editor recovery.

The integration keeps the inspection version of `auris-core.js` and applies the
KPI print and keyboard-focus changes from the preview chain. Shared asset cache
keys and their contract expectations use one integration identifier. The
service-worker manifest is regenerated from the resolved tree.

## Verification

- Complete Node test suite: 1,227 passed, zero failures or skips.
- Release readiness: 794 passed, zero failures or skips.
- Synthetic 390x844 inspection acceptance: all ten checklist questions render;
  incomplete and failed saves retain the form and inline feedback; a successful
  save reopens with multiline observations; the full 21-item site report shows
  findings, actions, evidence and sign-off.
- Synthetic 390x844 KPI acceptance: scorecard and monthly views render; the
  monthly panel has independent horizontal and vertical scrolling; an eligible
  month retains its data-entry action.

No production business records were changed during verification.

## Release boundary

Production currently serves PR #96. Staging contains the additive inspection
columns and PR #106 staging acceptance passed. The production database is on a
Supabase Free plan with no managed backup, and a read-only query confirms all 18
inspection form columns are absent. Do not apply the migration or promote this
release until a recoverable production backup and restore procedure are
confirmed. The Odoo-like continuation automation remains paused.
