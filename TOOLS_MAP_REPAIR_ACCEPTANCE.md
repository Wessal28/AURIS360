# Tools and Master Action Plan repair

The production Tools & Equipment register failed because the previously committed inspection lifecycle migration had not been applied. It queried `tool_inspections.status`, which was absent. The migration `20260911030000_tool_inspection_record_lifecycle.sql` has now been applied to production. Verification found all six lifecycle columns, all four intended policies, 69 active inspections, and no invalid lifecycle statuses. Existing inspections remain retained. The policies enforce tenant reads and administrator-only permanent deletion of archived inspections.

Xtreme Touch Services Ltd still has four actions in production. The shared platform authentication adapter returned the administrator's home company while API reads used the selected company. The action workspace therefore discarded the selected company's records. The adapter now resolves the same company ID as API reads and writes, retains the real user profile, and uses an ID-only company object when the selected company's metadata is unavailable. Existing context checks reject stale record actions after switching companies.

The duplicate-tab CSS rule also hid action form navigation. It now targets only the top-level legacy register navigation, keeping Details, Assignment, Progress, Verification, Closure and Activity Log available.

Validation:

- Regression tests reproduced the home-company mismatch before the fix and pass after it, including company switching, missing metadata, ordinary users and signed-out state.
- Browser fixture using the actual platform adapter, action workspace, view engine and stylesheet shows four synthetic selected-company records, excludes the home-company record, opens the correct record, rejects a stale action after company switching, and preserves the action form tabs.
- Staging acceptance now explicitly queries the inspection lifecycle columns and active-status filter; a missing migration fails this gate.
- Full release and authenticated staging checks are required before promotion.

The production database repair is already applied. The application repair requires merging this change and promoting its deployment. Production browser sign-in was not available during this check; no production action records were edited.
