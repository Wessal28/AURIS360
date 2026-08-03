# AURIS360 Module Usability and Relationship Audit

**Assessment date:** 4 August 2026

**Scope:** All production modules, internal workflow pages, navigation surfaces, shared workflow services, module assets and deployed relationship tables

**Assessment type:** Read-only product, source, navigation and schema review

## 1. Executive assessment

AURIS360 is functionally broad and several recently upgraded modules now have a strong, consistent product direction. The Dashboard, Objectives & KPIs, Safety Engagement, Incident Management, BBS Observations, Occupational Noise Management, Risk Assessment, Legal Compliance, SWMS and Document Control are the strongest examples.

The application is usable, but it is not yet consistently easy to learn across the whole suite. The main issue is not missing functionality. It is that functionality has accumulated through different generations of interface patterns. Some modules provide clear dashboards, tabs, filters and guided tasks; others expose large forms or thin registers with limited guidance.

The primary sidebar navigation is structurally complete. All 36 static sidebar destinations have matching pages and loader functions, while Safety Engagement and Management of Change are inserted dynamically. However, the same module catalogue is repeated in several different code lists. Those lists have already drifted: SWMS is missing from both the desktop Modules menu and mobile module directory, Chemical Control is missing from the desktop Modules menu, and Safety Engagement is missing from the mobile module directory.

Cross-module storage is generally available in the deployed database. The sampled core, operational and relationship tables all responded successfully. The larger weakness is the user journey back from a shared action or linked record to its source. The Master Action Plan can resolve incidents, observations, inspections, risk assessments, permits, meetings, legal items, chemicals, PPE, tools, fleet, ATEX, MOC, ESG and occupational-health sources. It does not currently resolve contractor, emergency, noise, training or document sources. Users can therefore see that an action came from a module but may not be able to open the originating record.

### Overall conclusion

**Current usability:** Good but inconsistent

**Core navigation reliability:** Good

**Cross-module traceability:** Moderate

**Mobile discoverability:** Moderate

**Schema availability in the current deployment:** Good

**Deployment repeatability for a new tenant:** Needs attention

## 2. What was verified

- 38 application pages were inventoried: 36 static sidebar pages plus internal Investigation and Management of Change pages. Safety Engagement creates its page and navigation entry dynamically.
- Every static sidebar destination has a matching `page-*` container.
- Every production page key has a loader registered in the central `showPage()` routing map.
- All 20 local upgrade JavaScript and CSS assets referenced by `index.html` exist.
- All inline scripts and referenced local JavaScript assets passed syntax parsing with no syntax errors.
- Role-based navigation, company module access and launched-module gating are applied before opening a page.
- Read-only requests against 21 deployed Supabase tables returned HTTP 200, including the core registers and recent operational/relationship tables.
- Exact application field checks passed for `action_tracker`, `swms_relationships`, `legal_compliance_relationships`, `approval_requests` and `notification_queue`.
- Cross-module handoff functions, Master Action Plan source resolution, approval aggregation, audit logging, notifications and PWA caching were reviewed.

### Important test limitation

This audit did not submit, approve, delete or modify production records. There was no authenticated production browser session available to execute every role-specific transaction. Consequently, the report confirms source integrity, navigation mappings, asset availability and deployed schema compatibility, but not a complete end-to-end save/approve/notify test for every role and module.

## 3. Priority observations

### P1 — Consolidate the module navigation registries

The application maintains separate lists for the sidebar, desktop Modules menu, mobile module directory, company module catalogue, admin module catalogue, launched modules and role permissions. This duplication is already causing visible drift.

Confirmed discrepancies:

- SWMS is available in the sidebar and company catalogue but absent from the desktop Modules menu.
- SWMS is absent from the mobile module directory and mobile search.
- Chemical Control is available in the sidebar and mobile directory but absent from the desktop Modules menu.
- Safety Engagement adds itself to the desktop module lists at runtime but does not add itself to the mobile directory.
- Some names differ between surfaces, for example Legal Compliance/Legal Register, Document Control/Documents and Master Action Plan/Action Tracker.

**Recommendation:** Create one canonical module registry containing key, label, icon, section, loader, page, launch state, mobile availability and role rules. Generate all menus and admin catalogues from that registry.

### P1 — Complete source-record navigation from the Master Action Plan

Action creation is well integrated across the application, but source navigation is incomplete. Actions created from the following modules do not have a resolver in `mapSourcePageKey()` and `mapApplySourceSearch()`:

- Contractors
- Emergency Management
- Occupational Noise Management
- Training
- Document Control

The result is a message telling the user that the source module could not be identified, even though `source_module`, `source_id` and `source_ref` were saved.

**Recommendation:** Add explicit resolver entries for every permitted `source_module`. Prefer opening by stable `source_id`; use text search only as a compatibility fallback.

