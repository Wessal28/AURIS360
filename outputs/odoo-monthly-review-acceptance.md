# Odoo-like monthly KPI review acceptance

Date: 2026-09-13

## Implemented slice

PR127 (`codex/kpi-monthly-review`, tested head `5166a00`) adds a governed monthly KPI review lifecycle:

- Submit a complete past reporting month.
- Verify, approve, request revision, reject, and request/allow/deny a controlled reopening.
- Freeze reviewed history while allowing later reporting months to continue.
- Route submitter, reviewer and approver roles from the published KPI configuration.
- Record snapshots, fingerprints, revisions, actors, reasons and audit events.
- Return stale, busy and uncertain outcomes as controlled conflicts without automatic replay.

## Evidence complete

- Local full test suite: 1,379 passed, 0 failed.
- Hosted release-readiness checks for `5166a00`: run `34754127524`, successful; 886 checks passed.
- Migration validation: 32 ordered migrations passed.
- Local strict browser fixture: submit, verify, approve, request reopening and allow reopening passed.
- Local conflict and lost-response fixtures retained the reason and prevented duplicate retry.
- Migration SHA256: `5DDC43DEE31CBF61E9E7012CF24D3D2CB8FF14D4E081097911BCDEA3800F7666`.
- Odoo-like follow-up: the protected KPI review reminder worker now queues one idempotent reminder per assigned decision stage and UTC day, using the existing notification queue and email preference controls.
- Odoo-like follow-up: monthly review evidence can be downloaded as an exact-period JSON backup and reopened locally in a read-only preview. The preview validates tenant, year, month, route, fingerprint and review identity before showing any content and never writes to the database.
- Odoo-like follow-up: an unavailable or ambiguous approval route now presents an inline remediation handoff to the published Approvals section in KPI Configuration; the review remains fail-closed until the route is corrected and reloaded.
- Odoo-like follow-up: a manager or administrator can reassign the current reviewer or approver from the review form. The reassignment requires an active same-company target, a reason, an expected revision, a work-centre delegation record and an audit event; the original snapshot remains unchanged.

## Release gate status

The monthly review migration and PR127 release gate were completed according to the release confirmation. The reminder worker and delegation UI/migration are now implemented locally and covered by the focused contract tests; they still require the normal review, merge, staging migration rehearsal and promotion gate.

The delegation migration is self-contained for manual staging replay: it creates
the Work Centre activity/delegation tables and governed RPCs before compiling
KPI reassignment, so a partial paste cannot fail later with a missing
`work_item_delegations` relation.

## Remaining product work after this slice

- Apply and promote the new monthly-review delegation migration, then rehearse reassignment with a staging reviewer and approver.
- Offline/mobile physical acceptance with a real device.
- Backend archive/restore and a production backup rehearsal for review evidence.
- Adoption of the shared review pattern by the remaining governed modules.
