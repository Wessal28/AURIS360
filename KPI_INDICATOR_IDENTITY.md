# KPI indicator identity and save outcomes

The KPI editor now uses the persisted indicator ID, not its mutable name. Renaming or reordering a retained row updates that same record, preserving its monthly results and configured source relationship. New rows receive new IDs; same-name existing rows remain distinguishable.

## Changes

- Existing row IDs survive form opening and browser draft recovery. Version 2 drafts store explicit IDs. Older drafts recover an ID only for a unique exact-name match; ambiguous or previously renamed legacy draft rows are not guessed by position. Historical-removal checks provide a Restore indicator action while retaining other draft edits.
- Indicator names and custom units are assigned as DOM values/text, not interpolated input markup. Advanced zero/trend operators retain their selected value when reopened.
- Preflight validates row identity, original company/account/year, manager access, editable workflow state, selected objective and indicator history before writes. History lookup failures are not treated as empty history. A pending people refresh asks the user to wait instead of retaining disabled person controls after a failed save.
- Writes target exact parent/indicator/company identities. Editing does not overwrite the creator. Returned rows and a final scoped definition/history refresh must match before success. Only the edited KPI and its indicators/monthly cache are replaced; unrelated caches stay intact.
- Duplicate saves, close/replacement and add/archive controls are blocked while saving. Unconfirmed or partial writes retain entered values, disable repeat saving and keep Close/Cancel available. Errors and restoration are focused inside the editor. Person refresh and draft hooks respect the pending/changed context.
- Existing YTD arithmetic is reused with the saved indicator definition and strict error propagation. Calculation policies, reporting schedules, approval transitions and database schemas are unchanged.

## Verification

`node --test tests/kpi_indicator_identity.test.cjs` exercises actual functions with synthetic data: rename/history identity, same-name IDs, invalid/duplicate IDs, removal with and without data, restore without discarding edits, draft recovery, context/workflow changes, pending operations, failed writes, strict returned rows, target null versus zero, create/edit and safe refresh.

`node scripts/serve-kpi-indicator-fixture.cjs` serves only allowlisted local fixture assets. It combines the real editor markup, core, module/draft hooks, delegated controls and styles with synthetic API responses. No tenant records, SQL, notifications or external services are used.

Final local result: 30 targeted tests, 918 full-suite tests and 485 release-readiness tests passed with zero failures/skips. The manifest contains 179 routes; 22 migrations are unchanged. Logs are under `release-evidence/indicator-identity-*`. Initial 20 regression cases failed before implementation. A preliminary full run found an outdated variable-name contract and stale manifest; both were corrected before final runs.

Browser QA at 390x844 and 768x1024 verified identity/name/operator draft recovery, successful rename with the same August history, retained partial-save feedback, disabled pending controls/title focus, safe switched-company response handling, historical-removal feedback and restoration without discarding the other draft row. Controls met the 44px minimum and no horizontal page overflow was seen. The local fixture omits the external icon font; icon rendering and physical Android are not claimed. Final console errors/warnings: none.

## Limits and follow-up

This is not a transaction, server idempotency mechanism or optimistic concurrency protocol. Multiple definition/indicator/YTD writes can partly succeed. The form deliberately stops and instructs the user to reload/check the saved KPI rather than automatically repeating them. An ambiguous network response requires checking existing records before retrying, especially for creation.

The historical-removal preflight is not atomic with deletion; a concurrent writer can race it. Existing database permissions/triggers remain authoritative. Server-side atomic save/removal and cross-session conflict handling require a separate reviewed migration after production recovery readiness is established. No pre-existing split indicator/history records are automatically consolidated, and this change does not redesign KPI/objective archival or backfill imported identities.

Older drafts without identifiers can require manual reconciliation: restore the historical row, transfer the intended changes, and remove an unused new draft row. Advanced-operator persistence is preserved, but no scoring-policy interpretation is changed. Physical Android, authenticated disposable-company acceptance and full keyboard/assistive-technology certification remain separate gates.