### P1 — Make relationships genuinely reciprocal

Risk Assessment, Legal Compliance and SWMS now have dedicated relationship tables. Those tables exist and their required fields are deployed. However, the relationship is mainly displayed from the module that created it. A risk assessment linked to an incident does not automatically appear as a linked risk assessment inside the incident record.

Most relationship IDs are stored as text without a database foreign key because the target may belong to different tables. That is flexible, but it permits stale or mistyped references.

**Recommendation:** Add a shared relationship service and reciprocal “Connected records” component used by all modules. Validate the target record when a link is created, display broken-link warnings, and run a scheduled orphan check.

### P1 — Update the production schema bundle and migration process

The deployed database currently contains the recent operational and relationship tables. However, `auris360_production_schema_bundle_CLEAN.sql` does not include the recent KPI, Safety Engagement, BBS, Noise, Incident, Document Control, SWMS, Legal Compliance and Risk Assessment upgrade migrations.

This creates a repeatability risk: the current environment works, but a new tenant following the README can still receive blank modules or “relation/column does not exist” errors.

**Recommendation:** Introduce a numbered migration ledger and rebuild the production bundle from those migrations. Add an automated schema compatibility check to deployment.

### P1 — Complete PWA caching for upgraded modules

The service worker pre-caches Safety Engagement, BBS, Noise and Incident assets. It does not pre-cache the KPI, Document Control, SWMS, Legal Compliance or Risk Assessment upgrade assets. Those modules can therefore lose their enhanced interface when opened offline or when a cached `index.html` refers to an asset that was never cached.

**Recommendation:** Generate the pre-cache list from `index.html`, or at minimum add every local CSS and JavaScript asset and increment the cache version automatically during deployment.

### P2 — Reduce form density through progressive disclosure

The most complex pages contain very large form surfaces: Occupational Health, Emergency Management, Training, Incident Management, Legal Compliance, Contractor Management, PPE and Meetings. Tabs help, but several workflows still present too many fields before the user understands which ones are required.

**Recommendation:** Standardise a guided form shell with:

- a short first step containing only essential fields;
- visible required-field counts and completion progress;
- conditional sections based on assessment/event type;
- sticky Save Draft and Continue actions;
- inline validation next to the affected field;
- a final review summary before submission.

### P2 — Expand the Approval Center contract

The Approval Center directly aggregates Permit to Work, Document Control and Risk Assessment, plus any generic workflow requests. Other modules use status fields, review buttons or action records without consistently creating generic approval requests.

**Recommendation:** Define one approval adapter contract for every controlled module: module key, record ID, reference, title, current step, assigned approver, due date and open-record callback.

### P2 — Fix misleading active navigation on one dashboard link

The dashboard “View incidents” button opens Incident Management but passes the first sidebar item as the active navigation element. The page opens, but Dashboard can remain highlighted.

**Recommendation:** Pass `#nav-events`, or call a shared navigation helper that resolves the active navigation entry from the page key.

### P2 — Use stable person and record IDs consistently

Several older workflows still connect records by display name or free-text reference. This is especially visible in People, Training, PPE, Meetings, Occupational Health, Work Schedule, ATEX and legacy SWMS fields. Names change and are not unique.

**Recommendation:** Store the stable person/record ID and keep the display name/reference only as a snapshot for reporting.

## 4. Module-by-module assessment

