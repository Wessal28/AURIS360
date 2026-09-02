# Modular Foundation Phase 23 — Governed Reusable Import Mappings

Phase 23 lets each company adapt reviewed external CSV column names and controlled values to the existing governed Action Register create and exact-update pipelines.

- Mapping profiles declare one safe source header for each allowlisted AURIS field; arbitrary fields and duplicate targets are rejected.
- Exact-update profiles must map the record UUID, immutable action reference and expected source revision.
- Optional aliases translate only status and priority values into existing controlled AURIS values.
- Profiles are tenant-scoped, versioned, fingerprinted and readable only by authorized company administrators under RLS.
- Saving or changing a profile always produces a non-executable draft.
- A different authorized administrator must approve the exact profile revision before it can prepare a mapped batch.
- Active profiles cannot change or pause while their batch is awaiting approval or execution.
- Mapped rows are validated by the Phase 21/22 engines and staged through the same independent batch approval, atomic service worker, audit and safe rollback paths.
- Every mapped batch retains the exact profile ID, revision and fingerprint used to prepare it.

This phase does not run formulas or scripts, infer hidden fields, persist source files, permit arbitrary value transformations, widen company access, bypass batch approval, merge or deploy automatically.
