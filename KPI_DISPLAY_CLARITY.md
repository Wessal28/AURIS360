# KPI display clarity

This phase changes labels and missing-result presentation, not scoring, database contents, permissions or persisted configuration keys.

- Calculation settings now say **Indicator aggregation within each KPI**, with average/lowest indicator achievement options. Objective totals remain the average of reported KPI scores.
- The legacy `integration` source-default key is labelled **Evidence / document**, matching the editor it actually supplies. Help text makes clear this is not an external connector and does not configure indicator metrics.
- Threshold help distinguishes score-based KPI status from indicator target checks. The old critical override label now describes its actual worst-indicator status behaviour. The zero-tolerance override explains that the operator already scores a non-zero value as zero.
- Dashboard and scorecard objectives without calculable reported scores show **No reported results**, without a red zero bar. Genuine measured zero remains **0%**. Partial averages continue to exclude missing scores; dashboard wording discloses the reported-score basis.

## Tests and limits

Ten behavioural tests execute the actual configuration/calculation/render scripts. Six regression examples failed before this change; checks preserve existing target/operator classification, within-KPI aggregation, objective averaging, genuine zero and escaping. The suite is part of release readiness. The local-only fixtures `tests/fixtures/kpi-display-clarity.html` and `tests/fixtures/kpi-configuration-persistence.html` contain synthetic records and are not authenticated tenant acceptance.

Final local verification: 734 full-suite tests and 301 release-readiness checks passed, with no failures or skips. Phone-width browser QA (390x844) verified the missing/zero/partial-result distinction, contained help text, selectable renamed choices, and a save/reload retaining both aggregation and source values. No console errors or warnings. The local fixture was closed and its server stopped after verification.

Unifying indicator/KPI thresholds, objective colour thresholds, overall no-data metrics, scoring/impact preview calculations and cross-session server guards remains separate work. This phase does not silently redefine that policy, claim an external integration, or apply a migration.
