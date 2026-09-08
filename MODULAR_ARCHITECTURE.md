# AURIS 360 Modular Architecture

## Toolbox Talks shared register adoption

`auris-toolbox-list-workspace.js` adopts the common List, Card and read-only Board views for the HSE Meetings Toolbox Talks register. Topic, search and status filters combine, and saved personal views restore all three controls. Reference and Toolbox talk remain required columns; presenter, location, recorded attendees/actions, talk date and status are visible by default, with duration and department optional. Preferences are scoped by company, user and this specific register, not the whole Meetings module. Unknown or missing statuses are not relabelled Completed; named attendees take precedence over a legacy stored count, and unavailable/malformed counts remain explicitly unrecorded.

The loader clears obsolete records and metrics, explicitly scopes its request to the current company, validates the response and ignores superseded or changed-session loads. Summary cards follow the filtered register. Opening a talk re-fetches the exact company/record before replacing its cached row and calling the established editor. New loads, views, account/company/role changes, loss of access or offline state invalidate an in-flight handoff. Malformed attendee/action structures are disclosed before the editor is opened. Opening failures remain visible inside the shared register.

The existing talk form, attendance confirmation, AI draft, linked-work, action creation, save/delete and individual print handlers remain authoritative. This phase introduces no approval route, Board mutation or database migration. Common print preparation preserves clickable reference/title text. `tests/toolbox_list_workspace.test.cjs` covers projection, filtered metrics, saved filters, response validation and fresh guarded editor handoff; the local synthetic `tests/fixtures/toolbox-list-workspace.html` covers columns, personal views, portrait controls, scrolling, errors and printing. Release readiness, isolated staging and canonical production smoke require the new adapter. Authenticated production saves are not exercised by these synthetic tests.

## Foundation 1

`auris-module-registry.js` is the canonical application catalogue. A module manifest declares its route key, display names, category, icon, colour, loader, dependencies, and whether it is configurable per company or belongs to the platform.

The registry now supplies:

- the desktop Apps launcher;
- the mobile module directory;
- company module-access catalogues;
- module colours and labels;
- route loader resolution; and
- dependency metadata for future installation and workflow checks.

Do not add another standalone module catalogue. Add or change the manifest in the registry, then use `AurisModuleRegistry.get()`, `list()`, `keys()`, or `dependenciesOf()`.

## Compatibility boundary

Existing page elements, route keys, company `module_access` values, role rules, and module loader functions remain authoritative. The registry adapts those existing contracts rather than renaming stored data or rewriting business modules.

`LAUNCHED_MODULES` remains the controlled production-release policy. A registered application is discoverable metadata; it is not automatically released to clients.

## Foundation 2

`auris-module-runtime.js` is the shared application lifecycle boundary. Routing now activates registered modules through four cancellable lifecycle phases: `beforeLeave`, `leave`, `beforeEnter`, and `enter`. Modules can register hooks without changing the router, and the runtime emits matching `auris:module-*` DOM events for shell-level integrations and diagnostics.

The registry also supplies dependency and workflow services:

- `dependencyClosure()` returns a deterministic, dependency-complete module selection;
- `missingDependencies()` and `dependantsOf()` support activation and administration diagnostics;
- company module access automatically includes required dependencies and removes dependants when a requirement is disabled;
- every manifest declares a shared layout contract; and
- `workflowOf()`, `nextStates()`, and `canTransition()` expose declarative workflow metadata.

Incident Management is the reference workflow manifest. Its current production record handlers remain authoritative; the declarative map documents the target states and allowed transitions without silently rewriting stored records. Later slices will move mutation enforcement behind the shared workflow service.

## Foundation 3

`auris-platform-services.js` is the stable service boundary for independently loaded applications. It exposes `auth`, `api`, `rbac`, `audit`, and `notifications` facades without giving modules direct access to mutable core globals. The existing production implementations are registered as compatibility adapters by `auris-core.js`, allowing modules to migrate incrementally without changing authentication, tenant isolation, role rules, audit evidence, or notification delivery.