| Module | Usability assessment | Relationships and observations | Recommendation |
|---|---|---|---|
| Dashboard / HSE Control Centre | Strong | Clear role-oriented landing view and operational drill-downs. One incident link can leave the wrong sidebar item highlighted. | Fix active-navigation resolution and add a visible “data last refreshed” indicator. |
| Executive Dashboard | Good | Useful management summary with role gating. Value depends on consistent source-module data quality. | Add drill-down breadcrumbs and data-quality indicators for each KPI. |
| AI Insights | Good but complex | Broad analysis capability; correctly role restricted. Large action surface can make the advisory/record distinction unclear. | Mark every AI result as advisory and require an explicit user action before creating records. |
| Objectives & KPIs | Strong | Dashboard, scorecard, monthly follow-up and configuration are substantially improved. Relies on KPI and monthly-data schema and reporting-period logic. | Add a visible reporting-cycle state and retain the current-month “not yet due” treatment. |
| Safety Engagement | Strong | Good personal/team separation, privacy concepts and mobile workflow. Missing from the mobile module directory. | Register it in the canonical mobile navigation and confirm offline draft encryption claims with a security test. |
| Work Schedule | Usable but dense | Links to incidents and operational work, but several relationships are text references. | Use type-driven creation forms and stable record pickers. |
| Incident Management | Strong but dense | Good lifecycle, evidence and investigation integration. Very large workflow surface. | Use progressive disclosure and one persistent incident header across all investigation stages. |
| BBS Observations | Strong | Good observation workflow and Action Plan creation. Some legacy actions use `manual` as the source module and rely on reference-text detection. | Save `source_module='observation'` consistently and open the exact observation by ID. |
| Audits & Inspections | Good | Mature checklist and finding workflow with action creation. | Add saved views, clearer audit/inspection terminology and direct return links from actions. |
| Risk Assessment | Strong | Dashboard, register, My Work, governance, assurance and relationship storage are good. Reciprocal display is incomplete. | Reuse the Connected Records component in the linked modules and add broken-link validation. |
| Tools & Equipment | Good | Equipment, inspection and action workflows are integrated. | Separate daily operational actions from configuration/template functions more clearly. |
| Fleet Management | Understandable but thin | Mostly routes vehicle work to Tools & Equipment and fuel to ESG. This avoids duplication but is not obvious to users. | Present it explicitly as a fleet workspace backed by shared Asset and ESG records. |
| ATEX Areas | Usable | Can open Risk Assessment and Permit to Work, but stores a risk reference and permit type rather than a verified record relationship. | Replace free-text linkage with record pickers and reciprocal links. |
| Site Map | Good | Strong hierarchical layout links using stable layout IDs. Local-only fallback can create device-specific divergence. | Clearly badge local/shared state and prevent silent local-only edits for controlled layouts. |
| Permit to Work | Good but dense | Approval workflows, risks and work controls are present. It is one of the Approval Center’s supported sources. | Provide a compact permit summary, current approval step and linked SWMS/RA panel at all times. |
| Contractors | Good but dense | Pre-assessment, authorisation, incidents and actions are integrated. Actions cannot navigate back to the contractor source. | Add source resolver and a single contractor profile timeline. |
| Emergency Management | Functional but very dense | Plans, drills, activations, equipment and ERT records are comprehensive. Corrective actions cannot navigate back to their source. | Split preparedness and live response into distinct workspaces and add source return links. |
| Occupational Health | Functional but highest complexity | Comprehensive surveillance, audiometry, spirometry, disease and exposure workflows; creates follow-up actions. Sensitive data and 165 form controls increase error/privacy risk. | Introduce privacy-scoped views, conditional clinical forms and a clear minimum-data policy. |
| PPE | Good | Catalogue, issuance, inspection and replacement workflows are linked to actions. | Use stable person/equipment IDs and show the employee’s complete PPE history in one view. |
| Fire Certificates / Fire Safety | Good | Certificates, equipment, inspections and layouts are broader than the sidebar label suggests. | Rename to “Fire Safety Management” and connect findings/actions back to the exact asset or layout marker. |
| Chemical Control | Usable | Chemical register and action creation are available. Missing from the desktop Modules menu. | Add it to the canonical module registry and strengthen SDS/document and risk links. |
| Environmental / ESG | Good but broad | Fuel, waste, water, spills and inspections are combined, with action creation. | Use domain dashboards and keep shared vehicle IDs for Fleet integration. |
| Occupational Noise Management | Strong | Recent upgrade provides a clearer specialised workflow and creates calibration actions. Action source return is missing. | Add exact survey return links and connect exposed-person groups to Occupational Health surveillance. |
| HSE Meetings | Good but dense | Meetings and toolbox talks create actions and can reference work. The presenter field is replaced dynamically, which is valid but harder to maintain. | Simplify meeting-type selection and show actions/attendance in a final review step. |
| Training | Good but dense | Training plans, needs, courses, enrolments and follow-up actions are broad. Action source return is missing. | Add one learner timeline, source return links and stable person IDs throughout. |
| Master Action Plan | Strong shared hub | Central action model and source metadata are valuable. Source navigation coverage is incomplete for five modules. | Make source resolution table-driven and show a relationship-health badge on every action. |
| Management of Change | Usable but conceptually weak | Stored inside `action_tracker`; efficient reuse, but a change request is not the same object as a corrective action. | Keep the friendly MOC workspace, but introduce a dedicated change header/state model linked to resulting actions. |
| Legal Compliance | Strong | Improved dashboard/register separation and relationship storage. Reciprocal linked-record display is incomplete. | Add verified target selection, expiry calendars and evidence completeness indicators. |
| SOP Generator | Usable | Straightforward authoring workflow, but integration with controlled Document records is less explicit than SWMS. | Publish approved SOPs into Document Control and preserve the SOP revision lineage. |
| SWMS / Method Statements | Strong | Good register, briefings, field verification, work packs and relationship storage. Missing from desktop Modules menu and mobile directory. | Fix discoverability and replace remaining free-text RA/PTW references with verified relationships. |
| Document Control | Strong | Good controlled-document lifecycle, acknowledgements, copies, revisions and action integration. | Add Document Control upgrade assets to PWA caching and provide reciprocal links from source modules. |
| People | Basic but important | Acts as a people register, but several downstream modules still match users by name. | Make People the canonical person identity source and expose a consolidated competency/PPE/health access-controlled timeline. |
| Users & Roles | Good | Clear profile, role, notification and access administration with protected operations. | Reconcile the visual permission matrix with the executable role rules from one source. |
| Companies | Good but administration-heavy | Company, module access, site access and branding are available. Multiple module catalogues can produce inconsistent selections. | Generate access controls from the canonical registry and show migration/schema readiness per tenant. |
| Integrations | Usable | Provides configuration and sync visibility, but integration depth varies. | Show last successful sync, failure count, owner and retry action consistently for each connector. |
| Approval Center | Useful but partial | Aggregates Risk, Permits, Documents and generic requests. Other controlled modules are not consistently represented. | Adopt one approval adapter for every controlled workflow. |
| Audit Trail | Good foundation | Central chronological view exists, but audit event coverage depends on each module calling the helper. | Add automated coverage tests and display immutable record links where authorised. |
| Settings | Good | Shared notification, workflow, custom-field and security settings exist. | Group settings by business outcome and add dependency/readiness checks before enabling features. |

