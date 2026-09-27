# Deployment notes
Apply 20260927010000_people_onboarding_user_access.sql before app deployment. Configure existing SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY server variables. Verify phone/password authentication in Supabase before phone onboarding. No SMS is sent; the administrator receives temporary credentials.

Restrictions supplement role/company controls. Reload sessions after saving access. Database enforcement covers mapped operational tables and profile changes. Shared platform datasets retain existing controls.

IMPORTANT: The externally hosted admin-users Edge Function is absent from this repository. Update its server handlers to check permissions.access_v1.users view and create (invite/create) or edit (update/password/status), plus existing role/tenant checks. The app checks those actions, but direct calls to the external function remain outside this change. Do not delegate restricted administrator authority until that server function is updated.

Validation: 1575 JavaScript tests passed; targeted onboarding/access tests passed; all 34 migrations replayed with database behavior checks; onboarding dialog checked at 390px. No real invitations sent.
