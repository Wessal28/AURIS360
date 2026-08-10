# Core Control rollout preflight — 10 August 2026

## Scope

- Supabase project: AURIS360 / SEPHS Consulting Ltd
- Cohort: Core Control
- Modules: Master Action Plan, Incident Management, Audits & Inspections, Risk Assessment
- Validation mode: read-only database and unauthenticated application inspection
- Cohort activation: not performed

## Evidence captured

### Database gate

The deployed controlled-rollout migration is present. Nine checks passed:

- cohort table exists;
- health-event table exists;
- health-summary view exists;
- RLS is enabled on both tables;
- the cohort table has the required tenant/platform policies;
- the health table has the required policies;
- Disabled, Pilot, Enabled and Paused are constrained statuses;
- open health-event fingerprints are deduplicated.

Result: **database structure passed**.

### Data-safety baseline

- Companies: 10
- Saved rollout cohort rows: 0
- Rollout health events: 0
- Duplicate cohort rows: 0
- Cohort rows with an invalid company: 0
- Health events with an invalid company: 0

The absence of saved cohort rows means every tenant remains in compatibility mode. No module was hidden and no tenant setting was changed.

Core Control source records:

| Source table | Records | Missing company relationship |
|---|---:|---:|
| `action_tracker` | 35 | 0 |
| `events` | 12 | 0 |
| `inspections` | 47 | 0 |
| `risk_assessments` | 24 | 0 |

Result: **baseline counts and company ownership passed**.

### Security gate

Supabase Advisor initially reported `public.pending_notifications` as a Security Definer view. The underlying `notification_queue` table had RLS enabled and one authenticated, company-scoped policy, but the view had no `security_invoker` option and was owned by `postgres`.

The rerunnable `pending_notifications_security_upgrade.sql` was applied successfully. Post-migration verification confirmed:

- `security_invoker=true`;
- authenticated users retain `SELECT` on the view;
- anonymous users do not have `SELECT` on the view;
- `notification_queue` RLS remains enabled;
- its authenticated company-scoped policy remains present;
- Supabase Advisor reports no security or performance issues.

Result: **security correction passed**.

### Application/navigation gate

- The deployed login page loads without browser console errors.
- The direct module URL `?goto=events` remains present at the login boundary.
- Authenticated module navigation, exact-record opening and role/company switching could not be completed because the application browser session is not signed in.

Result: **pending authenticated acceptance session**.

## Release decision

Do not save or enable the Core Control cohort yet. Complete these items first:

1. Sign into the deployed AURIS360 application in the acceptance browser.
2. Validate Dashboard, Master Action Plan, Incidents, Inspections and Risk across the required roles.
3. Test exact-record deep links before and after authentication.
4. Complete resilience, workflow, mobile/offline and rollback evidence.
5. Start with Pilot only after all eight gates are recorded as passed.
