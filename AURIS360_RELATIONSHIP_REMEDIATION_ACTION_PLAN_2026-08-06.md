# AURIS360 Relationship Remediation Action Plan

**Prepared:** 6 August 2026

**Source:** `AURIS360_CROSS_MODULE_RELATIONSHIP_AUDIT_2026-08-06.md`

**Objective:** Make every module deployable, traceable and interoperable so users can move from a dashboard, action, approval, notification or connected record to the exact authoritative source without blank modules, broken links or manual searching.

## Implementation progress

| Date | Action | Status | Result |
|---|---|---|---|
| 6 Aug 2026 | AP-013 resilient enhanced-module loaders | First implementation complete | Chemical, Contractor, Training, Legal, Risk, SOP, SWMS and Tools now retain successful datasets when another optional table fails |
| 6 Aug 2026 | AP-020 immediate registry drift corrections | Interim corrections complete | Chemical and SWMS added to desktop Modules, SWMS added to mobile, and People added to the administrative catalogue; canonical registry consolidation remains pending |
| 6 Aug 2026 | AP-021 Master Action Plan source adapter registry | First implementation complete | All source-module values currently written by the application now route through a table-driven registry; Contractor, ESG, Emergency, Occupational Health, Noise, Training and Document Control support exact-ID opening where their source record is available, with reference-search fallback for legacy actions |
| 6 Aug 2026 | AP-022 generated-action metadata correction | In progress | New ESG spill actions now retain the spill record ID; full metadata normalisation and legacy backfill remain pending |
| 6 Aug 2026 | AP-022 generated-action metadata correction | Forward-write repair complete | BBS, Chemical and ATEX now write canonical source modules; Investigation, Legal gap, Toolbox Talk and Inspection actions retain source IDs; Risk actions retain their RA reference; MOC actions link to their own governed record. AI document-analysis actions remain reference-only until analysis artefacts receive durable storage IDs; legacy data backfill remains pending |
| 6 Aug 2026 | AP-023 legacy action-source backfill | Migration ready; execution pending | `action_source_relationship_backfill_v3.sql` normalises known legacy aliases, auto-links only unique company-scoped reference matches, preserves existing links, and creates an RLS-protected review queue for ambiguous or unresolved records |
| 6 Aug 2026 | AP-023 SQL runner compatibility | Corrected after deployment test | Replaced transaction-scoped temporary staging tables with explicitly named unlogged work tables because the hosted SQL runner did not preserve the temporary relation between statements; work tables are dropped after reconciliation |
| 6 Aug 2026 | AP-023 staging-free compatibility | Corrected after second deployment test | Removed all staging relations. Each table mapping now logs candidates and performs its unique-match update inside one self-contained CTE statement, so segmented SQL execution cannot lose intermediate relations |
| 6 Aug 2026 | AP-030 shared reciprocal relationship model | Schema ready; execution pending | Added `shared_record_relationships_schema.sql` with a canonical symmetric relationship table, allowlisted module/table registry, endpoint validation, governed creation RPC, tenant RLS and bidirectional lookup view; existing module-specific relationship tables remain available for compatibility |

## 1. Delivery principles

1. Protect existing customer data and preserve backward compatibility.
2. Resolve deployment and blank-module risks before adding relationship features.
3. Use stable IDs as the authoritative relationship; retain visible references as audit snapshots.
4. Make every relationship reciprocal where users reasonably expect to see it from both records.
5. Degrade individual features safely when optional services are unavailable.
6. Release in small, reversible migrations with automated verification.
7. Do not replace user-friendly module interfaces solely to standardise the underlying relationship model.

## 2. Priority and effort summary

