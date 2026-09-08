# Objective and KPI editor keyboard navigation

This phase extends the existing monthly-entry focus pattern to Objective and KPI definition editors. No data model, SQL, permissions, scoring or approval transitions change.

- Tab and Shift+Tab stay among visible, enabled controls. Newly added indicators are included without rebinding. Hidden/inert fields, disabled fieldsets and negative tabindex controls are skipped.
- Opening focuses the named form title. A validation alert can re-enter the normal tab order; while all controls are disabled for a pending operation, the title retains keyboard focus.
- Explicit close returns to the original available launch control. If editing removed a side-panel button or saving rerendered a row, focus falls back to the visible New Objective / New KPI button, then reporting year. Hidden forms and focus already moved outside the editor do not steal focus back.
- Archive confirmations temporarily contain their own Tab navigation. The guard is removed on confirmation, cancellation or failure; other modules' confirmations are unchanged. After accepting, pending archive focus returns to the editor title.
- Escape and clicking outside the editor do not discard the editor. Existing busy/save/archive and draft safeguards remain in place.

## Verification

Run `node --test tests/kpi_editor_focus.test.cjs`. The tests are included in release readiness alongside existing save, archive and monthly-entry tests.

Reuse `node scripts/serve-kpi-archive-fixture.cjs` for browser checks with real forms, event handlers, upgrade hooks and CSS, and synthetic service responses only. Check 390x844 and 768x1024: title-to-first/last, boundary wrapping, dynamic indicators, validation, confirmation cancellation, pending controls and explicit close. The fixture omits external icon fonts. It is not certification on physical Android or an authenticated tenant.

This does not implement an application-wide modal manager, change other modules' focus policies, or fully extract editor state from the legacy core. Production promotion is a separate release decision.

## Local results (9 September 2026)

- 41 new keyboard tests, 1,017 full-suite tests and 584 release-readiness tests passed; no failures or skips. Offline manifest: 180 routes; 22 migrations unchanged.
- Browser skill checks at 390x844 and 768x1024 confirmed title-to-first/last, both boundary wraps, dynamically added indicators, no Escape discard, archive confirmation wrapping/cancellation with draft retention, pending archive title focus, failed-archive recovery and return to the launcher. Available recovery buttons were 44px high, with no horizontal page overflow or console warnings/errors.
- The dedicated Objective fixture confirmed empty-name validation with no write and Tab from the alert back to Close. The archive fixture also exposed a retained save/refresh-error state (it does not implement the full Objective list query); only available Close/Cancel remained in the focus loop. These are synthetic service outcomes, not production record tests.
- The initial focus-only phase did not change pointer-driven colour swatches. The follow-up below covers them; broader screen-reader behaviour, physical Android and authenticated role journeys remain uncertified.

## Objective colour follow-up (9 September 2026)

- The seven preset colours are now named native buttons. Tab reaches each choice; Enter/Space selects without submitting. Existing CSP click routes are retained. Each choice is 44x44px, and the palette wraps within narrow editors.
- Selection is shown by a checkmark, pressed state and a named live announcement, not colour alone. Reopening restores any saved preset case-insensitively; it no longer tries to parse removed inline click handlers. Custom saved colours remain unchanged unless the user chooses a preset.
- Pending saves/archive operations disable the colour buttons with the other fields. Saved/uncertain operations, hidden forms, disabled controls and non-palette values cannot change the selection. Failed saves preserve it.
- Run `node --test tests/kpi_objective_colour.test.cjs`. Nineteen new tests failed against the baseline and pass after the change. The combined colour/save/focus run passed 89 tests; the full suite passed 1,036 and release readiness passed 603, with no failures or skips. The regenerated offline manifest still contains 180 routes and the migration inventory is unchanged at 22.
- Browser skill checks used `scripts/serve-kpi-objective-fixture.cjs` and real form/CSP/CSS code with synthetic services only. At 390x844 and 768x1024, native Space/Enter selection made no write or close; pending saves disabled all colours; successful save/reopen restored Purple; failed save retained Red with the error inside the editor. All colours measured 44x44px, wrapped without page overflow, and no console warnings/errors were reported. External icon fonts are deliberately omitted by this fixture.
- This remains part of open, unmerged PR #97. No SQL, permissions, tenant records or production deployment are changed by this follow-up.
