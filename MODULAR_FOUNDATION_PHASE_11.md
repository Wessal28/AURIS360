# Modular Foundation Phase 11 — Unified Work and Activity Centre

Phase 11 adds a company-scoped **My Work** application that brings assignments, approvals, overdue follow-up, recipient-private notifications, and source activity into one operational view.

The centre is an aggregation layer. Action and approval lifecycle state stays in the authoritative source table, so completing a source record is reflected on refresh and cannot create a competing copy. Every displayed item retains its company, module, table, record ID and reference for exact deep linking.

## Governance boundaries

- company isolation is applied in every request and enforced again by row-level security;
- notification rows are restricted to the signed-in recipient;
- collaboration evidence is append-only and written only through a validated RPC;
- delegation verifies that the recipient belongs to the same company and records an activity event;
- idempotency keys prevent duplicated collaboration evidence;
- cached work may be reviewed offline, while comments, evidence and delegation are blocked until online;
- source decisions continue through the existing module workflow and Approval Centre, preserving policy-version and decision audit evidence.

## Validation

Run `npm test`, `npm run migration:validate`, `npm run check:sw-manifest`, and `npm run release:readiness`. Preview acceptance additionally verifies the deployed work-centre asset and the approved staging boundary.
