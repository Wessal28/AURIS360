// AURIS360 admin password reset for login-only/generated users.
// Requires a logged-in admin and uses the Supabase service role only server-side.

const ADMIN_ROLES = ['sephs_admin', 'admin', 'hse_manager'];

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.send(JSON.stringify(body));
}

function allowCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function fetchJson(url, options) {
  const r = await fetch(url, options);
  const data = await r.json().catch(function() { return null; });
  if (!r.ok) {
    const msg = data && (data.message || data.error || data.msg);
    throw new Error(msg || ('HTTP ' + r.status));
  }
  return data;
}

async function getProfile(supabaseUrl, serviceKey, userId) {
  const rows = await fetchJson(
    supabaseUrl + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId) + '&select=id,email,full_name,role,company_id&limit=1',
    {
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        Accept: 'application/json'
      }
    }
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

module.exports = async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!userToken) return json(res, 401, { error: 'Not authenticated' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(res, 500, { error: 'Supabase environment is not configured' });
  }

  try {
    const input = req.body || {};
    const targetUserId = String(input.user_id || '').trim();
    const password = String(input.password || '').trim();
    if (!targetUserId) return json(res, 400, { error: 'user_id is required' });
    if (password.length < 8) return json(res, 400, { error: 'Temporary password must be at least 8 characters' });

    const user = await fetchJson(supabaseUrl + '/auth/v1/user', {
      headers: { apikey: anonKey, Authorization: 'Bearer ' + userToken }
    });
    const actor = await getProfile(supabaseUrl, serviceKey, user.id);
    if (!actor || ADMIN_ROLES.indexOf(actor.role) === -1) {
      return json(res, 403, { error: 'Admin access required to reset a user password' });
    }
    if (actor.id === targetUserId) {
      return json(res, 403, { error: 'Use Change password for your own account' });
    }

    const target = await getProfile(supabaseUrl, serviceKey, targetUserId);
    if (!target) return json(res, 404, { error: 'User not found' });
    if (actor.role !== 'sephs_admin') {
      if (target.role === 'sephs_admin') return json(res, 403, { error: 'Cannot reset a SEPHS admin account' });
      if (actor.company_id && target.company_id && actor.company_id !== target.company_id) {
        return json(res, 403, { error: 'User is outside your company scope' });
      }
    }

    await fetchJson(supabaseUrl + '/auth/v1/admin/users/' + encodeURIComponent(targetUserId), {
      method: 'PUT',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: password })
    });

    await fetchJson(supabaseUrl + '/rest/v1/profiles?id=eq.' + encodeURIComponent(targetUserId), {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        must_change_password: true,
        updated_at: new Date().toISOString()
      })
    });

    return json(res, 200, {
      ok: true,
      message: 'Temporary password set. The user must change it on next login.'
    });
  } catch (err) {
    return json(res, 500, { error: err.message || 'Password reset failed' });
  }
};
