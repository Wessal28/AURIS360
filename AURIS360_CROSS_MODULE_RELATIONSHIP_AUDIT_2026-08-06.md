# AURIS360 Cross-Module Relationship Audit

**Assessment date:** 6 August 2026

**Scope:** All application modules, navigation registries, shared actions, approvals, notifications, record links, relationship tables, identity links, deployment schema and offline assets

**Assessment type:** Read-only static source and schema audit; no production records were created, changed or deleted

## 1. Executive conclusion

AURIS360 has a broad and generally coherent module structure. Page-level navigation is intact: all 38 static page targets exist, every static page has a loader, all statically referenced local assets exist, and 21 root production JavaScript files pass syntax validation. Safety Engagement is the only extra loader because its page is mounted dynamically.

The principal weakness is **record-level traceability**, not basic navigation. Users can usually move to the correct module, but several links do not open the exact source record, some relationship tables are only partially used, and many cross-module references are free text rather than validated identifiers. The current clean production schema bundle is also materially behind the application migrations, which can reproduce blank modules in a new or partially upgraded tenant.

### Overall relationship health

| Area | Assessment |
|---|---|
| Page and loader navigation | Good |
| Module discovery consistency | Needs improvement |
| Master Action Plan source traceability | Partial |
| Reciprocal connected-record visibility | Weak |
| Approval aggregation | Partial |
| Stable record identifiers | Mixed |
| Person identity relationships | Mixed |
| Deployment repeatability | High risk |
| Offline relationship workflows | Incomplete |
| Audit and notification linkage | Useful but inconsistent |

## 2. Verification summary

- 38 static `page-*` containers were found.
- 38 static `showPage()` destinations were found and all have a page.
- 39 loader entries were found; the additional `engagement` loader is expected because Safety Engagement mounts dynamically.
- 30 client-facing modules are listed as launched.
- All 32 local JavaScript and CSS references in `index.html` exist.
- 21 root production JavaScript files passed `node --check`.
- The clean production schema bundle creates 20 tables, but 95 unique tables created by current module migrations are absent from that bundle.
- The Approval Center directly aggregates generic workflow requests, Permit to Work, Document Control and Risk Assessment only.
- The Master Action Plan source resolver does not fully cover every `source_module` written by the application.
- The `?goto=` deep-link handler opens the module but ignores the supplied `record` and `ref` parameters.

## 3. Confirmed broken or incomplete relationships

### P0 — Production schema bundle does not represent the current application

`auris360_production_schema_bundle_CLEAN.sql` omits 95 unique tables created by the current upgrade migrations. This is the most serious systemic relationship risk because the UI expects these tables to be present.

| Migration area | Tables absent from the clean bundle |
|---|---:|
| BBS Observations | 16 |
| Occupational Noise Management | 22 |
| Safety Engagement | 20 across the base and CRUD/workflow upgrades |
| Document Control | 5 |
| Tools & Equipment | 5 |
| Contractor Management | 4 |
| Training & Competency | 4 |
| Chemical Control | 3 |
| Incident Management | 3 |
| SOP Generator | 3 |
| SWMS | 3 |
| KPI Configuration | 2 |
| Legal Compliance | 2 |
| Risk Assessment | 2 |
| Master Action Plan | 1 |

**Impact:** a new tenant can load the page and still show blank workspaces, setup warnings, failed saves or missing relationship data. A currently working tenant is not proof that the deployment bundle is complete.

**Recommendation:** replace the hand-maintained bundle with ordered, versioned migrations and a deployment ledger. Add a pre-deployment schema contract test that checks every table and required column used by the current JavaScript.

### P1 — Master Action Plan cannot reliably return to every source record

`mapSourcePageKey()` in `index.html` resolves incidents, investigations, observations, inspections, risk assessments, permits, meetings, legal, chemicals, PPE, tools, fleet, ATEX, MOC, ESG and Occupational Health. It does not resolve these source modules written elsewhere in the application:

- `contractor`
- `emergency`
- `noise`
- `training`
- `documents`

ESG and Occupational Health resolve to the correct module, but `mapApplySourceSearch()` has no record-search adapter for either module. The user therefore lands on the module rather than the exact record.

BBS, Chemical Control and ATEX also create some actions as `source_module='manual'`. The resolver then guesses the module from `source_ref`, which is fragile and cannot guarantee an exact match.

Some action-creation paths omit `source_id`, including selected health, emergency, environmental and noise paths. Those actions cannot be reopened by stable ID even if a resolver is later added.

**Recommendation:** introduce one table-driven source adapter registry:

```text
source_module -> page key -> load function -> open-by-ID function -> reference fallback
```

Require `source_module`, `source_id`, `source_ref` and `source_table` for all module-generated actions. Keep reference searching only for legacy records.

### P1 — Relationship tables are not consistently reciprocal or operational