Every module lifecycle context now receives the same service container as `context.services`. New module code should use that container (or `AurisPlatformServices`) instead of calling core globals such as `api`, `prof`, `tok`, `canAccessPage`, `auditLogEvent`, or `queueNotification` directly.

The service container publishes readiness through `health()`, `ready()`, `subscribe()`, and the `auris:service-ready` DOM event. This makes missing platform capabilities diagnosable before a module starts.

## Foundation 4

`auris-module-layout.js` renders the shared application workspace declared by a module manifest. It supplies a consistent module identity header, Apps breadcrumb, dependency context, grouped view navigation, primary action, refresh action, keyboard navigation, active-view state, and responsive mobile treatment without owning module data or workflow decisions.

Incident Management is the reference implementation. Its dashboard, personal work, reporting, registers, triage, investigations, actions, regulatory work, lessons, reports, and configuration now use the same layout contract while retaining the existing record handlers and tenant controls.

## Next slices

1. Enforce Incident Management transitions through a tenant-configurable workflow service.
2. Connect the reusable Approval Centre rules to the workflow service.
3. Convert Risk Assessment, Permit to Work, Document Control, MOC, and Master Action Plan to the shared engine.

Every slice must preserve company isolation, role enforcement, offline field drafts, deep links, audit evidence, and release-readiness contracts.

## Foundation 5

`auris-workflow-service.js` is the tenant-aware enforcement boundary for module state changes. It resolves the effective company policy, validates tenant overrides against the module's declared state model, blocks undeclared transitions, identifies approval-gated transitions, enforces module access, and records successful transitions through the shared audit service.

Incident Management is the first enforced module. Existing production incident states remain declared as compatibility states so the service centralises control without silently invalidating stored records. Tenant policy changes can narrow or route allowed transitions but cannot invent states outside the reviewed module contract.

## Foundation 6

`auris-approval-centre.js` connects approval-gated workflow transitions to one reusable decision service. It registers the existing module adapters, retains an exact source page, table, record id, reference and company on every request, rejects cross-company queue items, records governed decisions, and supplies approved evidence back to the workflow service before a status mutation is persisted.

The existing Approval Centre remains the production queue and exact-record navigation interface. Its specialised openers are preserved; the shared service adds tenant and source assertions around them rather than replacing their proven module-specific behavior.

## Foundation 7

Risk Assessment, Permit to Work, Document Control, Management of Change and Master Action Plan now declare their layouts, lifecycle ownership, workflow states, allowed transitions and approval gates in the canonical registry. `auris-priority-module-adapters.js` mounts the shared module shell while routing view selections and commands back to each application's established loaders and record handlers.

The workflow service now reads approval gates directly from reviewed manifests. Existing record vocabularies and dedicated approve, reject, verification and closure handlers remain compatible, while new independently loaded views receive the same registry, service, navigation and tenant enforcement contracts as Incident Management.

## Foundation 8

`auris-applications-admin.js` and `auris-applications-admin.css` provide an Odoo-style Applications administration layer for each company. Applications are shown as Installed, Available or Blocked with dependency, lifecycle, release and shared-service diagnostics. Install plans automatically include dependencies; uninstall plans include recursive dependants so administrators see and apply one controlled rollback impact instead of leaving broken navigation.

The administration layer persists only the existing `companies.module_access` contract through the established tenant-admin path. `LAUNCHED_MODULES` remains the production release boundary, Dashboard remains mandatory, role enforcement still applies after installation, and unreleased modules cannot be enabled from the interface.

## Foundation 9

`auris-governance-persistence.js` supplies the production persistence adapters for the shared workflow and Approval Centre services. Published company workflow policies are hydrated after authentication and whenever a SEPHS administrator changes company context. Once persistence is configured, governed mutations fail closed until that company's policy and pending approval queue have loaded successfully.