| Phase | Outcome | Priority | Estimated effort | Dependency |
|---|---|---:|---:|---|
| 0 | Baseline, backup and migration governance | P0 | 2–3 engineering days | None |
| 1 | Reliable schema deployment and resilient module loading | P0 | 7–11 days | Phase 0 |
| 2 | Canonical module and source-navigation registries | P1 | 5–8 days | Phase 1 |
| 3 | Shared reciprocal relationship service | P1 | 12–18 days | Phase 2 |
| 4 | Approvals, deep links, notifications and audit integration | P1 | 8–12 days | Phases 2–3 |
| 5 | Person, site and legacy-reference reconciliation | P2 | 12–20 days | Phase 3 |
| 6 | Offline consistency, end-to-end testing and rollout | P1 | 6–10 days | Phases 1–5 |

**Indicative total:** 52–82 engineering days. The duration can be shortened by parallelising module adapters after Phases 1 and 2 are stable.

## 3. Phase 0 — Baseline and change control

### AP-001 — Establish a protected test tenant

- **Owner:** Platform/DevOps
- **Actions:**
  - Clone the production schema into a non-production tenant.
  - Load anonymised representative records for every launched module.
  - Include records with legacy names, free-text references and missing optional tables.
- **Deliverable:** Repeatable integration-test tenant and reset procedure.
- **Acceptance:** Tests can create, link, approve, archive and reopen records without touching production.

### AP-002 — Inventory deployed schema versions

- **Owner:** Database engineer
- **Actions:**
  - Record which module migrations exist in each tenant.
  - Record missing tables, columns, indexes, policies and functions.
  - Compare live tenants against the application schema contract.
- **Deliverable:** Tenant-by-tenant migration readiness matrix.
- **Acceptance:** No migration is applied until its prerequisite and rollback strategy are documented.

### AP-003 — Protect rollback and data recovery

- **Owner:** Platform/DevOps
- **Actions:**
  - Confirm database backups and point-in-time recovery.
  - Export counts and checksums for relationship-critical tables before migration.
  - Define rollback as forward corrective migrations rather than destructive resets.
- **Acceptance:** Recovery procedure is tested in the non-production tenant.

## 4. Phase 1 — Schema reliability and blank-module prevention

### AP-010 — Create a numbered migration ledger

- **Owner:** Database engineer
- **Actions:**
  - Convert current SQL upgrades into ordered, rerunnable migrations.
  - Add a `schema_migrations` ledger with migration ID, checksum, applied time and result.
  - Remove reliance on manually choosing one of several production bundles.
- **Acceptance:** A clean tenant reaches the current schema by running one migration command in order.

### AP-011 — Rebuild the clean production bundle

- **Owner:** Database engineer
- **Scope:** The 95 migration-created tables absent from the current clean bundle.
- **Actions:**
  - Generate the bundle from the migration ledger.
  - Include required columns, indexes, constraints, RLS policies and grants.
  - Validate the bundle against an empty database and an upgraded legacy database.
- **Acceptance:** No current module displays a missing-table or missing-column setup message after provisioning.

### AP-012 — Add an automated schema contract test

- **Owner:** Backend/QA
- **Actions:**
  - Extract every API table and required field used by production JavaScript.
  - Verify existence, data type, nullability assumptions, indexes and tenant policies.
  - Fail deployment when a required contract is absent.
- **Acceptance:** Known failures such as missing `company_id`, `location` or relationship tables are detected before release.

### AP-013 — Make enhanced module loaders fault tolerant

- **Owner:** Frontend engineer
- **First modules:** Chemical, Contractor, Training, Legal, Risk, SOP, SWMS, Tools & Equipment.
- **Actions:**
  - Replace all-or-nothing `Promise.all` loaders with settled per-feature requests.
  - Retain successfully loaded datasets.
  - Display the exact unavailable feature and required migration.
  - Keep core register data visible.
- **Acceptance:** Removing one optional table disables only its dependent tab/card; the rest of the module remains usable.

### AP-014 — Add module readiness diagnostics

- **Owner:** Frontend/Platform
- **Actions:**
  - Add an administrator-only readiness page showing schema, storage, RLS, functions and asset-cache state per module.
  - Include a copyable technical diagnostic without exposing secrets.
- **Acceptance:** Support can identify the missing dependency without inspecting browser developer tools.

