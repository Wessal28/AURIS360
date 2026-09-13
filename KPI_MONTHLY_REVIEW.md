# Monthly KPI review

Review month opens a company-wide, selected-period submission independently of the KPI definition workflow and visible table filters. Past periods can be reviewed; future and empty periods cannot be submitted. All due indicators need an actual value, including zero. Annual results entered early are reviewed in that result period and included at year end; planned reporting months take precedence.

The published configuration's three people resolve to exact active company accounts. Ambiguous or missing matches fail before submission. Unless self-approval is explicitly enabled, the three accounts must differ. Only the configured submitter can submit, the saved reviewer can verify/reject/return, and the saved approver can approve/reject/return. The submitted route is retained despite later configuration changes.

Submission stores the exact result, evidence, indicator definition and contributing history. A single transaction changes review state and records the actor, reason, previous record and resulting record in Audit Trail. Approval Center lists pending verification, approval and reopening and opens the exact monthly review. This slice does not send email or introduce scheduled reminders.

Submitted, verified, approved and pending-reopening periods freeze included KPI definitions, targets and results through the reviewed result month, protecting YTD history. Later monthly reporting remains available. New KPIs created after submission are outside that snapshot. Source refresh, overrides, manual RPCs and legacy direct writes share the same database trigger protection. A nonblocking company transaction lock returns HTTP 409 on a competing review/write rather than waiting in reverse row-lock order.

Revision requests and rejections require reasons and release the affected records unless another active review also protects them. Approved periods require an explicit reopening request and a reasoned approval by the saved approver; requesting alone does not unlock them. Resubmission takes a new preview and route and retains the prior snapshot in audit evidence. Deactivated assignees must regain authorised active access before deciding; delegation and reassignment are not implemented in this slice.

The client keeps a reason after conflicts or uncertain responses, blocks duplicate decisions and requires an explicit reload. This is not automatic idempotent retry or a persistent draft after closing. Reporting dates use UTC. Review locking is mandatory for this workflow; legacy lock/delegation settings not exposed in the operational configuration do not weaken this protection.

## Release prerequisite and recovery

Apply 20260913060000_kpi_monthly_review.sql to staging, verify the authenticated workflow, and then apply the exact migration to production before deploying the new client. It adds one table, a tenant read policy, six routines and three guards; no existing business rows or storage policies are rewritten. Keep the production backup/recovery procedure available under RELEASE_WORKFLOW.md. Migration replay fixtures run only against the disposable localhost database and must never be applied to Supabase.

Application rollback leaves saved reviews and their database protection intact. Do not remove guards or delete reviews to regain editing; request revision/reopening through the reviewed client. A rollback to the prior client requires restoring this review client before protected records can be corrected. Existing unreviewed records continue to use the prior save path.

Automated evidence covers transitions, assignment and tenant denial, stale previews/decisions, failed-audit rollback, contributing-history protection, later reporting and controlled reopening, plus real competing sessions. Browser acceptance and migration/deployment execution need separate recorded release evidence.