`workflow_policy_versions` stores immutable, versioned drafts and published policies with optimistic revision checks, one active policy per company and module, append-only lifecycle evidence, and rollback by creating a new published version from reviewed history. Atomic Supabase RPCs serialise draft numbering, publication, rollback, approval requests and decisions so retries cannot create duplicate pending approvals or decide a request twice.

The existing `approval_requests` and `approval_decisions` tables remain authoritative. Foundation 9 extends them with exact text record identity, source page and reference, transition evidence, idempotency keys and revision numbers. Company RLS remains the first tenant boundary; security-definer functions also make explicit company and management-role checks before performing governed writes.

## Foundation 10

`auris-workflow-studio.js` and `auris-workflow-studio.css` provide a tenant-aware Visual Workflow Studio inside Settings. Company administrators and HSE managers can start from reviewed Incident, Permit, Risk, Document and MOC templates; configure transition roles, required fields, ordered approval stages, SLA targets and escalation roles; simulate access; review active-record impact; save drafts; publish; clone; export/import reviewed JSON; and restore historical policy versions.

The Studio stores declarative JSON only. The shared workflow service rejects executable expressions and undeclared states, validates graph reachability and terminal states, and enforces roles, required fields and approval gates during transitions rather than relying on hidden UI controls. Publication and rollback continue through the Phase 9 atomic persistence functions, retaining tenant RLS, optimistic locking and append-only lifecycle evidence.

## Shared record workspace reliability (1.1)

The existing My Work integration now uses an asynchronous, tenant-bound record panel that ignores obsolete loads after another record is opened or the panel is closed. Record adapters must match the exact module and table, returned record identities are checked, and account/company/role changes block stale actions. Activity and approval evidence are matched to company, record and all supplied module/table identifiers; legacy evidence without a table remains compatible.

Action failures appear inside the open panel. Pending actions cannot be double-submitted, unavailable callbacks are disabled, offline mode prevents mutation handoffs, and background clicks do not dismiss the panel. Explicit close/Escape restores the launcher's focus, keyboard focus stays inside the panel, and portrait layouts use bounded, touch-sized controls and independently scrollable content/actions.

This is a reliability prerequisite for further module adoption, not a replacement of every module's editor. My Work still hands editing and governed transitions to the existing source application; its existing RPCs, audit rules and database permissions remain authoritative. No SQL migration is required for this slice. The interaction regression suite and local-only `tests/fixtures/record-workspace.html` exercise the shared engine without production data.

## Master Action Plan record adoption (workspace 1.2)

Master Action Plan row/Open controls now use `auris-action-record-workspace.js`. This explicit-only adapter reads the exact company action through Platform Services and presents reviewed details, action activity, shared evidence and matching approval requests/decisions in the common record panel. Loading this adapter does not replace My Work's existing integration. Each history source is bounded to its latest 100 entries; unavailable sources and truncated history are disclosed, not silently represented as a complete audit trail.

Only Copy exact link, Edit action and Manage action are offered. Manage action opens the established progress, verification or closure tab according to the current action state. Approval rules, writes, permission checks and audit persistence remain owned by the existing editor; the shared Workflow tab explains that handoff instead of offering inactive transition buttons. The editor prepares before the panel closes, so a failed handoff remains visible inside the panel. A late handoff cannot dismiss a newer workspace. Authentication, company, role and record identity are rechecked during reads and before handoff; the legacy editor also rechecks after its asynchronous people lookup.

No SQL migration or production data change is required. `tests/action_record_workspace.test.cjs`, the shared interaction tests and the local-only `tests/fixtures/action-record-workspace.html` cover this integration. Both staging acceptance and canonical production smoke require the new asset and workspace 1.2 markers.

## Master Action Plan shared lists (view engine 1.1)

`auris-action-list-workspace.js` projects the current company's action register into the shared List, Card and Board views. Existing All, Assigned to Me, Overdue, Pending Verification and Pending Closure scopes, combined search/source/priority/status/type filters and generated references are retained. Source references continue through the exact-source bridge; Open action uses the shared record panel and its established editor handoff. This adapter offers no direct edit, approval or business-data writes.

