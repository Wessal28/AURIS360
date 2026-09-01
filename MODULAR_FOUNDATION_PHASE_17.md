# Modular Foundation Phase 17 — Reusable Reporting & Analysis Engine

Phase 17 adds a shared analysis layer over tenant-scoped records already authorised by each source application.

- Applications declare reviewed dimensions and measures for KPI, pivot and chart presentations.
- Company filtering occurs before grouping, aggregation, rendering, CSV generation or drill-down callbacks.
- Personal reports store presentation metadata by company, user and application; record data is never written to browser storage.
- CSV generation contains aggregated report values rather than an uncontrolled raw-record export.
- Drill-down returns the exact authorised records in the selected group so the source application can reopen them through governed navigation.
- My Work is the reference adoption, including controlled group drill-down back into the existing exact-source record flow.
- Empty datasets, invalid definitions and unavailable browser storage remain controlled states.

This phase does not introduce cross-company analytics, generic database queries, automatic mutations, merge or deployment.
