# Modular Foundation Phase 26 — Operational Master Data Adoption

Phase 26 connects the governed canonical values introduced in Phase 25 to Incident Management, Risk Assessment, Permit to Work, Audits & Inspections, Master Action Plan, and Document Control.

- Adoption is non-destructive: each operational record keeps its original legacy wording as historical evidence.
- A company-scoped sidecar binding identifies the exact source table, record, field, reference, canonical record, domain, and first legacy snapshot.
- Only active and currently effective canonical values from the same company and approved domain can be confirmed.
- Exact code/name matches are suggestions only. Ambiguous and unresolved values require an administrator decision and never bind automatically.
- Confirming, changing, and releasing a binding is revision checked, dependency aware, and audit logged.
- Confirmed references become active Phase 25 dependencies, preventing unsafe canonical deactivation or archival.
- Every source lookup remains tenant filtered. A missing source, unavailable table, stale binding, inactive canonical value, or cross-company reference becomes a controlled failure.
- The adoption centre reports confirmed, suggested, ambiguous, unresolved, and stale references per module and remains usable on tablet and mobile layouts.

This phase does not rewrite historical source fields, auto-accept fuzzy matches, merge canonical values, broaden module permissions, merge a pull request, or deploy to production.
