# KPI reporting-period cut-off

## Correction

The published setting to exclude the current open month already returns a compilation month of zero in January. Future reporting years also return zero. The latest/previous-row helpers incorrectly treated that explicit zero as a missing argument and searched through December. This could show a later stored YTD value in Monthly Follow-up even when no period was eligible for compilation.

The helpers now default to December only for a missing or null argument. An explicit zero returns no row. Positive cut-offs, previous-row exclusivity, measured zeroes, past-year results and backdated annual entry keep their existing behaviour.

This is a two-line runtime correction with a JavaScript cache-version update and regenerated offline manifest. It does not change stored records, monthly entry permissions, calculation formulas, approval policy, reporting calendars or database schemas.

## Regression and browser evidence

- The 19 new tests execute the actual upgrade script. Before the correction, 8 failed and 11 passed.
- Coverage includes January exclusion/inclusion, monthly/quarterly/annual KPIs, past/future reporting years, all positive month cut-offs, null/omitted arguments, measured zero, December, annual backdating and unchanged raw-month entry availability.
- Targeted period/dashboard/annual suites: 35 passed.
- Full suite after updating an obsolete cache-version expectation: 995 passed, no failures or skips.
- Release readiness: 562 passed, no failures or skips; offline manifest contains 180 routes. No migration was added.
- Browser QA used the real upgrade script with synthetic data and a fixed January clock at 390x844 and 834x1194. Excluded January and future years showed no compiled YTD; included January showed 20; a completed prior year showed 159. Dashboard and Reports summary switched between no scored results and 20% as expected. No browser warnings/errors were observed.

The local helper `node scripts/serve-kpi-cutoff-fixture.cjs` binds only to loopback and serves `tests/fixtures/kpi-period-cutoff.html`. The fixture does not call tenant APIs. Its table scaffold deliberately disables frozen columns and supplies header contrast to expose result cells; this is calculation QA, not proof of full-app mobile layout or physical Android acceptance.

## Boundaries and remaining findings

- Raw current-month cells can still show entered data when that month is excluded from compiled summaries. Stored data is not removed.
- The small row trend still uses raw results across the year, including rows after the compiled cut-off. Its six-month label and period policy need a separate reviewed change.
- CSV export uses the reporting month, not the compilation month. Export/print consistency is not changed or claimed complete here.
- Standalone upgrade CSS has white header text against a pale monthly-table background; frozen columns also obscure result cells on narrow screens. Verify the complete application's stylesheet cascade before a separate layout correction. Fixture-only scaffolding is not a production fix.
- Objective aggregation, zero-tolerance policy and live identity/role acceptance remain separate work.
- Keep this phase preview-only and unmerged while the existing release boundary is unresolved. It does not authorize production promotion or SQL execution.
