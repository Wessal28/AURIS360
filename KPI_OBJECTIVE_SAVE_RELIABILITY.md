# Objective form save reliability

## Delivered behaviour

- Opening captures company, account, selected scorecard year and objective identity. An already open form is retained; the upgraded New Objective launcher cannot overwrite its year. Pending saves block another save, close, replacement, colour mutation or archive dispatch from this form.
- Required name/year validation and service errors use a focused, text-only alert inside the form. Controls have associated labels, the form is named, and the close button has an accessible name. The panel fits narrow screens with readable fonts and touch-sized fields/actions. Explicit idle close returns focus to an available launcher. Full keyboard/assistive-technology certification is not claimed.
- Code lookup and edit PATCH are scoped to the captured company. Context and manager access are rechecked after asynchronous work. Creation retains created_by; editing does not rewrite the original creator. This does not change database permissions.
- Save requests a returned record and checks identity/fields. Missing or mismatched returned identity is not success and disables another write until explicit close/reload. A confirmed save followed by verification, refresh or display failure is reported as a partial outcome with Save disabled and Close available.
- Successful saves verify the exact persisted objective, refresh only the selected year's objective list, and leave KPI/indicator/monthly caches intact. The form closes only after verification/rendering. The existing ability to select a different objective year is preserved; success names that year without switching the scorecard year or moving child KPIs.

## Verification — 8 September 2026

- 29 new behaviour tests. Initial 25-test baseline: 24 failures and one close/reopen pass. Additional cases cover late list responses, different target years, retained-launcher behaviour and edited objectives moving out of the current year.
- Final full suite: **888 passed**, zero failures/skips. Release readiness: **455 passed**, zero failures/skips. Service-worker manifest current at 179 routes. Existing 22-migration replay remains a hosted gate; no SQL migration changed.
- Browser skill QA used local synthetic data with actual Objective markup, handlers, core functions and styles. Checked 390x844 and 768x1024: focused validation, input retention after write failure, disabled pending controls, saved/refresh-failed feedback, changed-company response, missing returned identity, successful creation and updating into another year, close/launcher focus, 44px controls and no horizontal overflow. The local fixture models filtered objective reads. No external APIs or tenant records were used. Icon font, physical Android, full keyboard navigation and signed-in tenant acceptance remain separate.

Local evidence: `release-evidence/objective-save-baseline.txt`, `objective-save-full-tests.txt`, `objective-save-readiness.json`, `objective-save-readiness-output.txt`. PR and production status are tracked separately in the workspace progress log.

## Boundaries and follow-up

This is a bounded improvement to the existing Objective editor, not a new competing workflow or a conversion of every module. No production data/schema changes, new dependency, scoring/approval-policy change, bulk operation or archive redesign. Client guards do not provide server idempotency, optimistic concurrency or transactional multi-record updates. Code numbering still uses the existing maximum-code lookup and can race between clients. A network failure may have an uncertain outcome; check existing objectives before manually retrying. Explicit close discards this form's unsaved values as before; durable cross-session draft storage is not added here.
