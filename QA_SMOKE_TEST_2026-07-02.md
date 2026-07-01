# AURIS360 Smoke Test & Client Readiness - 2 July 2026

## Purpose
This checklist is the practical pre-client walkthrough test for AURIS360. It focuses on whether the app can be confidently demonstrated to real pilot clients and whether the core workflows connect cleanly across modules.

## Current Status
Overall readiness: **pilot-demo ready with controlled scope**.

Recommended demo scope:
- Dashboard and Executive Dashboard
- Incident Management
- BBS Observations
- Objectives & KPIs
- Master Action Plan
- Permit to Work
- Risk Assessment
- Chemical Control
- Legal Compliance
- Audit Trail
- Settings: notification and approval configuration

## Verification Completed This Pass
- JavaScript syntax check is part of the release process and should pass before deployment.
- `git diff --check` is part of the release process and should pass before deployment.
- Current app structure includes central company scoping, audit logging, notification queue handling, and role-gated access checks.
- Dashboard now includes a client demo readiness panel for admins and HSE roles.

## Critical Smoke Test Path

### 1. Login and Company Context
- Log in as SEPHS admin.
- Confirm company switcher is visible.
- Select a client company and confirm dashboards/modules show that company context.
- Switch back to all companies and confirm admin-only overview is available.

Expected result:
- SEPHS admin can review all companies or a selected company.
- Client admins should only see their own company data.

### 2. Dashboard
- Open Dashboard.
- Confirm hero card, KPI cards, and demo readiness panel load without errors.
- Click key cards: incidents, actions, training, people, PTW, legal/KPIs where enabled.

Expected result:
- Cards route only to accessible modules.
- Demo readiness panel shows which records are missing for a credible client walkthrough.

### 3. Incident Management
- Create a simple employee-style incident report.
- Add/upload evidence photos.
- Save the incident.
- Reopen the saved incident and confirm only the reported incident type is shown.
- As HSE/admin, classify severity, assign responsible person, and start investigation.
- Confirm action(s) can flow to Master Action Plan.

Expected result:
- Employee-created record should not expose manager-only investigation controls.
- Saved photos should be visible when managers open the record.
- Submitted/controlled records should be protected from casual amendment.

### 4. BBS Observations
- Record a positive observation.
- Record an unsafe condition with action required.
- Save and reopen.
- Confirm assigned action appears in Master Action Plan where applicable.

Expected result:
- BBS register works as a table/list.
- High/critical unsafe observations can generate follow-up actions.

### 5. Master Action Plan
- Open MAP.
- Filter by source, priority, status, and type.
- Open an action linked from incident/BBS/PTW/inspection.
- Update owner, due date, and status.

Expected result:
- MAP is the central action follow-up register.
- Source links and owner fields remain understandable.

### 6. Permit to Work
- Confirm PTW register is table-like.
- Create a permit request.
- Confirm issuer is auto-filled.
- Select RA reference and method statement reference from dropdowns.
- Confirm precautionary measures are aligned in two columns.
- Submit for approval and confirm Level 1/2/3 routing settings exist.

Expected result:
- PTW should be usable without typing approvers manually when settings are configured.
- Activity log should show major permit events.

### 7. Risk Assessment
- Create a risk assessment manually.
- Upload/import an existing RA PDF and check extracted rows.
- Confirm table/register view is available.
- Confirm high-risk findings can generate MAP actions.

Expected result:
- Imported PDFs may require review, but should reduce manual entry.
- RA remains editable only according to status and role.

### 8. Chemical Control
- Create chemical manually.
- Upload/read SDS/MSDS PDF.
- Confirm product name, hazard data, exposure consequences, persons exposed, frequency, and duration persist after save/reopen.
- Archive/delete according to role and status.

Expected result:
- Use and exposure fields persist.
- Risk scoring responds to exposure profile.
- Delete/archive should not fail for authorised users.

### 9. Legal Compliance
- Import legislation PDF.
- Confirm legislation title and prefix are detected or editable.
- Confirm sections are sorted by reference.
- Confirm bulk delete by legislation / selected rows is available.
- Update compliance status and evidence.

Expected result:
- Legal register is section-based, searchable, and table-like.
- Compliance gaps can link to MAP actions.

### 10. Notifications
- Open Settings.
- Add real email recipients by incident type.
- Send a test email using a real email profile.
- Confirm `.local` login-only addresses are not left as pending email sends.
- Check Recent Notifications status and error messages.

Expected result:
- Real email goes through queue.
- Login-only users get a clear failure reason or future non-email channel plan.

### 11. Audit Trail
- Create/update a record in a core module.
- Open Audit Trail.
- Confirm event appears with user, role, action, module, summary, and changed fields.
- Open Details and export CSV.

Expected result:
- Audit trail supports accountability and client confidence.

### 12. Mobile Quick Check
- Test Android Chrome on a narrow phone.
- Confirm bottom nav works.
- Confirm More menu buttons work.
- Confirm side navigation scrolls when collapsed.
- Confirm incident and BBS forms scroll vertically and fields are reachable.

Expected result:
- Mobile is usable for field reporting.
- Any remaining UI discomfort should be logged as polish, not a blocker.

## Known Follow-Up Items
- Complete real device testing on Huawei/Android Chrome and iPhone Safari.
- Add WhatsApp/SMS notification integration after choosing provider and budget.
- Continue replacing free-text people/location fields with People/Sites dropdowns.
- Expand Document Control links for SDS, RA, method statements, evidence, certificates and training documents.
- Add deeper automated browser tests when the app is split into smaller maintainable files.

## Client Meeting Recommendation
Use one prepared client company with enough records to make the demo meaningful:
- 3 to 5 people
- 1 incident with evidence
- 1 BBS observation
- 2 MAP actions
- 1 risk assessment
- 1 chemical with SDS data
- 1 legal register import
- 1 PTW draft or approval flow
- 1 audit trail event visible

Keep pilot access limited to the agreed modules, but demonstrate the broader roadmap from SEPHS admin mode.
