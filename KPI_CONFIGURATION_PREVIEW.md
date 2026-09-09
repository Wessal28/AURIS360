# KPI configuration validation and impact preview

This preview-only phase rejects empty, non-numeric and out-of-range status thresholds (including previously validated drafts before publication). Zero and fractional thresholds remain supported; At Risk must be below On Track. The visible band now states its exact inclusive lower and exclusive upper boundaries instead of subtracting 0.1 from the upper limit.

The configuration impact preview calls the scorecard's existing indicator and KPI evaluators with an explicit candidate configuration. Published and draft settings are compared at their respective compilation cut-offs for the selected year, using the currently loaded KPI definitions, indicators and results. Both status changes and score changes are reported. This fixes the former reuse of cached scores when changing aggregation and the incomplete handling of worst-indicator status.

Previewing does not swap the published configuration, mutate KPI caches, save monthly data, dispatch notifications or call an API. Existing runtime callers still use the published configuration by default. Formulas, target operators, status priority, annual/quarterly timing, approval policy and permissions are unchanged.

The preview is a snapshot at validation time, not a full-history, future-period, source-refresh, permission or approval simulation. The old inferred “Periods affected” count is removed. Missing calculation code/data and older impact summaries show an explicit unavailable/revalidate message, not manufactured zero impact. Validation can succeed without a preview; it does not certify reporting outcomes.

No migration or production data conversion is required. The client publication guard is not a substitute for database validation; the existing publication RPC still lacks an expected-revision parameter. Concurrent publication protection, verified recovery, signed-in tenant acceptance and physical Android checks remain separate work.

## Verification

- New behavioural regressions execute the complete configuration and upgrade scripts with synthetic responses.
- Existing configuration persistence, reporting, annual entry and governance suites preserve compatibility.
- Final local verification: 1,002 full-suite tests and 569 release-readiness checks passed. The new suite reproduced 17 failures in 26 cases before the fix. A separate comparison with main `05f73cfb7edead68193d487cd3528be2bd96f37b` matched 18,000 existing snapshot/cut-off combinations.
- The loopback helper `scripts/serve-kpi-config-preview-fixture.cjs` serves only the synthetic fixture and three necessary local assets.
- The fixture checks blank-threshold feedback, fractional bands, aggregation/cut-off previews and unchanged live settings at phone/tablet sizes. It is not real-company acceptance.
- Browser checks at 390x844 and 768x1024 confirmed visible blank-input rejection, zero/fractional ranges, average-to-lowest score/status changes, August-to-September cut-off changes and a future-year no-compiled-month preview. No document overflow or console warnings/errors; measured form actions and number fields were at least 44px high.

This independent branch starts from PR #96; it does not contain the separate #97 keyboard-focus, #98 zero-month row lookup or #99 narrow-table changes. Combining those previews requires a later integration test run.