Personal column choices, sorting, board grouping and named views are isolated by company and user. Reference and Action remain required columns. Saved views restore scope and filters before re-rendering, including the shared navigation indicator. List and board scroll regions are height-bounded; column controls, keyboard focus, touch targets, visible errors and storage-denial feedback are covered by the local synthetic browser fixture. Priority/status badges, overdue/escalated attention and progress remain visible by default; Action type and Department are optional columns.

The view engine now rejects unscoped rows, validates restored settings, avoids grouping/storage-key collisions and blocks stale-session or duplicate asynchronous action dispatch. Action list loading ignores superseded/account-changed responses before updating metrics or invoking the existing reference backfill. No migration is required. `tests/view_engine_interaction.test.cjs`, `tests/action_list_workspace.test.cjs` and `tests/fixtures/action-list-workspace.html` cover this slice; staging and production gates require the new adapter and engine version.

## Management of Change shared lists

`auris-moc-list-workspace.js` adopts the common List, Card and Board views for MOC. The existing search and lifecycle filter, counts, generated references, risk priority, owner and target date remain available. Reference and Change request are required columns; Location, Department, Impacted areas and Record storage are optional. Personal columns, sorting, grouping and named views are scoped to the company, user and MOC module. Board grouping is read-only: it neither approves changes nor moves them through lifecycle stages.

Open change request hands the exact record ID and storage identity to the existing MOC form. The form, linked-record controls, corrective-action creation, permissions and lifecycle writes are not replaced. The adapter checks authentication, module access, company, user and role before invoking that bridge; the bridge also checks the active load generation and dedicated/legacy store. Offline opening of the mutable form is blocked. This is list adoption, not a new approval workflow or a claim that every MOC form already uses the shared record workspace.

The register loader ignores superseded and switched-session responses and rejects invalid payloads. Only an explicit missing MOC-table error permits the legacy fallback; permission, network and missing-column errors remain visible. Legacy mode excludes action rows pointing at a dedicated MOC request, keeping generated corrective actions and migrated retained actions out of the change register. Its compatibility notice remains visible after filtering or changing view. No SQL migration or production business-data write is required.

`tests/moc_list_workspace.test.cjs` covers projection, canonical lifecycle labels, tenant filtering, legacy separation, missing-table-only fallback and guarded editor handoff. The synthetic `tests/fixtures/moc-list-workspace.html` exercises selectable columns, saved views, list/card/board layouts, portrait touch controls and inline failures. Both staging acceptance and canonical production smoke require the new asset.

## Management of Change shared record overview

`auris-moc-record-workspace.js` adds two explicit-only MOC adapters, one for dedicated `moc_change_requests` and one for legacy `action_tracker` change headers. It does not replace My Work or Master Action adapters. Register row actions open the common record panel after an exact company/table/ID read; legacy rows pointing at dedicated MOC requests are rejected. Details include the proposal, risk review, required controls, owner, lifecycle and recorded approval/verification metadata. Legacy description metadata is projected into the same read-only sections without rewriting the stored record.

Shared activity/evidence and MOC approval requests are fetched with exact tenant and source filters and bounded to the latest 100 entries per source. Decisions must belong to those matched requests. Legacy activity logs are read only for the validated legacy change row. Inconsistent company/module/table/record identities are excluded; action approvals are not reclassified as MOC approvals. Missing or malformed history sources and truncation are explicitly disclosed. Evidence attached to comments remains available in the Evidence tab. This is a linked-history overview, not a claim of a complete audit trail.

Only Copy reference and Open change form are offered. The panel does not submit, approve, verify, close, edit or create business records. Existing form controls and their permissions remain authoritative; linked corrective actions remain managed there. The core bridge rechecks the company/user/role, register load generation, storage mode and fresh record identity before replacing the cached row and opening the established form. Offline or failed handoffs retain the panel with visible feedback; successful handoff closes only its active workspace. This phase does not introduce a legacy deep-link route.