## 5. Phase 2 — Canonical module and source registries

### AP-020 — Create one canonical module registry

- **Owner:** Frontend architect
- **Registry fields:** key, label, icon, section, page ID, loader, launch state, mobile visibility, roles, company access key, source aliases and record opener.
- **Actions:**
  - Generate sidebar, desktop Modules menu, mobile directory and administration catalogues from this registry.
  - Preserve the current sidebar grouping and visual style.
  - Remove duplicated `MODULES_DIR`, `MOBILE_MODULES`, `MODULE_CATALOGUE` and `MODULE_CATALOG` definitions after compatibility testing.
- **Immediate corrections:**
  - Add Chemical Control and SWMS to the desktop menu.
  - Add SWMS to the mobile directory.
  - Add Executive Dashboard to the company/admin catalogues where intended.
  - Add People to the administrative catalogue where intended.
- **Acceptance:** Every launched module appears consistently on every navigation/access surface permitted for that role.

### AP-021 — Create a source-record adapter registry

- **Owner:** Frontend architect
- **Adapter fields:** source aliases, page key, source table, open-by-ID function, reference-search fallback, permission check and display-label function.
- **Initial adapters:** Incidents, Investigations, BBS, Inspections, Risk, Permit, Meetings, Legal, Chemical, PPE, Tools, Fleet, ATEX, MOC, ESG, Occupational Health, Contractors, Emergency, Noise, Training and Documents.
- **Acceptance:** Automated tests prove that every `source_module` written by the application has exactly one working adapter.

### AP-022 — Correct Master Action Plan source metadata

- **Owner:** Module owners
- **Actions:**
  - Require `source_module`, `source_table`, `source_id` and `source_ref` for generated actions.
  - Stop writing `source_module='manual'` for known BBS, Chemical and ATEX records.
  - Add source IDs to health, environmental, emergency and noise action paths that currently omit them.
  - Preserve legacy source references for reports.
- **Acceptance:** Every newly generated action reopens its exact source record.

### AP-023 — Backfill legacy action sources

- **Owner:** Database engineer and module owners
- **Actions:**
  - Match legacy actions to source records by company, reference and module-specific patterns.
  - Produce confidence levels and an exception queue.
  - Auto-update only unambiguous matches; require review for uncertain matches.
- **Acceptance:** Backfill report lists matched, reviewed, unresolved and duplicate records with no silent reassignment.

## 6. Phase 3 — Reciprocal relationship platform

### AP-030 — Implement a shared relationship model

- **Owner:** Backend architect
- **Proposed fields:**
  - `company_id`
  - `source_module`, `source_table`, `source_id`, `source_ref`
  - `target_module`, `target_table`, `target_id`, `target_ref`
  - `relationship_type`, `status`
  - `source_revision`, `target_revision`, `applicability`
  - `created_by`, `created_at`, `updated_at`, `verified_at`
- **Rules:**
  - One canonical row represents both directions.
  - Module-specific tables may remain as compatibility views during migration.
  - Cross-table targets are validated by the relationship service before insertion.
- **Acceptance:** Invalid targets are rejected or explicitly stored as unresolved legacy references.

### AP-031 — Build the shared Connected Records component

- **Owner:** Frontend engineer
- **Status (2026-08-06):** Shared component complete and first integrated into the Master Action Plan record view. It provides reciprocal display, status and broken-link warnings, exact-record navigation adapters, a registry-backed record picker, governed relationship types and non-destructive unlinking. The remaining listed modules will adopt this same component under AP-032.
- **Capabilities:**
  - Add from a validated record picker.
  - Display both sides of the relationship.
  - Open the exact related record.
  - Show relationship type, revision, status and broken-link warning.
  - Respect role, confidentiality and tenant boundaries.
- **Acceptance:** The same component works in Risk, SWMS, Permit, Legal, SOP, Training, Documents, Incidents and Actions.

### AP-032 — Complete the current partial relationship implementations

