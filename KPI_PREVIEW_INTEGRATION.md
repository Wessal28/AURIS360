# Combined KPI preview integration

9 September 2026. Preview only; this document does not claim a production release.

This evidence records the #101 integration checkpoint at `0ac5e08a69b7e8aad471e55a16b01cba128ae4dc`. The subsequent reporting changes are documented separately in `KPI_REPORTING_CONSISTENCY.md`.

## Preserved sources

| Source PR | Exact integrated head | Scope |
| --- | --- | --- |
| #97 | `80e1663249c590c68fbb126b6090527f4e6ac26d` | Editor focus, objective colour controls and indicator navigation |
| #98 | `3068e79b52fbcd93ea3998096f04b3702798d77d` | Explicit zero-month reporting cut-offs |
| #99 | `d471225dd2f922c37470ce64835296505c0602ea` | Monthly table visibility in narrow panels |
| #100 | `1106a4e3521c2042176e759bcac876a94ddcd5e5` | Threshold validation and real configuration impact preview |

All four source heads remain ancestors of this integration branch. The editor is unchanged from #97; configuration is unchanged from #100; the upgrade script is exactly #100 plus the two #98 zero-month lookup corrections. Cache and generated manifest conflicts retain every feature and one asset reference per script. The new unified cache key is `20260909-preview-integration-1`. The offline manifest retains 180 routes; all 22 database migrations are unchanged.

## Combined verification

- Seven new behavioural cases exercise the actual configuration and upgrade scripts together: excluded January, draft isolation, synthetic publication with zero/nonzero actuals, past/future years, annual not-due state and editor/style routing preservation. Only the synthetic configuration service can receive writes; stored monthly rows must remain unchanged.
- Final full suite: **1,122 passed**, no failures or skips. Final readiness: **689 passed**, no failures or skips. These totals include the four previously independent preview suites.
- Browser checks used synthetic records and the actual KPI markup, configuration/upgrade scripts and all 85 local stylesheets in application order. At 390x844, validating an included-January draft compared 18 loaded KPIs, changing 16 scores/statuses while the live table retained no compiled YTD. Synthetic publication then showed YTD 20, with five configuration writes and unchanged monthly records. Enter on January routed the correct synthetic indicator/month.
- The real editor fixture retained focus after adding/removing indicators and saving an existing-ID rename. Its August value of 4 remained attached to the same indicator. No real record was saved.
- Phone panel width 329.6px and tablet panel width 731px released the name/indicator horizontal offsets while Code remained pinned. At 1280x900, the 975.2px panel retained the 64px/224px offsets. Tablet horizontal/vertical scrolling worked, with headers 1px below the panel top. No document overflow. Future-year reporting retained no compiled YTD. Fresh final tablet console had no warnings/errors.
- The browser does not support the native publication prompt. Only the synthetic fixture supplies a fixed test reason; the application's real prompt is unchanged. Earlier error-bearing temporary tabs were discarded before the final check.

Reproduce automated checks with `node --test` and `node scripts/release-readiness.cjs --report release-evidence/preview-integration-readiness.json`. For local browser QA, run `node scripts/serve-kpi-preview-integration.cjs` and open its printed loopback URL. Editor QA uses `node scripts/serve-kpi-indicator-fixture.cjs`. Both helpers serve synthetic test fixtures only.

Local evidence: `release-evidence/preview-integration-full-tests.txt`, `preview-integration-readiness.json`, `preview-integration-readiness.txt` and `preview-integration-source-preservation.json`.

## Release limits and remaining acceptance

This branch adds no SQL, dependency, approval-policy or formula changes beyond the documented source fixes. It does not publish tenant configuration, enter real monthly data or send notifications. Browser fixtures omit external icon fonts and do not certify physical Android, screen readers, signed-in tenant roles, source refresh or full-history configuration impact.

Keep this integration PR and #97–#100 open and unmerged until the release hold is resolved. PR #95 is the last verified live release; #96 remains staged and requires the previously requested explicit two-domain promotion approval. Do not retry a denied promotion through another route. Production SQL still requires verified backup/recovery. Hosted CI and isolated staging results must be recorded separately before any release decision.