No SQL migration is required. `tests/moc_record_workspace.test.cjs` covers fresh reads, strict identity filtering, legacy metadata, unavailable/bounded history, explicit read-only actions and guarded handoff. `tests/fixtures/moc-record-workspace.html` uses synthetic data for desktop/portrait layout, keyboard, evidence, error and lifecycle-guidance checks. Staging acceptance and canonical production smoke require the new adapter.

## Permit to Work shared lists (view engine 1.2)

`auris-permit-list-workspace.js` adopts shared List, Card and read-only Board views. Existing Active/All scopes, search, permit type and status filters remain; saved views restore all four filters and both scope-navigation surfaces. Reference and Work description are required columns. Issuer, receiver, work location, risk, status, start/end times and overdue attention remain available, with creation time optional. Labels use the existing permit catalogues; unknown types/statuses are not relabelled as approved, draft or hot-work records.

The view engine now supports `datetime` fields, showing browser-local hours/minutes and timezone while sorting the original timestamps as instants. Date-only legacy values explicitly say their time was not recorded. Existing date fields remain unchanged. Shared scrolling, column preferences, named views and touch controls remain company/user scoped. Register print preparation converts clickable record text into plain text before the existing print cleanup removes controls, removes view toolbars/actions and releases shared scroll bounds on the print clone only.

Permit loading clears stale rows, metrics and SIMOPS display before fetching, validates the response and scopes rows before metrics and the existing SIMOPS check. Superseded or account/company/role-changed loads cannot repaint the register. Open permit refreshes the exact company/record identity and rejects changed view/load generations, permissions, offline state or missing records before opening the existing specialist detail screen. Approval, gas testing, isolation, suspension, closure, printing and business writes stay with the original permit handlers. The board offers no drag-to-transition or direct approval action.

No SQL migration or production business-data change is required. `tests/permit_list_workspace.test.cjs` and the shared interaction suite verify identity, filters, timestamps, loading and handoff guards. `tests/fixtures/permit-list-workspace.html` provides synthetic browser QA. Both staging and canonical production gates require the new adapter and view engine 1.2.

## Permit to Work shared record overview

`auris-permit-record-workspace.js` adds an explicit-only read-only overview to the shared permit register. It does not replace My Work adapters or the specialist permit controls. An exact company/permit read precedes display. The panel preserves recorded blocks, checklist states, gas readings and results (including zero or missing values), isolation tags and verifier details, required approval levels, recorded level decisions/times, suspension and closure information. It never infers a safe gas result or approval from missing fields. Unknown type/status values stay visible instead of becoming safe defaults; date-only records disclose missing time.

The overview prominently states that it is a snapshot, not authorisation to start or resume work. Only Copy permit reference and Open permit controls are offered. The latter re-fetches the exact permit and checks account/company/role, module access, register load/view generations and connectivity before the existing controls are opened. Issuance, gas classification, isolation, approvals, activation, suspension, closure and SIMOPS remain with the existing handlers. The overview neither performs business writes nor introduces transition buttons.

Permit logs and exactly linked shared activity/evidence/approval requests are tenant/source-filtered and bounded to 100 entries per source, with truncation and unavailable sources disclosed. Shared decisions must belong to the matched request IDs. Shared approval evidence is explicitly separate from the permit's recorded approval levels; it does not authorise the permit. Multiline recorded details retain their line breaks in the common workspace.

No SQL migration is required. `tests/permit_record_workspace.test.cjs` covers raw control preservation, identity boundaries, read-only actions, stale-session rejection, history availability and fresh controls handoff. `tests/fixtures/permit-record-workspace.html` provides synthetic phone/tablet and keyboard checks. Release readiness, isolated staging and canonical production smoke require the new adapter. Existing authenticated production approval or safety-control writes are not part of the synthetic verification.