Several modules have dedicated relationship tables, but their UI behaviour is incomplete:

| Relationship service | Current behaviour | Gap |
|---|---|---|
| Risk Assessment | Saves and displays related module plus entered record ID/reference | Target is free text; no validation, no open-record action and no reciprocal display in the target module |
| SWMS | Synchronises Risk Assessment and Permit references into `swms_relationships` | Relationships are not rendered from `S.relationships`; Risk and Permit do not reverse-query them |
| Legal Compliance | Loads `legal_compliance_relationships` | Loaded relationships are not otherwise used by the upgrade UI; no governed create/open/reverse flow was found |
| SOP Generator | Schema defines `sop_video_relationships` | JavaScript does not query or write the table; publication status does not create a controlled Document relationship |
| Training & Competency | Schema defines `learning_source_relationships` | JavaScript does not query or write the table; governance stores only one source snapshot |
| BBS Observations | Loads and displays `bbs_action_links` | “Create action” opens a blank action form and asks the user to link it manually; it does not create the action link |
| Document Control | Stores generic `related_record` rows | No shared target validation or reciprocal component exists |

**Impact:** a link can appear on one side only, can point to a deleted or mistyped record, and may not be discoverable from the related module.

**Recommendation:** build a shared `record_relationships` service with source and target module/table/ID, relationship type, status, revision applicability, creator and timestamps. Every participating module should use one “Connected records” component that supports validated selection, open record, reciprocal display and orphan warnings.

### P1 — Notification and QR deep links do not open the intended record

QR URLs include `goto`, `record` and `ref`. Email links use `goto`. The load handler reads only `goto` and calls `showPage(goto)`. It ignores `record` and `ref`.

**Impact:** users reach the correct module but still need to search manually; QR scans do not fulfil their record-level navigation promise.

**Recommendation:** after authentication, dispatch the deep link through the same source adapter registry used by Master Action Plan. Preserve the URL until the target module has loaded, then open by stable ID and fall back to reference search.

### P1 — Approval Center covers only part of the controlled workflows

The Approval Center aggregates:

- generic `approval_requests`
- Permit to Work
- Document Control
- Risk Assessment

It does not directly aggregate controlled review states from Incident Management, Legal Compliance, SWMS, SOP Generator, Training, Chemical Control, Contractor Management, Tools & Equipment, BBS, Safety Engagement, Noise Management or MOC unless those modules explicitly create a generic approval request.

**Impact:** “Approval Center” is not yet an enterprise-wide approval inbox; pending decisions remain distributed across module-specific tabs.

**Recommendation:** define a common approval adapter contract with module, table, record ID, reference, title, stage, approver, due date, confidentiality and open-record callback.

### P1 — Optional-table failure can erase all enhanced data for a module session

Chemical Control, Contractor Management, Training, Legal Compliance, Risk Assessment, SOP Generator, SWMS and Tools & Equipment load multiple enhancement tables in a single `Promise.all`. If one table or permission fails, the catch block clears all related arrays and marks the whole enhancement schema unavailable.

**Impact:** one missing relationship or audit table can make otherwise valid information appear blank, recreating the “module is blank” symptom.

**Recommendation:** use independent settled requests, retain successful datasets, show the failed dependency by name, and disable only the affected feature.

### P2 — Module registries are still drifting

The current launched-module registry does not match all navigation and administration registries:

| Registry | Missing launched modules |
|---|---|
| Desktop Modules menu | Chemical Control, SWMS |
| Mobile module directory | SWMS |
| Company module catalogue | Executive Dashboard |
| Administrative module catalogue | Executive Dashboard, People |

**Impact:** the same user can see a module in the sidebar but not in another supported navigation or access-management surface.

**Recommendation:** generate sidebar, desktop menu, mobile directory, access catalogue, labels, icons and role rules from one canonical module registry.

### P2 — Site Map operational relationships rely on text matching

Site Map links saved plans and markers with stable identifiers, which is good. However, its incident, observation, inspection, risk, permit and action summaries are associated with a site by matching location/site/department/title text.

**Impact:** renamed sites, similar names and inconsistent spelling can produce false matches or missing records.

**Recommendation:** add `site_id` and optionally `area_id` to operational records, populate them through record pickers, and keep text matching only as a migration fallback.

### P2 — Person relationships are split between IDs and names

People, Training, Occupational Health, PPE, Document acknowledgements, Meetings and some action assignments still contain name-based links. Some forms save both ID and name; others save only the name.

**Impact:** renamed users, duplicate names and contractor/employee transitions can fragment a person's history.

**Recommendation:** make People the canonical identity record. Store `person_id` on every person-linked record and retain the name only as an immutable display snapshot. Add a controlled merge process for existing duplicates.

### P2 — Several operational relationships remain reference-only

Examples include:

