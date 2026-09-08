# Monthly KPI save outcomes

This bounded change makes manual monthly-entry saves reliable to understand and retry. It does not change scoring thresholds, YTD formulas, annual scheduling, approval permissions or database schema.

## Behaviour

- Validation and service failures appear in one focused, text-only alert inside the monthly form. A new attempt clears the previous alert.
- Explanation, root cause and evidence remain separate even while saving. The stored comment keeps the existing combined format; retries do not append those sections repeatedly.
- Pending saves disable the form controls and reject duplicate dispatch or a replacement entry. The company, account, KPI and reporting period are captured when opened and checked before writing and after asynchronous operations.
- Core saves explicitly report whether the value write succeeded and whether follow-up work completed. Failed value writes cannot trigger the upgrade wrapper's status synchronization or success audit.
- After a successful write response, the form latches the saved state before summary updates. If YTD recalculation, reload or final status synchronization fails, the form stays open with Save and Clear disabled. Close remains available. Users are told that the value saved and that they should reload/check it, not enter it again.
- The save-specific reload stages all four datasets before replacing caches, verifies that the saved month and its KPI/indicator are visible, and rejects late responses after a context switch. Ordinary unrelated module loading remains unchanged.
- Existing-result PATCH semantics, zero values, annual duplicate-month validation, late-annual audit fields and sum/average/last/min/max arithmetic remain unchanged.

## Verification

- 31 behavioural tests run the real save and upgrade functions, including the strict reload path. The initial 17-test baseline reproduced 15 failures; arithmetic and existing-row PATCH preservation already passed. The mock database was then corrected to merge PATCH fields rather than replace the row.
- Final full suite: **822 passed**. Release readiness: **389 passed**, zero failures/skips. Offline manifest: **179 routes**; ordered migration baseline: **22 migrations**, unchanged.
- A localhost-only fixture uses the production panel markup, CSS, static event dispatcher, core save/reload functions and upgraded hooks, with synthetic API responses. Run `node scripts/serve-kpi-monthly-save-fixture.cjs` and open its printed loopback URL. It never connects to an external database.
- Browser checks covered focused validation, retained failed-save text, disabled pending controls, partial-success warnings and explicit reopened edits. At 390x844, the alert fit within the scrollable form without horizontal page overflow. No production business records were created or changed.

## Limits and follow-up

This is client-side duplicate protection, not server-side idempotency or a database transaction. A failed network request may have committed remotely: the warning instructs the user to check the existing result before manually retrying; there is no automatic resubmission. The existing minimal-response write contract is preserved.

Draft retention lasts while the form remains open. It is not a new persistent browser draft store. Summary writes can partially complete; the warning does not promise rollback. Broader shared-cache lifecycle, concurrent writers, audit-service delivery guarantees and calculation-policy alignment remain separate work. Physical Android and authenticated disposable-company staging acceptance remain outstanding. No production SQL is needed.
