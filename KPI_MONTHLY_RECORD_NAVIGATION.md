# Reliable KPI-to-monthly navigation

**Open Monthly Data** now clears unrelated scorecard/monthly filters before showing the selected KPI. It preserves the reporting year and monthly/quarterly/annual table view, closes the drawer only after the target row exists, and focuses and scrolls that row into view. The lookup is scoped to the monthly table instead of the whole document.

The old delayed scroll is removed: rendering is synchronous, so no callback can later scroll another tab or company context. Identifiers are compared as data, without constructing a CSS selector from record values.

If the KPI is no longer loaded, its parent objective or measurement indicators are unavailable, or the monthly table cannot be displayed, a focused alert remains inside the drawer. No background-only toast or silent drawer dismissal is used when the drawer is available.

## Verification

- Twelve behavior tests use the actual event dispatcher and module functions. Ten regressions failed on the prior version; two preservation checks already passed.
- Full suite: **775 passed**. Release readiness: **342 passed**, 179 offline routes and 22 ordered migrations unchanged.
- Synthetic browser checks at **390x844** and **768x1024** verified stale-filter clearing, correct row focus, preserved annual view/year, and visible in-drawer messages for missing indicators and obsolete records. No page overflow or console errors/warnings. The fixture tab was closed, viewport restored, and exact helper process confirmed stopped.
- Read-only/locked KPI data-entry controls stay governed by the existing permission checks. This fix opens the table; it does not grant editing rights, create results, modify workflow states, change scoring policy or require SQL.
- Authenticated tenant acceptance remains outstanding; synthetic fixtures are not production business-record tests.
