# AURIS360 Architecture Note - 2 July 2026

## Current Reality
AURIS360 currently has two large frontend files:

- `index.html` contains the active deployed application shell, shared infrastructure, page routing, role access checks and most module business logic.
- `app.js` contains older/shared application logic and KPI/SOP code, but it is not currently loaded by `index.html` with a separate `<script src="app.js"></script>` tag.

Because of this, fixes that affect the live app must be made in `index.html` unless and until the application is deliberately refactored to load `app.js` as a proper shared bundle.

## What Claude's `app.js` Explanation Gets Right
- The Supabase URL and anon key are public frontend configuration.
- Security must rely on Supabase Row Level Security, not hiding the anon key.
- `api()`, `authQ()`, company filtering, profile loading, role helpers and navigation are the core infrastructure concepts.
- People/company caches and dropdown helpers are important for replacing free-text fields with controlled lists.
- Shared utilities should eventually live in a dedicated shared file.

## What Is Outdated
- `app.js` is described as the foundation loaded before `index.html`, but the current `index.html` does not load it as an external script.
- The live page routing map in `index.html` is newer and includes modules that are not in the older `app.js` map, such as Fleet Management, ATEX Areas, Chemical Control, Approval Center, Audit Trail, Integrations and other recent modules.
- Current role handling is broader than the old `inspector / manager / admin / sephs_admin` level model. The active app also uses roles such as employee, contractor, supervisor, site manager, HSE manager, HSE officer, auditor and HR.

## Near-Term Rule
Until the client meeting is complete, prioritise stability:

1. Fix live issues in `index.html`.
2. Avoid broad refactoring.
3. Keep `app.js` changes separate unless they are proven to affect the deployed app.
4. Document smoke-test findings in `QA_SMOKE_TEST_2026-07-02.md`.

## Later Professional Refactor
After the client-facing readiness pass, split the frontend into maintainable files:

- `core/config.js` for Supabase and environment config.
- `core/api.js` for `api()`, auth and Edge Function calls.
- `core/auth.js` for login/session/profile handling.
- `core/rbac.js` for roles and permissions.
- `core/navigation.js` for `showPage()` and module access.
- `core/audit.js` for audit trail helpers.
- One module file per business area, for example `modules/incidents.js`, `modules/ptw.js`, `modules/legal.js`, `modules/chemical.js`.

This should be done carefully with browser smoke tests after each split, because the current single-file app is large and tightly connected.
