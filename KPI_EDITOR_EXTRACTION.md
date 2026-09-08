# Objective and KPI definition editor ownership

The tested definition editor now lives in `kpi-definition-editor.js`, rather than in the shared `auris-core.js`. This is a compatibility-preserving extraction, not a new approval engine or a redesigned form.

## Owned here

- Objective open/create/edit, selected colour, validation, company/account/year checks, persistence verification and in-form save outcomes.
- KPI open/create/edit, stable indicator rows, historical-removal protection, save verification and partial-write feedback.
- The existing public function names and objective edit ID remain available to CSP dispatchers and the KPI upgrade hooks.

The file is a classic script, loaded once immediately after core, before the configuration, draft and workflow scripts. It does not access the DOM, call services, subscribe to events or write data on loading. It retains references to the existing global identity/RBAC/API services, people selectors, caches, rendering and YTD recalculation. Those dependencies are not yet independently injected or encapsulated.

## Explicitly not moved or changed

Shared modal handling, archive flows, monthly entry/clearing/calculations, dashboard/register rendering, draft storage and approval/source hooks keep their current owners. No SQL, dependencies, business policy, history migration or production record changes are part of this phase. Existing multi-write, cross-client concurrency and archive-flow limitations are not fixed by moving code.

## Verification and release

Existing Objective and indicator behaviour tests execute the whole feature file. Additional checks cover one implementation owner, inert loading, exact script order, CSP dispatch compatibility and wrapping by the real upgrade script. Both synthetic browser fixtures serve the complete feature asset before the actual upgrade/event scripts. Production and isolated-staging gates require the new asset and its editor functions; a missing/broken asset remains blocking. The offline manifest and syntax/size checks include it.

Run `node --test`, then `node scripts/release-readiness.cjs --report release-evidence/editor-extraction-readiness.json`. Use the synthetic Objective/KPI fixture servers for narrow/tablet smoke checks. No real customer records should be used as test data.

This improves feature ownership while preserving the released user experience. It is not complete module independence, authenticated end-to-end acceptance or physical Android certification. Deploy core, shell, feature and offline manifest together; never hot-swap only one file into an existing session.
