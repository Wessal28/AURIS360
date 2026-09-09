# Configuration editor recovery

This preview removes the legacy decorative configuration fallback in `kpi-module-upgrade.js`. Missing editor code previously displayed inert navigation, an invented example, unconditional status rules and an unverified missing-schema claim. A synchronous renderer exception could leave partial content instead.

## Behaviour

- The existing configuration renderer remains authoritative when available.
- A missing or synchronously failing renderer now displays a clear unavailable message and a single **Retry editor** action. Raw exception details are not inserted into the page.
- Retry calls only the currently loaded renderer. It does not fetch scripts, reload the page, load configuration, save, validate or publish anything.
- Failed keyboard retries retain focus on Retry. Recovery moves focus to the real editor heading. Ordinary background renders do not steal focus; hidden, detached and stale retry controls cannot re-render a different view.
- Existing in-memory draft and published state are untouched. Reload remains a manual last resort, with a warning to finish unsaved work first; this is not a new durable draft-storage guarantee.
- Retry is at least 44px high under the application's actual mobile stylesheet cascade. No scoring, permission, approval, database or configuration-service changes.

The current renderer is synchronous. This boundary is not an asynchronous rejection handler or a replacement for the configuration service's own loading, persistence and database diagnostics.

## Verification

`tests/kpi_config_editor_recovery.test.cjs` exercises the real upgrade script with synthetic DOM/services: 17 cases, initially 15 failing and 2 passing. Covers missing/throwing renderers, partial markup, safe text, retries, focus, stale/hidden controls, missing host, untouched state and no service operations. Added to release readiness. Related persistence/preview targeted suites: 64 passing tests.

Full suite: 1,206 tests. Readiness: 773 tests, 180 offline routes and 22 unchanged migrations. Evidence is under `release-evidence/config-editor-recovery-*`.

The local allowlisted `/config-recovery` fixture loads actual KPI markup, configuration/upgrade/event scripts and all 85 application stylesheets, with synthetic services only. Native Enter/Space at 390x844 and 768x1024 verified missing/throwing recovery, retained 93/92 unsaved threshold drafts, real heading focus and 44px Retry controls without document overflow. Visible fixture evidence recorded zero service calls/writes during failure/recovery and unchanged published/monthly records; no console warnings/errors. The fixture's initial wrong tab key was corrected before final verification. A shared mobile rule initially won at 42px; the final control selector is scoped to both KPI page and configuration view.

This is not signed-in tenant, physical Android, screen-reader or production acceptance. No real records or publication operations were used. Stack follows the print-text preview; production promotion and database/recovery gates remain separate.
