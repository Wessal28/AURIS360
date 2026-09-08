# Objective and KPI archive safety

This phase repairs the existing archive journey. No SQL, dependency, scoring, reporting-calendar or approval-transition changes.

## Behaviour

- Actions say **Archive objective** / **Archive KPI**, retaining their original CSP handler IDs. The objective action now overrides its hidden-by-default CSS in edit mode.
- Capture the editor context and saved record identity. Refuse company/account/year/selection/access changes, hidden forms, duplicate operations and replacement/close/save actions while confirmation or requests are pending.
- Read the exact company-scoped record before confirmation. For an objective, read its KPI set across years rather than trusting the displayed scorecard cache. Name the saved objective/KPI, show the active-child count and warn that unsaved form edits are not saved. Cancel retains fields and returns focus.
- Use the existing governed definition-edit permission for every active KPI. Objective archiving cannot bypass a child's review, approval or locked state; missing workflow controls fail closed. Already archived children remain untouched.
- Recheck the confirmed set and each target before writing. PATCH is scoped by company and identity plus original relationship/year/name/code/status/lifecycle fields where available. Require the matching returned representation and refreshed rows. A changed/ambiguous response is not success.
- Do not delete indicators or monthly history. After verification, remove only archived records/indicators from active caches, preserve monthly values and unrelated data, rerender and clear successful KPI editor drafts. Do not use the legacy error-swallowing full loader.
- Partial/unknown writes retain a focused, text-only alert inside the form, the confirmed update count, disabled Save/Archive and available Close/Cancel. There is no automatic repeat archive. Close and reload to inspect saved state before retrying.

## Verification

`node --test tests/kpi_archive_safety.test.cjs` covers confirmation/cancellation, target/context changes, concurrency filters, workflow restrictions, pending guards, failure/partial outcomes, exact representations, history/cache/draft retention, child-set changes and accurate action labels. It is included in release readiness.

`node scripts/serve-kpi-archive-fixture.cjs` serves the real form/confirmation markup, complete definition editor, existing upgrade/event hooks and styles with loopback-only synthetic responses. No tenant database is contacted. Check 390x844 and 768x1024, including cancellation, pending controls, partial-child failure, source errors, controlled-child refusal and success. External icon fonts are omitted; this does not certify physical Android or authenticated role journeys.

## Remaining limitations

The cascade is multiple requests, **not a transaction**. Conditional updates and repeated checks reduce races but cannot make the entire objective/children set atomic: a new child may appear after the last precheck, and a partial archive may already exist when a later check fails. RLS and server authorization remain authoritative. Saturated (1,000-row) or invalid child responses stop the client; completeness under nonstandard server row limits or restrictive RLS is not guaranteed by this UI.

No restore action, backend archive RPC, server idempotency, consolidated audit event or history migration is added. Those require separately reviewed backend work after verified recovery readiness. No production record was archived for testing.