- **Owner:** Module owners
- **Status (2026-08-09):** Completed across Risk, SWMS, Legal, SOP, Training, BBS and Document Control. All listed partial relationship workflows now use or synchronize with the shared reciprocal service without requiring manual record-ID re-entry.
- **Actions:**
  - Risk: **Completed 2026-08-06** — shared reciprocal display, registry-validated picker, governed relationship types, broken-link warnings, exact RA navigation and safe unlinking are integrated into the RA record view.
  - SWMS: **Completed 2026-08-06** — corrected the canonical table mapping, preserved the existing RA/Permit selectors, synchronized their saved choices into reciprocal relationships, added the shared panel and enabled exact SWMS/RA/Permit navigation.
  - Legal: **Completed 2026-08-09** — shared create/display/open flows are integrated into legal requirements; governed evidence and permit/licence records are linked canonically, existing valid records are backfilled, privileged-link management is restricted and exact requirement/gap/evidence navigation is supported.
  - SOP: **Completed 2026-08-09** — SOP workspaces now expose the shared Connected Records panel, reopen exact projects from reciprocal links, preserve explicit legacy Risk/Permit/Document links, and require an exact controlled Document link before publication.
  - Training: **Completed 2026-08-09** — learning courses now use verified reciprocal sources, synchronize the learning-specific dependency register, detect changed or missing source revisions, expose an impact-review queue and block publication until source impacts are resolved.
  - BBS: **Completed 2026-08-09** — confirmed barrier themes now create the authoritative Master Action and `bbs_action_links` record in one guided workflow, automatically cancel an action if native linking fails, synchronize reciprocal relationships and reopen the exact action or source theme.
  - Documents: **Completed 2026-08-09** — Document Control now uses the shared verified Connected Records picker and reciprocal display; exact active legacy targets are backfilled from generic payloads, invalid targets remain visibly unresolved, free-text-only history is preserved for manual resolution and linked documents reopen in the governed document workspace.
- **Acceptance:** No module advertises a connected-record capability that requires manual re-entry to complete the link.

### AP-033 — Add reciprocal and orphan checks

- **Owner:** Backend/QA
- **Status (2026-08-09):** Completed — batch and optional hourly validation now recheck both endpoints, classify active/archived/broken/unresolved states, retain validation-run metrics and expose an administrator repair queue with exact-record opening and non-destructive archival.
- **Actions:**
  - Scheduled validation of both endpoints.
  - Mark archived, deleted, inaccessible and unresolved targets distinctly.
  - Provide an administrator repair queue.
- **Acceptance:** Broken links are visible and measurable; they never silently disappear.

## 7. Phase 4 — Workflow integration

### AP-040 — Make deep links record-aware

- **Owner:** Frontend engineer
- **Status (2026-08-09):** Completed — `goto`, `record`, `ref`, `table` and optional company context are captured before authentication, retained in session through login/role/company changes, resolved through the shared source-adapter registry and opened at exact-record level where authorised. QR labels now include authoritative table context; denied and unavailable targets display a persistent explanation with retry/dismiss controls.
- **Actions:**
  - Read `goto`, `record` and `ref` after authentication.
  - Use the source adapter registry to open the target record.
  - Preserve the requested route through login, role selection and company switching.
  - Display an understandable message when access is denied or the record is unavailable.
- **Acceptance:** QR and email links open the intended record, not only the module landing page.

### AP-041 — Expand Approval Center with adapters

- **Owner:** Workflow architect
- **Status (2026-08-09):** Completed — the Approval Center now loads a shared adapter contract in parallel across Permit, Document Control/SWMS, Risk, Incident, Legal, SOP, Training, MOC, Chemical, Contractor, Tools, BBS, Safety Engagement and Occupational Noise. Each queue row carries its authoritative table/record ID, reference, stage, approver, due date and confidentiality, deduplicates generic workflow requests, and opens the exact source record where authorised. Operational states that do not require a controlled decision are documented in the interface rather than misrepresented as approvals.
- **First wave:** Incident, Legal, SWMS, SOP, Training and MOC.
- **Second wave:** Chemical, Contractor, Tools, BBS, Safety Engagement and Noise.
- **Adapter contract:** module, table, record ID, reference, title, stage, approver, due date, confidentiality and record opener.
- **Acceptance:** Every controlled review state appears in one approval inbox or is explicitly documented as not requiring approval.