- ATEX stores a risk reference and a permit type rather than verified record IDs.
- PPE stores work-order, risk and hazard references as text.
- Legal calendar stores obligation and action references as text.
- Some Work Schedule, SWMS and Permit relationships still retain reference fields for compatibility.

**Recommendation:** use validated selectors that save stable IDs plus the visible reference snapshot. Add background reconciliation for legacy reference-only records.

### P2 — One dashboard route still applies the wrong active navigation item

The Dashboard “View incidents” button calls `showPage('events', document.querySelector('.nav-item'))`, which passes the first navigation item rather than the Incident navigation item.

**Impact:** Incident Management opens, but the sidebar can continue to highlight Dashboard.

**Recommendation:** let `showPage()` resolve the active navigation item from the page key; callers should not pass DOM elements.

### P2 — Offline cache does not contain all current upgrade assets

Twenty-three local assets referenced by `index.html` are not explicitly present in `sw.js`, including the shared icon system and the Chemical, Contractor, Document, KPI, Training, Legal, Risk, SOP, SWMS and Tools upgrade assets.

**Impact:** an offline session or stale cache may render a legacy module interface without its current relationship features.

**Recommendation:** generate the service-worker asset manifest from the built application and version it automatically.

## 4. Module-by-module relationship assessment

| Module | Relationship status | Main observation / improvement |
|---|---|---|
| Dashboard / HSE Control Centre | Partial | Aggregates many modules successfully; drill-downs generally open only the module. Fix incident active navigation and add exact-record drill-down adapters. |
| Executive Dashboard | Partial | Relies on source data quality and shared company scope. Add per-widget source, freshness and drill-down metadata. |
| AI Insights | Partial | Can create actions but uses AI/manual source metadata. Save the analysed record ID and require explicit user confirmation before linking. |
| Objectives & KPIs | Good / partial | Monthly data drives dashboards. Add explicit links from KPI exceptions to source evidence, actions and reporting-cycle records. |
| Safety Engagement | Good internally | Strong programme/person/result relationships. Add reciprocal links to training, actions and observations through the shared relationship service. |
| Work Schedule | Good | Uses selectable Risk Assessment, Permit and work references. Continue replacing legacy reference-only fields with IDs. |
| Incident Management | Strong internally | Incident/investigation records are linked in application logic, but several IDs remain text and action return paths vary. Add validated FKs or integrity checks and a universal connected-record panel. |
| BBS Observations | Partial | Structured internal tables are strong. Action links are loaded, but the create-action handoff does not create the link automatically. |
| Audits & Inspections | Good / partial | Findings create actions. Add exact return-to-inspection and reciprocal action state rather than search-only reopening. |
| Risk Assessment | Partial | Connected records are visible but entered as free text and not reciprocal. Validate and open target records. |
| Tools & Equipment | Strong internally | Upgrade schema has real equipment FKs. Connect defects, maintenance and actions through exact open-record adapters. |
| Fleet Management | Partial | Reuses Tools for vehicles and ESG for fuel. Make the shared ownership explicit and retain stable vehicle IDs across both modules. |
| ATEX Areas | Weak | Risk/permit relationships are reference/type fields. Replace with verified RA, Permit and Equipment IDs. |
| Site Map | Partial | Plan hierarchy uses IDs; operational overlays use text matching. Add `site_id`/`area_id` to all source records. |
| Permit to Work | Good / partial | RA and method-statement references are checked in several paths. Add a permanent connected-record panel and reciprocal SWMS/RA visibility. |
| Contractor Management | Good internally | Assurance, documents, mobilisation and packages are linked. Master Action Plan cannot return to contractor sources. |
| Emergency Management | Good internally | Drills and activations create actions. Master Action Plan cannot return to emergency sources. |
| Occupational Health | Partial | Health records create follow-up actions, but several lack source IDs and person links are mixed. Add privacy-aware person IDs and exact source adapters. |
| PPE | Partial | Equipment IDs are used, but employee and RA/work-order links remain mixed. Use canonical people and record IDs. |
| Fire Safety | Partial | Aggregates records by area text and can open related modules. Store exact asset/layout/site relationships. |
| Chemical Control | Good internally / partial externally | SDS, use approvals and inventory events are linked. Some MAP actions use `manual`; Chemical is absent from the desktop Modules menu. |
| Environmental / ESG | Partial | Creates actions and shares fleet data conceptually. MAP opens ESG but cannot focus the exact source record. |
| Occupational Noise Management | Strong internally / partial externally | Rich internal schema. MAP cannot return to noise sources; exposed groups should link to Occupational Health by stable IDs. |
| HSE Meetings | Partial | Meeting actions are created, but person and action relationships are often name/reference based. |
| Training & Competency | Partial | Courses, people and competency records are broad. `learning_source_relationships` is not used and MAP cannot return to training sources. |
| Master Action Plan | Partial shared hub | Central source metadata is valuable, but source adapters and required identifiers are incomplete. |
| Management of Change | Conceptual risk | MOC is stored in `action_tracker`. Separate the change request lifecycle from resulting corrective actions while preserving links. |
| Legal Compliance | Partial | Records and relationships tables exist, but governed relationships are not operational in the UI. Use verified linked records and reciprocal display. |
| SOP Generator | Partial | Video/evidence workflow exists, but relationship table and Document Control publication handoff are not implemented. |
| SWMS / Method Statements | Partial | Saves RA and Permit links, but does not show them from the relationship dataset or reciprocally. Missing from desktop and mobile module directories. |
| Document Control | Strong internally / partial externally | Revision/record model is strong. Related records need validation, reciprocal display and MAP source return. |
| People | Foundational but incomplete | Must become the canonical identity source for Training, PPE, Health, Meetings, Documents and assignments. |
| Users & Roles | Good | Access relationships exist. Generate role/navigation rules from the same module registry to prevent drift. |
| Companies | Good / partial | Tenant scope is central. Company module catalogues are inconsistent with launched modules and schema readiness is not shown. |
| Integrations | Partial | Connector status exists, but source ownership and last-sync relationships should be standardised. |
| Approval Center | Partial | Covers four sources. Adopt approval adapters for every controlled workflow. |
| Audit Trail | Partial | Shared audit records exist, but coverage depends on each module calling its helper. Add relationship-open events and coverage tests. |
| Settings | Supporting | Centralise relationship types, source adapters, approval adapters, identifier rules and retention policies here. |

