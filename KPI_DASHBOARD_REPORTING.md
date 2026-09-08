# KPI dashboard reporting completeness

Dashboard and Reports year-summary achievement now distinguish a missing score from a measured zero. No scores produces a dash with **No reported results**; a recorded zero retains **0%**. Existing non-empty average/worst calculations and reporting cutoff are unchanged.

Data Quality counts **KPIs with scores**, not `total minus missing` labelled Updated. Future/not-due and unconfigured KPIs are not treated as reported. A KPI with some scored indicators can still be missing required data, so the summary explicitly avoids equating a score with a complete submission. The management narrative no longer claims all results are available or under control when there are no scores. Status-rule guidance follows the published worst-indicator setting.

Twelve tests execute the actual calculation and rendering script, using a fixed clock and synthetic records. Ten checks fail against the previous version; two arithmetic/cutoff preservation checks already pass. The browser fixture uses synthetic records only and makes no external API calls.

Final full suite: **746 passed**. Release readiness: **313 passed**, 179 offline routes and 22 ordered migrations unchanged. Browser checks at 390x844 and 768x1024 covered missing results, measured zero, partial reporting, future-year, no-indicator and empty-register scenarios in dashboard/year summary. No page overflow or console errors/warnings. The fixture tab was closed, viewport restored and exact local-server process confirmed stopped.

No SQL, stored business records, permissions, scoring policy, status operators, thresholds, source assignments, chart benchmark or objective colour rules are changed. Authenticated business acceptance and server-side concurrency remain separate prerequisites. This is not a claim that all dashboard/impact-preview policy inconsistencies are resolved.

Separate navigation follow-up identified during inspection: Review Exceptions currently selects Off Track or At Risk only and retains other filters. Missing-only navigation and stale-filter behaviour need dedicated regression coverage; this presentation phase does not claim to fix those handlers.

Follow-up: that navigation issue is now addressed separately in `KPI_DASHBOARD_NAVIGATION.md`, with dedicated dispatcher and monthly-filter regression coverage. The results above describe the earlier reporting-completeness phase.