### AP-042 — Standardise notification relationships

- **Owner:** Backend/Frontend
- **Status (2026-08-09):** Completed — workflow notification producers now supply canonical module, table, record ID and reference metadata through one queue contract. The helper generates an exact-record URL, replaces generic email links, preserves relationship metadata during pre-migration fallback and rejects incomplete workflow notifications. Recent Notifications displays and opens the source record, while the rerunnable `notification_relationships_upgrade.sql` adds relationship fields, enforces the forward-write contract and records queued, sent, delivered, failed, bounced, skipped, opened and failed-target lifecycle events.
- **Actions:**
  - Require related module/table/ID/reference on workflow notifications.
  - Generate record-aware URLs through one helper.
  - Log delivery, open and failed-target events.
- **Acceptance:** Each notification can be traced to its source record and workflow decision.

### AP-043 — Standardise audit coverage

- **Owner:** QA/Backend
- **Status (2026-08-09):** Completed — the shared audit layer now applies stable module/action event codes and semantically classifies create, update, submit, approve, reject, archive, link, unlink, sensitive-record open and export events. It records authoritative references, correlation/outcome/sensitivity metadata and canonical relationship IDs; the Audit Trail exposes these fields and dynamically filters every event type. The rerunnable `audit_coverage_upgrade.sql` extends existing audit data without destructive rewriting, while `tests/audit_contract.test.cjs` verifies the mandatory event contract, controlled-module table coverage and workflow classification rules.
- **Actions:**
  - Define mandatory events: create, update, submit, approve, reject, archive, link, unlink, open sensitive record and export.
  - Add contract tests per module.
  - Store relationship IDs for link/unlink events.
- **Acceptance:** The Audit Trail can reconstruct the lifecycle and relationship changes of a sampled record from every controlled module.

### AP-044 — Separate MOC from corrective actions

- **Owner:** Product/Backend
- **Status (2026-08-09):** Completed — Management of Change now uses a dedicated `moc_change_requests` header with a controlled Draft-to-Closed lifecycle. The interface reads and writes that register, participates in Approval Center and exact-record routing, exposes reciprocal Connected Records and creates corrective actions as independent Master Action Plan records. `moc_change_requests_upgrade.sql` migrates legacy MOC-shaped action rows without deleting them, preserves each original action as a linked implementation action and updates the relationship registry. A safe frontend fallback keeps legacy records visible until the migration is applied, and `tests/moc_separation_contract.test.cjs` guards the separation contract.
- **Actions:**
  - Introduce a dedicated change-request header and lifecycle.
  - Link resulting risk assessments, documents, training, permits and corrective actions.
  - Migrate existing `source_module='moc'` action records without losing history.
- **Acceptance:** A change request and its resulting actions have distinct statuses and reciprocal links.

## 8. Phase 5 — Identity, location and legacy-reference quality

### AP-050 — Make People the canonical person identity

- **Owner:** Data architect
- **Status (2026-08-09):** Completed — priority modules now persist stable `people.id` relationships while retaining name, organisation and role snapshots for historical reporting. The rerunnable `canonical_person_identity_upgrade.sql` adds canonical links across Training, PPE, Occupational Health, document acknowledgements, meetings and Master Action Plan assignments; it automatically links only unique matches and sends ambiguous/unmatched legacy rows to `person_identity_backfill_review`. Frontend writes resolve People selections centrally and gracefully omit new columns until the migration is installed. `tests/person_identity_contract.test.cjs` protects the ID-plus-snapshot contract.
- **First modules:** Training, PPE, Occupational Health, Document acknowledgements, Meetings and Action assignments.
- **Actions:**
  - Store `person_id` on every person-linked record.
  - Keep display name, organisation and role as historical snapshots.
  - Support employees, contractors and external attendees without sharing restricted health data.
