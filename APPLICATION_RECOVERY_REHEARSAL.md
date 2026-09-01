# Application Recovery and Rollback Rehearsal

Run this rehearsal in an approved staging tenant before enabling a new application release.

1. Capture the current release SHA, installed application version, migration checksums and latest backup identity.
2. Start the upgrade for one pilot company. Confirm incompatible dependencies and incomplete migrations fail closed.
3. Apply reviewed migrations and verify the previous application release can still read the schema.
4. Inject a bounded module failure. Confirm the module pauses locally, the shell remains usable and a safe health event appears without record or credential data.
5. Exercise one workflow and one approval deep link. Confirm exact source reopening and tenant isolation.
6. Trigger governed rollback. Confirm the previous version becomes installed, activation remains paused and the upgrade run records `rolled_back`.
7. Restore a disposable backup copy and run read-only release, RLS, migration and cross-module verification.
8. Attach the generated release-readiness report and browser evidence to the change record before production promotion.

Never rehearse destructive restore steps against production. Production promotion, rollback and backup restore remain explicit human-authorised operations.
