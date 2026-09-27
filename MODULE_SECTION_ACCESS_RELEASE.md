# Module and section access

Companies > Module Access now uses a Company dropdown. Only the selected company's module catalogue is rendered. Selection stays after refresh and install/uninstall operations; the global active company is not changed.

Users & Roles > edit user > Module access > select module. Use View/Create/Edit/Delete for the module, and section View checkboxes for its tabs. Save access, then reload the user's session. Settings sections remain individually configurable. Sections inherit a denied parent module. If every listed section is hidden, the module is hidden. Existing saved permissions remain unchanged.

People, Users & Roles, Companies, Integrations, Approval Centre, Audit Trail, Shared Master Data and Settings navigation are reserved for company admins and SEPHS admins. Existing operational roles and tenant scope remain in force; company admins do not gain SEPHS-only multi-company privileges. Shared people lookup data remains available to operational forms that need employee names.

Apply supabase/migrations/20260927020000_module_section_access.sql to staging after the previous People/user-access migration, before deploying this branch. It adds inherited section checks, policies for separate section datasets, inspection-type filtering, protected mutation triggers and RPC checks. It is safe to rerun and skips optional missing tables. On production apply the same migration only after staging acceptance.

Tabs on Executive, Incidents, BBS, Inspections, Legal, Tools, Contractors, ESG, Occupational Health, PPE, Meetings, Training, Actions, SOP, Documents, Fire, KPIs, Emergency and Chemical are configurable. Modules without separate tabs retain whole-module/action controls. Shared registers and summary views may draw from the same allowed dataset; these controls are not field-by-field redaction. The previous deployment limitation for the externally hosted admin-users function remains: update that function before delegating restricted administrator authority.

Validation: all 35 ordered migrations replayed; database behavior tests including hidden PPE issuance rows passed; company selection and role/section behavior tests passed; compact editor/save tested at 390px width without overflow; syntax, asset manifest and platform budgets passed. Release readiness passed all 977 release contracts; targeted company, permissions, toolbox, migration, chemical and emergency tests passed.