- **Acceptance:** Renaming a person does not split their history or reassign old records.

### AP-051 — Reconcile legacy people data

- **Owner:** Data steward
- **Status (2026-08-09):** Completed — Settings now includes a controlled People Identity Reconciliation workspace with unresolved/resolved/ignored accounting, verified-person selection, evidence notes and advisory duplicate-profile clusters. `person_identity_reconciliation_upgrade.sql` rescans legacy records, applies only company-scoped allowlisted links, records every manual or newly unique decision in an append-only decision ledger and the Audit Trail, and never automatically merges or deletes People. `tests/person_identity_reconciliation_contract.test.cjs` enforces these safety boundaries.
- **Actions:**
  - Match by existing ID, email, employee number, company and normalised name.
  - Flag duplicates and uncertain matches for controlled review.
  - Record merge decisions in the audit trail.
- **Acceptance:** The reconciliation report accounts for every legacy person-linked record.

### AP-052 — Add stable site and area relationships

- **Owner:** Data/Module owners
- **Status (2026-08-09):** Completed — operational Incident, BBS Observation, Inspection, Risk Assessment, Permit and Master Action Plan records now persist canonical `site_id` and optional `area_id` links while retaining readable historical snapshots. Areas continue to use the existing child-Site hierarchy rather than a duplicate location master. The rerunnable `canonical_location_relationships_upgrade.sql` backfills only unique company-scoped exact matches and queues ambiguous/unmatched values in `location_identity_backfill_review`. Site Map now prefers stable IDs, refuses contradictory text fallback, labels remaining legacy text matches and reads from the live BBS/Permit tables with compatibility fallbacks. Searchable location suggestions and `tests/location_identity_contract.test.cjs` protect the frontend contract.
- **Actions:**
  - Add `site_id` and optional `area_id` to operational records.
  - Replace text-only site fields with searchable selectors while keeping snapshots.
  - Update Site Map aggregation to prefer IDs and use text matching only as a labelled legacy fallback.
- **Acceptance:** Similar or renamed site names do not mix records on Site Map or dashboards.

### AP-053 — Replace remaining reference-only operational links

- **Owner:** Module owners
- **Status (2026-08-09):** Completed — ATEX, PPE Issuance, Compliance Calendar, Work Schedule, Permit to Work and SWMS now save verified target IDs alongside readable reference snapshots. ATEX selects an actual permit instead of only a permit type; Permit submission validates verified current/approved RA and method-statement records; linked records can be opened directly from source forms. The rerunnable `verified_operational_references_upgrade.sql` backfills only unique company-scoped matches (including legacy values that stored an ID in a reference field) and queues ambiguous/unmatched references in `reference_identity_backfill_review`. Schema-fallback writes keep the application usable before the migration is installed, and `tests/verified_operational_references_contract.test.cjs` protects the contract.
- **Priority:** ATEX, PPE, Legal Calendar, legacy Work Schedule, Permit and SWMS fields.
- **Actions:**
  - Save the target ID plus reference snapshot.
  - Validate target status where the workflow depends on approval/current state.
  - Backfill unambiguous legacy references.
- **Acceptance:** Users select a real record and can open it directly from the source form.

## 9. Phase 6 — Offline, QA and controlled rollout

### AP-060 — Generate the service-worker asset manifest

- **Owner:** Build/Frontend
- **Status (2026-08-09):** Completed — the service-worker app shell is generated from current `index.html`, manifest and CSS dependencies; all launched module upgrades, the shared icon system and brand assets are included. Its cache version is a deterministic content hash, required shell failures remain visible, optional asset failures cannot abort installation, private API/auth traffic bypasses caches and offline navigation falls back to the current application shell. `tests/offline_asset_manifest_contract.test.cjs` protects manifest freshness, asset existence, module coverage, privacy exclusions and the existing queued-workflow sync hooks.
- **Actions:**
  - Derive cached assets from `index.html` or the deployment build.
  - Include the shared icon system and every current module upgrade asset.
  - Increment cache version automatically.
