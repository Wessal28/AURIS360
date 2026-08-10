# Core Control rollout preflight — 10 August 2026

## Scope

- Supabase project: AURIS360 / SEPHS Consulting Ltd
- Cohort: Core Control
- Modules: Master Action Plan, Incident Management, Audits & Inspections, Risk Assessment
- Validation mode: read-only database and authenticated application inspection
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
- The direct module URL `?goto=events` remained present at the login boundary, but the initial login landed on Dashboard instead of Incident Management. This exposed a one-shot initialisation race; bounded post-authentication retries were added and protected by the cross-module contract.
- Dashboard rendered immediately with 21 indicator cards and live totals.
- Incident Management, Master Action Plan, Audits & Inspections and Risk Assessment all loaded authorised records without a setup/schema error.
- Desktop (1440 px), tablet (1024 px) and mobile (390 px) checks showed no page-level horizontal overflow; mobile navigation remained available.

The corrected bounded deep-link retry is present in the deployed application and protected by the automated cross-module contract.

Result: **module, responsive and deployed deep-link smoke checks passed**.

### Role-matrix gate

The Core Control access contract now checks seven roles against all four cohort modules and verifies that both sidebar visibility and direct route navigation use the same access gate.

| Role | Actions | Incidents | Inspections | Risk |
|---|---|---|---|---|
| HSE Manager | Allowed | Allowed | Allowed | Allowed |
| HSE Officer | Allowed | Allowed | Allowed | Allowed |
| Supervisor | Allowed | Allowed | Allowed | Allowed |
| Auditor | Allowed | Allowed | Allowed | Allowed |
| Employee | Hidden/blocked | Allowed | Hidden/blocked | Hidden/blocked |
| Contractor | Hidden/blocked | Allowed | Hidden/blocked | Hidden/blocked |
| SEPHS Admin | Allowed | Allowed | Allowed | Allowed |

The preview selector exposes every tested role, `applyRoles()` hides unauthorised navigation, `showPage()` blocks direct unauthorised routes, and a role change returns the user to Dashboard when the current page is no longer allowed. The automated release-readiness suite now prevents this matrix from drifting.

Result: **role-matrix contract passed**.

### Workflow-transition gate

A shared Core Control transition contract now protects status changes made through buttons, dropdowns and programmatic calls. The contract permits the intended forward and correction paths while blocking stage-skipping and reopening of terminal records. Verification, closure, approval, rejection and controlled release transitions cannot be completed through a status dropdown; their dedicated actions remain mandatory.

| Module | Controlled path | Correction/terminal controls |
|---|---|---|
| Master Action Plan | Open → In Progress → Verification → Pending Closure → Closed | Failed verification or rejected closure returns to In Progress; Closed and Cancelled are terminal |
| Incident Management | Open → Under Investigation / Action Required → Closed | Managers close incidents; Cancelled and Closed cannot be reopened through a status edit |
| Audits & Inspections | Open → In Progress → Completed → Closed → Archived | Required checklist results and assigned corrective actions remain enforced; Archived is terminal |
| Risk Assessment | Draft → Pending Review → Active | Approval/rejection remains role-controlled; rejected records can be corrected and resubmitted; active records require controlled release/revision before editing |

The regression contract checks 14 allowed and 8 blocked transitions. It also confirms that action transitions write activity/audit evidence and notifications, Incident and Inspection follow-ups retain their exact Master Action source IDs, and Risk approval/rejection closes its approval request while recording audit and notification evidence.

Result: **workflow-transition contract passed without modifying production records**.

## Release decision

Do not save or enable the Core Control cohort yet. Complete these items first:

1. Complete resilience and mobile/offline evidence.
2. Record the rollback drill and acceptance owner.
3. Start with Pilot only after all eight gates are recorded as passed.
