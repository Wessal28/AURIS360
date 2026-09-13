# Atomic monthly KPI reporting

Manual monthly Save and Clear use one database transaction for the value, all affected YTD totals, the persisted reporting status and audit evidence. The form captures the KPI definition revision and the monthly row identity/revision when opened. A later edit, clear, replacement, definition change or annual result in another month rejects the stale request with HTTP 409. Legacy monthly updates also advance the server-owned result revision.

The transaction locks the KPI before its monthly rows, sharing the definition-save lock. Separate-month saves serialize and calculate from committed history. It checks active manager/admin access, tenant and indicator ownership, reporting year, planned/elapsed months, annual uniqueness, review/archive state and manual-source ownership. Automatic refresh/override controls remain separate. Approved and locked definitions continue to allow manual results; an internal status-only update cannot alter definition fields or advance their revision.

YTD is calculated from recorded actuals using sum, average, last, minimum or maximum. The former editable YTD field was overwritten by the following recalculation; it now visibly serves as a read-only preview. Database sum/average rounding follows the existing Math.round direction, including negative ties. Detailed missing/open/not-due statuses continue to be derived in the reporting views and map to not_started in the four-state persisted reporting field. Other saved statuses follow the published operator, threshold, aggregation and current-period configuration. Server reporting cutoff uses the UTC calendar.

The browser publishes only a complete transaction acknowledgement. An uncertain response or conflict retains explanation, root cause and evidence, disables repeat writes, and leaves Close available. The user closes and reloads to review current records before making another edit. A confirmed save followed by refresh failure clearly says the value and totals were saved. A newer result during refresh cannot silently replace the acknowledged result. These are revision-safe transactions, not automatic idempotent retry or persistent draft recovery after closing the form.

## Release prerequisite

Apply `supabase/migrations/20260913050000_kpi_monthly_atomic_save.sql` to staging and production before deploying this client. It adds four routines and one trigger and replaces the two definition guards to support an exact internal status-only update. It does not add tables or columns, delete business data, or change RLS/storage policies. Never apply the replay fixtures to Supabase. Migration deployment and production promotion require separate recorded evidence; local files do not establish that those actions occurred.

## Validation

- Real form and installed-wrapper tests cover captured versions, zero, separate comments, duplicate dispatch, conflicts, malformed/lost acknowledgements, context switching, clear confirmation and refresh failures.
- Disposable PostgreSQL tests prove save/clear audit rollback, later-month totals, all five YTD methods, legacy revisions, replacement identity, locked definitions, tenant/role denial, annual audit and source separation.
- Competing authenticated SQL sessions exercise same-month create/edit, clear versus save, different-month totals, legacy updates, definition changes and annual uniqueness.
- 180 database status/operator/configuration results are compared with the real browser calculation.

The broader monthly submission/verification/approval workflow, source-refresh transaction hardening and archive/restore remain later work.