## 5. Relationship assessment

| Relationship | Current state | Risk |
|---|---|---|
| Module → Master Action Plan | Widely implemented using source metadata | Some sources cannot be reopened; several legacy sources rely on text matching. |
| Master Action Plan → source module | Partial resolver | Contractor, Emergency, Noise, Training and Documents are not mapped. |
| Risk ↔ Incident/Inspection/Permit/Legal/Training/Documents | Relationship table available | Mainly visible from Risk; target modules do not consistently show the reciprocal link. |
| SWMS ↔ Risk/Permit | Operational and relationship tables available | Legacy fields still accept free text; mobile discoverability is weak. |
| Legal ↔ Evidence/Permit/Action/Other records | Relationship table available | Target validation and reciprocal display are incomplete. |
| Approval Center ↔ controlled modules | Strong for Risk, Permit and Documents | Coverage is not uniform across other controlled workflows. |
| Audit Trail ↔ module records | Shared audit helper and central view | Coverage is voluntary and record-open callbacks are inconsistent. |
| Notifications ↔ users/workflows | Shared queue and recipient checks | Channel support and workflow adoption vary by module. |
| People ↔ Training/PPE/OH/Meetings | Broad functional relationship | Older flows use names rather than stable person IDs. |
| Site Map ↔ child layouts | Stable linked plan IDs | Local-only fallback can cause inconsistent shared state. |

## 6. Recommended delivery plan

### Phase 1 — Reliability and discoverability

1. Create the canonical module registry and generate all desktop/mobile/admin navigation from it.
2. Add SWMS, Chemical Control and Safety Engagement to every relevant navigation surface.
3. Complete Master Action Plan source resolution for Contractors, Emergency, Noise, Training and Documents.
4. Rebuild the production schema bundle from a migration ledger.
5. Generate the PWA asset cache from the files referenced by `index.html`.
6. Fix the dashboard active-navigation issue.

### Phase 2 — Consistent usability

1. Create one standard module shell: title, description, primary action, tabs, contextual filters and consistent empty/error states.
2. Create one standard guided-form shell with progress, Save Draft, inline validation and review-before-submit.
3. Standardise saved views, date filters, owner filters and reset behavior.
4. Use a shared person picker and record picker backed by stable IDs.
5. Expand Approval Center coverage through a module adapter contract.

### Phase 3 — Relationship integrity

1. Build a shared Connected Records component.
2. Validate the target record before saving a relationship.
3. Display reciprocal links in both source and target modules.
4. Run scheduled orphan/stale relationship checks.
5. Add end-to-end tests for create → action → source return, submit → approve → release and record → reciprocal link journeys.

## 7. Suggested acceptance criteria

- Every launched module appears consistently in the sidebar, desktop Modules menu, mobile directory, mobile search and company-access catalogue.
- Every action with `source_id` opens the exact source record; no supported source relies solely on text search.
- Every linked record is visible from both sides of the relationship.
- A fresh tenant created from the documented schema bundle opens every launched module without a missing-relation or missing-column error.
- All local assets referenced by the current `index.html` are available offline after PWA installation.
- No primary workflow shows more than the essential first-step fields before the user selects the record type/context.
- Every controlled module exposes its pending decision in Approval Center.
- Every tested role sees only authorised modules and actions on desktop and mobile.
- Automated smoke tests cover navigation, empty states, record creation, editing, approval, action creation, source return and responsive layout.

## 8. Final recommendation

Do not redesign all modules. The strongest recent modules already establish an appropriate visual and interaction pattern. The highest-value work is to standardise navigation, guided forms, relationship handling and deployment readiness around those patterns. This will make the suite feel coherent without discarding mature functionality.
