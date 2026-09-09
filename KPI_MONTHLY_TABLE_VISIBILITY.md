# Monthly KPI table visibility

## Behaviour

The three frozen identity columns occupied approximately 449px in a 299px phone panel. Horizontal scrolling moved the periods, but their cells remained covered by the name columns.

The scroll panel now provides a named inline-size query context. At panel widths of 760px or less, KPI and Measurement Indicator lose only their horizontal sticky offsets. Code stays pinned; column headers remain sticky vertically. Wider panels retain all three frozen columns. A scoped viewport fallback applies below 1100px on browsers without container queries.

No columns, text, targets, reporting periods or results are removed. There are no JavaScript runtime, calculation, permission, approval, schema or business-record changes. The existing native scrolling and entry event routes remain authoritative.

The previous standalone fixture suggested white monthly header text. Testing with the application's local stylesheet order showed readable grey headers, so this phase does not change header colours or claim a production contrast bug.

## Verification

- Ten new tests cover the scoped CSS rules, fallback, retained sticky headers/code, keyboard scroll region, real Monthly/Quarterly/Annual rendering, column counts, row IDs, measured zeroes, N/A, editable routes and read-only restrictions.
- Baseline: 3 failed CSS contracts and 7 passing existing-behaviour/fixture cases. All ten pass after the change. Combined with monthly navigation: 22 passed.
- Full automated suite: 986 passed. Release readiness: 553 passed. No failures or skips. Offline manifest: 180 routes; ordered migration inventory unchanged at 22.
- Browser skill checked 390x844, 768x1024, 1024x768 and 1280x900 using actual KPI markup, the upgrade script, CSP event handler and 85 local stylesheets in application order with a synthetic shell and records.
- Narrow 299px, 701px and 598px panels released the two name columns. An 882px panel retained offsets 64px and 224px. Code retained its zero offset throughout. No horizontal document overflow was observed.
- Native Tab/Enter and December click/Space dispatched the expected synthetic entry request. DOM hit testing confirmed December was exposed, not covered by a frozen column. Vertical scrolling to the final rows retained the headers at the panel top. Monthly, Quarterly and Annual retained 23, 15 and 12 columns respectively.
- The initial synthetic entry stub allowed hydration without the real core's entry globals and produced a fixture-only error. It now returns false after recording the request, deliberately avoiding fake form hydration. A fresh final phone tab had no warnings/errors.

Use `node scripts/serve-kpi-table-fixture.cjs` for loopback-only QA. No tenant API is connected; entry requests are recorded in the visible fixture status, not saved. Browser results do not establish real-device Android, full application boot, authenticated identity/role or database acceptance. The older-browser fallback has a CSS contract, not a legacy-browser execution test.

## Release boundary

This independent branch starts from the held main / PR #96 commit, not unmerged PR #97 or #98. Their editor and cut-off improvements are separate pending previews; this branch's lower test count does not remove their tests from those branches.

Keep this phase open/unmerged, with no auto-merge or production promotion. PR #95 remains the last verified live release; PR #96 promotion is held for explicit approval. No Supabase SQL is needed.