## 5. Relationships that are working well

- Static page destinations, page containers and loader mappings are complete.
- Company scoping is widely applied through `company_id` and tenant filters.
- Tools & Equipment uses real foreign keys for the equipment lifecycle tables.
- BBS, Safety Engagement and Noise Management have strong internal domain schemas.
- Incident Management has a coherent internal case model linking incidents, investigations, evidence and governed records in application logic.
- Work Schedule has useful record selectors and open-linked-record functions for Risk Assessment and Permit references.
- Permit to Work validates selected Risk Assessment state in important submission paths.
- Master Action Plan saves source metadata in many workflows and is the correct shared corrective-action hub.
- Deep links wait for authentication before navigation, avoiding premature routing.
- The application preserves display references alongside many stable IDs, which is useful for audit reports when implemented consistently.

## 6. Recommended remediation roadmap

### Phase 1 — Prevent broken deployments and blank modules

1. Create ordered migrations and a schema version ledger.
2. Rebuild the clean production bundle from the migration ledger.
3. Add an automated table/column/RLS contract check.
4. Replace all-or-nothing optional `Promise.all` loaders with settled, feature-level loading.
5. Generate the service-worker asset list from the deployed build.

### Phase 2 — Establish one relationship platform

1. Create the canonical module registry.
2. Create the source adapter registry for exact record opening.
3. Create the shared `record_relationships` service and Connected Records UI.
4. Backfill action source IDs and migrate `manual` module values where the source is known.
5. Add orphan detection and reciprocal relationship health indicators.

### Phase 3 — Consolidate workflow services

1. Expand Approval Center through module adapters.
2. Standardise audit-event coverage and immutable record links.
3. Route notification and QR links through the source adapter registry.
4. Separate MOC requests from corrective actions while linking the outcomes.
5. Add exact record drill-downs to dashboards, Site Map and reports.

### Phase 4 — Consolidate identity and location

1. Make People the canonical `person_id` source.
2. Add controlled identity reconciliation for legacy name-based records.
3. Add stable `site_id` and `area_id` relationships to operational modules.
4. Replace reference-only ATEX, PPE, Legal Calendar and legacy work links with verified selectors.

## 7. Suggested acceptance criteria

- Every launched module appears consistently in all intended navigation and access catalogues.
- Every module-generated action can return to the exact source record by ID.
- Every QR/email deep link opens the intended record after authentication.
- Every controlled module exposes pending decisions in Approval Center.
- Connected records are visible from both sides or explicitly marked one-way.
- Deleting or archiving a linked record produces a controlled relationship status, not a silent orphan.
- A missing optional table disables only that feature and never blanks the whole module.
- A clean tenant can be provisioned from the migration ledger with no manual SQL discovery.
- Every person-linked record has a canonical `person_id` or a documented legacy exception.
- Every site-based operational record has a stable `site_id` or a documented migration fallback.

## 8. Audit limitation

This was a static, read-only assessment. It confirms source mappings, relationship implementations, schema declarations, asset references and structural gaps. It does not prove the current production database has or lacks a particular migration, nor does it execute every role-specific save, approval, notification or deletion transaction. A follow-up authenticated integration test should verify the Phase 1–2 acceptance criteria against a non-production tenant.
