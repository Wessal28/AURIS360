# AURIS360 release acceptance checklist

Use this checklist for each tenant and each controlled rollout cohort. Repository checks are necessary evidence, but they do not replace environment testing or authorise a cohort activation.

## 1. Automated evidence

Run:

```powershell
npm run release:readiness
```

To retain machine-readable evidence:

```powershell
npm run release:readiness -- --report release-evidence/<tenant>-<cohort>.json
```

All checks must pass. The generated JSON intentionally leaves the eight environment gates pending.

## 2. Environment evidence

Record the tenant, cohort, tester, release candidate and date. Attach evidence for every gate:

| Gate | Required acceptance evidence |
|---|---|
| Database | Apply all required rerunnable migrations in a test tenant; record successful execution and schema checks. |
| Data safety | Compare before/after record counts and relationship health; resolve or explicitly accept every discrepancy. |
| Security | Test tenant isolation, roles and confidential records at both relationship endpoints. |
| Navigation | Open every supported source from lists, Connected Records, notifications, QR links and Approval Center. |
| Resilience | Run `npm run test:core-resilience`, then temporarily deny or rename one **optional** dependency in a protected test tenant (never production): Incident Evidence, Inspection Templates/Findings, or Risk JSA. Confirm the primary Incidents, Inspections or Risk register remains visible, the unavailable feature shows a controlled message/empty state, and restoring the dependency recovers without data repair. Capture before/after screenshots and the browser/API error. |
| Workflow | Exercise create, submit, approve/reject, notify, audit and linked-action paths in their authoritative modules. |
| Mobile/offline | Test desktop, tablet and mobile layouts; verify login-retained deep links and the supported offline queue. |
| Rollback | Test Paused/Disabled cohort status and the forward corrective migration procedure without deleting tenant data. |

## 3. Cohort order

1. Core Control: Master Action Plan, Incidents, Inspections and Risk.
2. Controlled Content: Permit, SWMS, Documents, Legal and SOP.
3. People & Health: Training, People, PPE and Occupational Health.
4. Specialist Operations: BBS, Safety Engagement, Contractors, Tools, Emergency, ESG and Noise.

Do not start the next cohort until the current cohort has all eight gates recorded as passed and its open rollout-health findings are reviewed.

## 4. Activation and observation

- Start with `Pilot`; do not move directly from `Disabled` to `Enabled`.
- Select the exact company in Settings before saving a cohort.
- Observe module errors, orphan relationships, failed deep links and approval discrepancies during the pilot window.
- Use `Paused` if a release finding affects safety, confidentiality, tenant isolation, data integrity or a controlled approval.
- Move to `Enabled` only after all eight gates pass and the release owner signs off.

## 5. Sign-off

| Field | Value |
|---|---|
| Tenant | |
| Cohort | |
| Release candidate / commit | |
| Test evidence location | |
| Open findings accepted by | |
| Product/Release approval | |
| Enabled by and timestamp | |
