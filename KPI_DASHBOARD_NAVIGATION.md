# KPI dashboard navigation reliability

Dashboard status cards and objective drill-downs describe all loaded KPIs for the selected company and reporting year. They now clear unrelated table filters, open the scorecard, synchronize the visible controls and move focus to the relevant filter. Overall Achievement and Open scorecard show the full register, including unscored records.

Review Exceptions selects **Needs attention (Off Track / At Risk / Data Missing)**: the union of those three existing calculated statuses. This is only a table filter, not a new stored KPI state. A zero-count drill-down shows no matches; it never substitutes unrelated records.

Normal search, objective, owner, frequency and status controls remain combined. On Monthly Follow-up they refresh the monthly table in place. All Statuses no longer returns to Dashboard. Reset clears these filters without changing the tab, reporting year, monthly/quarterly/annual view or saved columns.

## Verification and boundaries

- `tests/kpi_navigation.test.cjs` exercises the actual precompiled event dispatcher and the real module functions, including missing-only, mixed, zero-count, stale-filter and monthly interactions.
- `tests/fixtures/kpi-navigation.html` uses the real module installer, filter markup and event bundle with four synthetic records and no external API calls.
- Seventeen behavioral tests pass; thirteen failed against the previous implementation and four preserve existing behavior. Full suite: **763 passed**. Release readiness: **330 passed**, 179 offline routes and 22 ordered migrations unchanged.
- Browser checks at **390x844** and **768x1024** verified combined exception results, stale-filter clearing, objective navigation, All Statuses, monthly owner/status filters, focus and no page overflow. Console errors/warnings were empty. The synthetic tab was closed, viewport restored and exact helper process confirmed stopped.
- No scoring, reporting cutoff, workflow authority, business-data persistence, database migration or security changes. Tests do not establish authenticated tenant acceptance.
- Approval/source persistence, calculation-policy alignment, current-period readiness versus compiled-status semantics, and broader module conversion are separate work. In particular, Review overdue retains its existing Data Missing basis; this change does not redefine what is overdue.