- **Acceptance:** All launched modules render their current interface and relationship features after an offline reload.

### AP-061 — Build the cross-module integration test suite

- **Owner:** QA automation
- **Status (2026-08-09):** Automated contract implemented — `tests/cross_module_integration_contract.test.cjs` covers the eight P0/P1 release scenarios: canonical action sources and exact reopening, bidirectional links, archived/broken endpoint handling, governed Approval Center reopening, authentication-persistent QR/email links, tenant/role isolation, optional-table degradation and responsive layout contracts. Approval decisions remain in each authoritative source workspace so module-specific gates and audit rules cannot be bypassed by a generic update. The repository contract passes; an environment-backed desktop/tablet/mobile run against the release-candidate Supabase tenant remains mandatory at the release gate.
- **Required scenarios:**
  - Create source record → create action → reopen exact source.
  - Create reciprocal relationship → open from both modules.
  - Archive one endpoint → display controlled relationship status.
  - Submit approval → approve/reject from Approval Center → reopen source.
  - Open QR/email link before and after login.
  - Switch company/role and confirm access isolation.
  - Remove one optional table and confirm graceful degradation.
  - Test desktop, tablet and mobile layouts.
- **Acceptance:** No P0/P1 scenario fails in the release candidate.

### AP-062 — Roll out by module cohort

- **Owner:** Product/Release manager
- **Suggested cohorts:**
  1. Master Action Plan, Incidents, Inspections and Risk.
  2. Permit, SWMS, Documents, Legal and SOP.
  3. Training, People, PPE and Occupational Health.
  4. BBS, Safety Engagement, Contractors, Tools, Emergency, ESG and Noise.
- **Actions:**
  - Enable through feature flags per tenant.
  - Monitor errors, orphan counts, failed deep links and approval queue discrepancies.
  - Keep compatibility reads during the transition.
- **Acceptance:** Each cohort meets the release gates before the next cohort begins.

## 10. Release gates

| Gate | Required evidence |
|---|---|
| Database | Migration applies cleanly to empty and legacy test tenants; contract test passes |
| Data safety | Before/after counts and relationship checks reconcile |
| Security | Tenant, role and confidentiality tests pass for both endpoints |
| Navigation | Every registered source opens the exact authorised record |
| Resilience | Missing optional dependency does not blank the module |
| Workflow | Approval, notification, audit and action transitions remain traceable |
| Mobile/offline | Current assets load and record links survive authentication/offline transitions |
| Rollback | Forward corrective migration and feature-disable procedure tested |

## 11. Success measures

- 100% of newly generated module actions contain complete source metadata.
- 100% of supported source modules have a tested open-by-ID adapter.
- 100% of controlled relationship links are validated or explicitly flagged as legacy/unresolved.
- 0 launched modules omitted from intended navigation and access registries.
- 0 blank modules caused by a single missing optional table.
- 100% of QR and workflow email tests open the intended record.
- 100% of controlled module approvals are visible in Approval Center or formally exempted.
- Fewer than 1% unresolved legacy relationship records after the reviewed backfill.
- 0 cross-company relationship leakage in automated security tests.

## 12. Immediate next sprint

The first sprint should contain only the highest-risk enabling work:

1. AP-001 protected integration tenant.
2. AP-002 deployed schema inventory.
3. AP-010 migration ledger.
4. AP-012 schema contract test.
5. AP-013 resilient loaders for Risk, Legal, SWMS and Tools.
6. AP-020 canonical module registry design and drift corrections.
7. AP-021 source adapter registry design.

**Sprint exit condition:** a clean test tenant provisions without manual SQL discovery; the four selected modules remain usable when one optional dependency fails; and every current action source value has a documented adapter or remediation owner.
