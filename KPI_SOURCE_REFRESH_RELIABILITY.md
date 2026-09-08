# KPI source refresh reliability

This phase repairs client-side refresh scheduling and configuration identity handling. It requires no database migration, permission change or business-record conversion.

## Behaviour

- The application's global lexical signed-in profile is recognised by both configuration persistence and source refresh. Tests and browser fixtures now reproduce that production script setup.
- The stored `real_time` setting is labelled **On each KPI load**. It refreshes on each deliberate load; hourly, daily and monthly intervals use the last confirmed calculation time. No background timer is introduced.
- Refreshes run serially, deduplicate pending work and allow retries after a one-minute failure backoff.
- Automatic refresh is limited to the current reporting year and month, recognised linked metrics, the selected company and existing authorised roles/module access. Historical/future-year browsing does not create automatic records.
- Manual and override rows already loaded in this client are preserved. Mapping revisions invalidate old calculation evidence.
- Account, role, company, year, month, data-set and mapping changes invalidate stale responses. A local result edited during a pending calculation is not replaced.
- Exact company, KPI, indicator, period, metric, source revision, numeric value and calculation timestamp are checked before accepting a response. Zero is a valid result.
- Failed refreshes preserve displayed values and show a visible retry explanation inside the reporting-cycle panel.

## Verification

Run `node --test tests/kpi_source_refresh_behaviour.test.cjs tests/kpi_configuration_persistence.test.cjs`. Both suites execute the real feature scripts using synthetic responses. Initial refresh regressions and production-shaped profile tests failed before the corresponding fixes.

The local-only browser fixtures are `tests/fixtures/kpi-source-refresh.html` and `tests/fixtures/kpi-configuration-persistence.html`. They use synthetic records, not authenticated production data. Both suites are included in release readiness.

## Limits and follow-up

The server remains authoritative for tenant access, calculation and audit. The refresh RPC does not accept an expected result revision: these client guards cannot prevent a different session's concurrent override from being overwritten on the server. Server-side atomic protection needs a separate migration after backup/recovery readiness is verified.

This phase does not redefine annual/quarterly aggregation, source metric business meaning, manual refresh/override workflows or calculation thresholds. Those remain separate acceptance and hardening work. Authenticated tenant acceptance still requires a signed-in staging account and a disposable test company. A synthetic fixture or passing deployment smoke check does not establish that acceptance.
