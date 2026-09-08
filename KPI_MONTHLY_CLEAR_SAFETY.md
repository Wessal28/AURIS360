# Monthly KPI clear safety

## Behaviour

The existing Clear data action now captures company, account, KPI, indicator, year and month before opening confirmation. Confirmation names the record and period and explicitly warns that the monthly value and its explanation/evidence reference will be removed irreversibly. Cancelling preserves inputs and returns focus to Clear.

The form prevents duplicate confirmation, saving and replacement entries while clearing. Before DELETE it rechecks context, manager access, the available KPI/indicator and the established monthly-workflow policy. DELETE is explicitly scoped to the captured company, indicator, year and month.

A confirmed clear removes only that cached month, recalculates remaining YTD with the existing arithmetic, and uses a strict four-dataset refresh that verifies the cleared month is absent before closing with success. Failed or uncertain requests show focused text-only feedback inside the form. A confirmed clear followed by incomplete summary/refresh keeps Save/Clear disabled and retains Close so the value cannot accidentally be recreated or cleared again from that form.

## Verification — 8 September 2026

- 23 new clear-operation tests, plus one installed-save-wrapper regression test. Valid pre-implementation baseline: 23 failures, zero cancellations. A deferred baseline harness was corrected to release confirmation before awaiting duplicate calls.
- Full suite: **859 passed**, zero failures/skips. Release-readiness suite: **426 passed**, zero failures/skips. An initial full-suite failure exposed swapped JS/CSS cache-key expectations; corrected the expectations and reran the entire suite successfully.
- Service-worker manifest regenerated: 179 routes. No migration changes; the existing 22-migration disposable replay remains a hosted release gate.
- Browser skill used real entry/confirmation markup, core functions, module wrapper, dispatcher and styles with local synthetic responses only. Checked cancellation/retained values/focus, failed DELETE, summary and reload partial outcomes, changed-company responses and successful dismissal after refresh. Checked 390x844 and 768x1024 layouts; no page overflow, visible in-form alerts, enabled 44px confirmation buttons, and no console warnings/errors.
- The fixture now includes the real confirmation as a sibling of the monthly form. Its former panel extraction omitted the fourth closing div; corrected fixture extraction before browser acceptance. No production markup needed changing for this fixture defect. Test tab closed, viewport reset and task-owned helper stopped.

Local evidence: `release-evidence/kpi-clear-entry-baseline.txt`, `kpi-clear-entry-full-tests.txt`, `kpi-clear-entry-readiness.json`, and `kpi-clear-entry-readiness-output.txt`. Hosted PR/release status is recorded separately in the workspace progress log.

## Boundaries

No production business records were cleared or created, no production SQL was run, and no permission/scoring/approval policy was changed. No new dependency. This preserves the existing irreversible Clear operation; it does not add archival recovery, server idempotency, optimistic concurrency or a transaction spanning delete, summary updates and refresh. An uncertain network response still requires checking stored results before manual retry. Physical Android and authenticated disposable-tenant acceptance remain outstanding.
