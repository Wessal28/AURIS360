# Monthly KPI entry accessibility

Bounded follow-up to PR #90. No schema, reporting, calculation, permission, approval or business-write contract changes.

## Changes

- The real monthly-entry markup identifies the dialog by its reporting-period title and describes the KPI and target.
- Actual, YTD, performance explanation, root cause and evidence controls have associated labels. The icon close control has an accessible name.
- Opening focuses the title, without automatically opening a mobile numeric keyboard. Tab and Shift+Tab wrap through enabled, rendered controls within the dialog; hidden annual-period and Clear controls are skipped.
- A pending save focuses the title after disabling controls, preventing the browser from moving focus to the page behind the dialog. Error feedback remains focused inside the retained form.
- Explicit close returns focus to the original launcher only when it remains connected, rendered and enabled, and focus is still in the open form. Re-selecting an annual reporting month preserves that launcher. Detached or hidden launchers are not focused.
- Scoped styling keeps fields in the application font, buttons and inputs at least 44px high, and textareas at least 100px high, including the older important mobile overrides. Mobile text fields retain the application's 16px input font.
- The existing explicit-close behavior and separated explanation/evidence values are preserved. Escape handling and approval/reporting rules are unchanged.

## Verification

- Thirteen new tests exercise real core functions, markup and style contracts. Before implementation, the valid baseline had 12 failures and one pass; an initial missing test-harness brace was corrected before recording that baseline.
- The pending-save regression now starts with the Save control focused, matching the browser interaction.
- Full suite: 835 tests. Release-readiness subset: 402 tests. Existing monthly-save failure, partial-success, annual-period and company-context protections remain covered.
- Synthetic browser fixture uses the production panel markup, styles, core entry functions, static dispatcher and module hooks. Its previous fixture-only dialog naming was removed so semantics are verified from the real markup.
- Browser checks: 390x844 and 768x1024 portrait layouts without panel horizontal overflow; associated labels; 44px visible buttons/inputs and 100px textareas; initial focus; forward/backward Tab wrapping; pending-save focus; partial-save feedback and enabled Cancel/Close navigation; retained explanation on Escape; synthetic successful save and return focus.
- The local fixture makes no external requests and uses no tenant records. It omits the external icon font, so production icon rendering is not claimed from this fixture. Physical Android hardware and authenticated staging-company acceptance remain separate checks.

## Release

Only the core and KPI module JS/CSS cache keys and generated service-worker manifest change. No SQL migration is required. Normal hosted release and staging checks must pass before merge; production promotion remains a separate release decision.
