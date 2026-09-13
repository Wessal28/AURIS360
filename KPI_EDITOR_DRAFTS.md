# Objective and KPI draft workflow

The Objectives & KPIs definition forms now share a draft lifecycle through `auris-form-draft.js` and the `kpi-editor-drafts.js` adapter. Their existing validation, governance, indicator identity and write handlers remain authoritative.

- Editing shows an unsaved state. Close, Cancel and Escape require an explicit discard decision; Keep editing retains the form. Discard changes returns to the values loaded when the editor opened.
- Drafts use sessionStorage, scoped to company, account, role, reporting year and record. They expire after 24 hours and normally disappear when the browser tab closes. They are not an offline write queue or a backup. Storage failures are shown without claiming successful recovery storage.
- Reopening offers Restore draft and Discard changes. The form is disabled until that choice is resolved. Recovery preserves objective colour, reporting months, metadata and stable indicator IDs. Recovery waits for the people selectors to finish loading.
- If loaded values differ from the original draft baseline, the retained text is available for review and copying, with automatic restoration disabled. Older drafts without a baseline or save-outcome marker also remain review-only.
- Before a server write, recovery is marked unconfirmed. A failed or partial save cannot return as an ordinary restorable draft. Objective saves now disable repeat submission after any unconfirmed write, matching the KPI behavior. Successful save/archive clears the captured draft before closing.
- Browser reload/close warns while there are unsaved changes or a save is pending. In-app module navigation first closes or resolves the open editor; choose the destination again after resolving it.
- Current role is checked again at asynchronous save boundaries. These checks supplement existing server permissions and do not replace them.

No database migration is required for this slice. Existing objective/KPI schemas and governance are used.

## Verification

`tests/form_draft.test.cjs` exercises explicit recovery, isolation, expiry, baseline changes, storage errors and uncertain-write protection. `tests/kpi_editor_drafts.test.cjs` executes the shared controller and adapter to exercise both forms, discard/close, navigation, role changes, indicator identity and successful/partial outcomes. Existing objective, indicator, archive and governance tests cover their write paths.

The objective and indicator browser fixtures load the full feature files and real confirmation dialog. Their labelled interruption control simulates losing an open form without clearing tab storage. All fixture records and service responses are synthetic.

## Remaining work

KPI server revision checks and atomic parent/indicator persistence are now implemented in [KPI_ATOMIC_SAVE.md](KPI_ATOMIC_SAVE.md). Objective saves still need server conflict protection. This draft layer does not provide offline sync, cross-device recovery or completion of the whole Odoo-style roadmap.

Shared form adoption remains for Incidents, Risk, Inspections and Documents, followed by further configuration/reporting/integration adoption and representative role/device acceptance.
