# Modular Foundation Phase 24 — Governed Scheduled Data Exchange

Phase 24 schedules controlled CSV intake through the exact connection and mapping revisions approved for one company.

- Schedules are tenant scoped and progress through draft, independent review, active, paused, rejected, and blocked states.
- Activation pins the exact active source connection revision, approved host, mapping revision, and mapping fingerprint.
- A five-minute service worker creates idempotent due runs and also supports an explicit, idempotent **Run now** request.
- A SEPHS platform administrator must explicitly enable a connection as an inbound CSV source; that capability is reset whenever its endpoint or credential changes and the connection is excluded from outbound webhook delivery.
- Source retrieval permits one bounded HTTPS `GET` from the exact approved public host, rejects redirects and private DNS results, and uses a provisioned credential reference whose secret remains server-side.
- CSV payloads remain limited to 1 MiB and 500 rows and are validated by the Phase 23 mapping engine.
- Successful runs create a governed batch in `pending_review`; the scheduler never approves or applies a batch.
- Existing independent batch approval, atomic execution, exact-update conflict detection, audit evidence, and rollback remain unchanged.
- Transient failures use bounded retries. Invalid credentials, endpoints, content types, redirects, or oversized sources enter a controlled blocked state.
- Run history exposes schedule, time, attempts, batch identity, health, and safe error codes without exposing endpoints or secrets.

This phase does not execute arbitrary code, follow redirects, store source credentials in the browser or database, bypass company access, approve its own data, merge, or deploy automatically.
