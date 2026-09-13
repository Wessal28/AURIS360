# Master Action Plan editor — Odoo programme slice

The shared action register and record overview now hand off to a consistent editor with Save, Discard and reload, unsaved-change protection, inline validation, and workflow actions that save the entered fields before changing state. Existing connected source records remain attached.

## Implemented

- A reusable `AurisRecordEditSession` confirms returned records, scopes reads and writes to the selected company, rejects changed revisions, and prevents concurrent save attempts. Failed responses retain the draft; uncertain creates retain their UUID to avoid duplicate records on retry.
- Server timestamps advance for every action update, including older writers. The editor uses that timestamp and the previous status in the conditional update. Empty or mismatched responses never count as success.
- Forms preserve zero values and unchanged legacy person, department and source values. People are loaded for the selected company. Required titles, dates, date-extension reasons, progress and completion evidence receive inline feedback.
- Direct verification and closure controls require the correct workflow stage and an eligible role, evaluate the current company policy, and record the signed-in actor. Required verification cannot be skipped. Closed and cancelled actions are read only; cancellation retains the record.
- Unsaved changes are protected on Back and module navigation. Ctrl/Cmd+S saves within the form. Drafts live in this tab's memory; they are not offline records or durable browser backups.
- Review fields are locked at the appropriate stage. Approval notes and closure checklist confirmations are recorded in the activity log. Activity-log failure is disclosed separately from a confirmed record save.
- Form tabs wrap and columns adapt to the available editor width. Effectiveness ratings use labelled keyboard-accessible star buttons.

## Release order

1. Apply `supabase/migrations/20260913020000_action_editor_workflow.sql` to production before promoting the application. It expands the existing status constraint and adds the update timestamp trigger; it does not delete records or change RLS policies.
2. Merge and promote PR #122 after the required release and staging checks pass.
3. Run the production smoke check against the promoted commit and verify an authorised production action through its normal workflow.

The migration has been applied and verified in staging. Ordered replay now expects 28 migrations, 270 tables, 435 policies and 129 routines.

## Acceptance evidence

The dedicated staging tenant has one unassigned synthetic record titled **QA PR122 — Action workflow acceptance**. Browser verification covered create, reopen, start work after restoring a session, retaining a draft through Back / Keep editing, saving progress and evidence with submission, verification notes, closure checklist validation, and closing with the signed-in actor recorded for both decisions. No person was assigned or notified by this test.

Automated cases cover filtered/empty write responses, conflicting edits, cross-company/user/role changes, lost responses, duplicate prevention, preserved zero values, review roles and states, verification requirements, resubmission and policy hydration. The release workflow runs the complete suite and replays all ordered migrations on disposable PostgreSQL.

## Remaining Odoo programme work

This is the first editor adoption slice, not completion of the broader Odoo programme. The next modules are Objectives & KPIs, Incidents, Risk Assessments, Inspections and Documents, followed by the other specialist registers.

Configured multi-stage approvals remain a separate integration task: the direct MAP buttons block those routes rather than bypass them. UI role checks complement the existing tenant RLS; this release does not add server-side role enforcement to every legacy action writer. Record save, activity/audit history and notification work are separate requests rather than a single transaction. The shared overview can still disclose unavailable optional shared activity/evidence sources; the action's own activity log remains available.

Further programme work includes configuration-consumer verification, reporting/automation/integration adoption, more extraction from core, transactional multi-record recovery and archive/restore, representative-role acceptance and physical Android testing. No claim of a tested backup/restore procedure or complete offline editing is made by this release.
