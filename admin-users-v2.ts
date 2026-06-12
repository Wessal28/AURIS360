// ════════════════════════════════════════════════════════════════════════════
// AURIS360 — admin-users Edge Function  (v2)
// ════════════════════════════════════════════════════════════════════════════
//
// HOW TO DEPLOY:
//   1. Supabase Dashboard → Edge Functions → admin-users → replace code → Deploy
//   2. Commit this file to GitHub (supabase/functions/admin-users/index.ts)
//      so the function source is finally under version control.
//
// SUPPORTED ACTIONS:
//   - create_user      : provision a new user directly (sets password immediately)
//   - invite_user      : send password-setup email to a new user
//   - reset_password   : send password-reset email to existing user
//   - deactivate_user  : BAN the login (cannot sign in) + mark profile inactive
//   - reactivate_user  : lift the ban + mark profile active
//   - delete_user      : permanently remove the account + profile (guarded)
//
// v2 CHANGES:
//   + deactivate_user / reactivate_user (the old UI toggle only flipped the
//     profiles.status label — the auth account could still log in)
//   + delete_user: refuses self-deletion; also removes the profiles row
//   + deactivate/delete: refuse to act on your own account; company admins
//     cannot act on sephs_admin accounts or users outside their company
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ── 1. Verify the caller is authenticated ──────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonError("Missing authorization header", 401);
    }
    const callerToken = authHeader.replace("Bearer ", "");

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    });

    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser(callerToken);
    if (callerErr || !caller) {
      return jsonError("Invalid token: " + (callerErr?.message ?? "no user"), 401);
    }

    // ── 2. Look up the caller's profile (role + company) ───────────────────
    const { data: callerProfile, error: profErr } = await callerClient
      .from("profiles")
      .select("id, role, company_id")
      .eq("id", caller.id)
      .single();

    if (profErr || !callerProfile) {
      return jsonError("Could not load caller profile: " + (profErr?.message ?? "not found"), 403);
    }

    const isSephs = callerProfile.role === "sephs_admin";
    const isAdmin = callerProfile.role === "admin";

    if (!isSephs && !isAdmin) {
      return jsonError("Forbidden: admin role required (got: " + callerProfile.role + ")", 403);
    }

    // ── 3. Parse the request body ──────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { action, email, password, full_name, role, company_id, user_id } = body;

    if (!action) return jsonError("Missing 'action' field", 400);

    // ── 4. Admin client (service-role) ──────────────────────────────────────
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Shared guard for actions that target an existing user (deactivate /
    // reactivate / delete). Verifies: target exists, caller isn't targeting
    // themselves, and company admins stay inside their own company and
    // cannot touch sephs_admin accounts.
    async function guardTarget(uid: string, actionName: string) {
      if (!uid) return { err: jsonError(actionName + " requires: user_id", 400) };
      if (uid === caller.id) {
        return { err: jsonError("You cannot " + actionName.replace("_user", "") + " your own account", 403) };
      }
      const { data: target } = await adminClient
        .from("profiles")
        .select("id, company_id, role, full_name, email, status")
        .eq("id", uid)
        .single();
      if (!target) return { err: jsonError("Target user not found", 404) };
      if (!isSephs) {
        if (target.company_id !== callerProfile.company_id) {
          return { err: jsonError("Cannot manage users outside your company", 403) };
        }
        if (target.role === "sephs_admin") {
          return { err: jsonError("Only sephs_admin can manage sephs_admin accounts", 403) };
        }
      }
      return { target };
    }

    // ── 5. Dispatch ─────────────────────────────────────────────────────────
    switch (action) {
      case "create_user": {
        if (!email || !password || !full_name || !role) {
          return jsonError("create_user requires: email, password, full_name, role", 400);
        }

        const targetCompanyId = isSephs ? (company_id || null) : callerProfile.company_id;

        if (!isSephs && role === "sephs_admin") {
          return jsonError("Only sephs_admin can create sephs_admin users", 403);
        }

        const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name,
            role,
            company_id: targetCompanyId,
            must_change_password: true,
          },
        });

        if (createErr) return jsonError("createUser failed: " + createErr.message, 400);
        if (!created?.user) return jsonError("createUser returned no user", 500);

        const { error: upsertErr } = await adminClient
          .from("profiles")
          .upsert({
            id: created.user.id,
            email,
            full_name,
            role,
            company_id: targetCompanyId,
            must_change_password: true,
            status: "active",
            updated_at: new Date().toISOString(),
          });

        if (upsertErr) {
          console.warn("Profile upsert warning:", upsertErr.message);
        }

        return jsonOk({
          user_id: created.user.id,
          email,
          message: "User created. Tell them their credentials directly.",
        });
      }

      case "invite_user": {
        if (!email || !full_name || !role) {
          return jsonError("invite_user requires: email, full_name, role", 400);
        }

        const targetCompanyId = isSephs ? (company_id || null) : callerProfile.company_id;

        if (!isSephs && role === "sephs_admin") {
          return jsonError("Only sephs_admin can invite sephs_admin users", 403);
        }

        const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
          data: {
            full_name,
            role,
            company_id: targetCompanyId,
            must_change_password: false,
          },
        });

        if (inviteErr) return jsonError("inviteUser failed: " + inviteErr.message, 400);

        if (invited?.user) {
          await adminClient.from("profiles").upsert({
            id: invited.user.id,
            email,
            full_name,
            role,
            company_id: targetCompanyId,
            updated_at: new Date().toISOString(),
          });
        }

        return jsonOk({
          user_id: invited?.user?.id ?? null,
          email,
          message: "Invitation email sent.",
        });
      }

      case "reset_password": {
        if (!email) return jsonError("reset_password requires: email", 400);

        const { error: resetErr } = await adminClient.auth.admin.generateLink({
          type: "recovery",
          email,
        });

        if (resetErr) return jsonError("reset_password failed: " + resetErr.message, 400);

        return jsonOk({ email, message: "Password reset email sent." });
      }

      case "deactivate_user": {
        const g = await guardTarget(user_id, "deactivate_user");
        if (g.err) return g.err;

        // Ban the auth account — the user can no longer sign in.
        // (Their current session token, if any, expires naturally within ~1h.)
        const { error: banErr } = await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: "87600h",   // ~10 years = effectively permanent, reversible
        });
        if (banErr) return jsonError("deactivate failed: " + banErr.message, 400);

        await adminClient.from("profiles").update({
          status: "inactive",
          updated_at: new Date().toISOString(),
        }).eq("id", user_id);

        return jsonOk({ user_id, message: "User deactivated — login is now blocked." });
      }

      case "reactivate_user": {
        const g = await guardTarget(user_id, "reactivate_user");
        if (g.err) return g.err;

        const { error: unbanErr } = await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: "none",
        });
        if (unbanErr) return jsonError("reactivate failed: " + unbanErr.message, 400);

        await adminClient.from("profiles").update({
          status: "active",
          updated_at: new Date().toISOString(),
        }).eq("id", user_id);

        return jsonOk({ user_id, message: "User reactivated — login restored." });
      }

      case "delete_user": {
        const g = await guardTarget(user_id, "delete_user");
        if (g.err) return g.err;

        const { error: delErr } = await adminClient.auth.admin.deleteUser(user_id);
        if (delErr) return jsonError("deleteUser failed: " + delErr.message, 400);

        // Remove the profile row too (defensive — may already cascade)
        await adminClient.from("profiles").delete().eq("id", user_id);

        return jsonOk({ user_id, message: "User permanently deleted." });
      }

      default:
        return jsonError("Unknown action: " + action, 400);
    }
  } catch (e) {
    return jsonError("Server error: " + (e?.message ?? String(e)), 500);
  }
});

function jsonOk(payload: unknown) {
  return new Response(JSON.stringify({ ok: true, ...((payload as object) ?? {}) }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
