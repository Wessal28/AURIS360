# KPI configuration persistence reliability

This change hardens the existing configuration editor without modifying database schemas, server permissions, KPI approval transitions or production records.

## Behaviour corrected

- Save an unchanged new draft before validation uses its ID.
- Invalidate validation immediately when any setting changes or published defaults are restored through Discard.
- Preserve edits made while an earlier save/validation is pending. A routine same-company refresh does not discard the unsaved draft.
- Accept a save, validation or publication only after an exact company/record response is confirmed. Empty responses no longer count as success.
- Scope version writes to company, editable state and the loaded update timestamp when available. Reject duplicate operations and changed account/company/role contexts.
- Clear old company configuration before loading another company and ignore obsolete responses. Missing optional audit history is disclosed without discarding a successfully loaded published version.
- Show errors inside the configuration view, retain typing focus, use the inherited application font and minimum 44px controls.

Database RLS and the existing publication RPC remain authoritative. The client guards are not a substitute for server enforcement or complete cross-session transaction/version validation. In particular, the RPC does not accept an expected revision; a later database-hardening phase should assess atomic validation/publication and immutable published versions after recovery readiness is established.

## Verification

`node --test tests/kpi_configuration_persistence.test.cjs` runs behaviour tests against the actual configuration script with synthetic API responses. They cover real save/validate/publish sequencing, unchanged live defaults before publication, empty responses, pending edits, obsolete loads, role changes, duplicate requests, self-approval mirroring and visible failures. Eight initial regression scenarios failed against the previous implementation before being fixed.

The suite is part of release readiness. The local-only fixture `tests/fixtures/kpi-configuration-persistence.html` exercises the same editor with synthetic data and no external API calls. It is not a production deployment asset or an authenticated tenant-acceptance substitute.

## Follow-up functional audit findings

The remaining controls have code consumers, but that alone does not establish correct end-to-end behaviour. Preserve these findings for separately tested changes:

| Setting | Current consumer / limitation found by inspection |
|---|---|
| On Track / At Risk thresholds | `kpiXEvaluate` and `kpiXKpiSnapshot`; the On Track threshold is applied to aggregate classification when the critical override is disabled, not uniformly to indicator classification. |
| Zero-tolerance override | `kpiXEvaluate`; changing the toggle must be checked against the zero-tolerance operator's underlying calculation. |
| Critical override | `kpiXKpiSnapshot`; worst indicator status is used without a separate critical-indicator flag. The wording needs comparison with the intended policy. |
| Exclude open current period | `kpiXCompilationMonth`; verify current, prior and future years and the annual reporting window. |
| Objective aggregation | The selected mode affects indicator aggregation within `kpiXKpiSnapshot`. Check objective-level roll-up and label accuracy before claiming objective aggregation is complete. |
| Default source | New KPI editor defaults only; `integration` currently maps to `Evidence / document`, not an external integration connector. |
| Refresh frequency | `refreshInterval` treats the real-time interval of zero as a falsy value and falls back to daily. Automatic attempts are also remembered for the session/period; this needs dedicated scheduling/identity tests. |
| Allow manual override | `canOverride` controls the UI and the database RPC applies the published-policy rule. Verify authorised roles, reasons, audit and refresh interaction in staging. |
| Stage 1/2/3 and self-approval | New-KPI defaults and person routing; local mirroring is tested. Existing KPI assignments are intentionally preserved. Live identities, permissions and approval requests still need signed-in acceptance. |
| Publication reason | Required by the client when configured. Verify server-side enforcement separately; this change does not add a migration. |

Do not describe all configuration priorities as completed by this PR. Remaining items need their own regression cases and review; changing calculation or approval meaning must be explicit.
