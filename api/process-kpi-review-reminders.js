// AURIS360 scheduled reminders for monthly KPI review decisions.
// The worker only queues email; the existing email worker delivers it.

const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 500;

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!process.env.CRON_SECRET || authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!['GET', 'POST'].includes(String(req.method || 'GET').toUpperCase())) {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    validateEnvironment();
    return res.status(200).json(await processReviewReminders());
  } catch (error) {
    return res.status(500).json({ error: safeError(error) });
  }
};

async function processReviewReminders(options = {}) {
  const context = supabaseContext(options);
  const now = options.now instanceof Date ? options.now : new Date();
  const limit = Math.max(1, Math.min(Number(options.limit) || DEFAULT_LIMIT, 2000));
  const reviews = await readRows(context,
    '/kpi_monthly_reviews?select=id,company_id,year,month,status,route,title,updated_at'
      + '&status=in.(submitted,verified)&order=updated_at.asc&limit=' + limit);
  let evaluated = 0;
  let queued = 0;
  let skipped = 0;

  for (const review of Array.isArray(reviews) ? reviews : []) {
    const reminder = reminderForReview(review, now);
    if (!reminder) continue;
    evaluated++;
    const assignedId = assignedProfileId(review);
    if (!assignedId || !review.company_id) {
      skipped++;
      continue;
    }
    const profiles = await readRows(context,
      '/profiles?select=id,full_name,email,real_email&company_id=eq.' + encodeURIComponent(review.company_id)
        + '&id=eq.' + encodeURIComponent(assignedId) + '&status=eq.active&limit=1');
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    const email = bestEmail(profile);
    if (!profile || !email) {
      skipped++;
      continue;
    }
    const recordUrl = reviewUrl(review);
    const day = now.toISOString().slice(0, 10);
    const idempotencyKey = 'kpi-review-reminder/' + review.id + '/' + review.status + '/' + day;
    const body = {
      company_id: review.company_id,
      recipient_profile_id: profile.id,
      type: 'kpi_monthly_review_due',
      subject: '[AURIS360] KPI monthly review decision required: ' + (review.title || periodLabel(review)),
      body_html: reminderBody(review, profile, recordUrl, reminder.ageDays),
      to_email: email,
      to_name: profile.full_name || email,
      status: 'pending',
      channel: 'email',
      priority: reminder.ageDays >= 3 ? 'high' : 'normal',
      related_id: review.id,
      related_table: 'kpi_monthly_reviews',
      related_module: 'objectives',
      related_ref: periodLabel(review),
      record_url: recordUrl,
      metadata: {
        review_status: review.status,
        assigned_profile_id: profile.id,
        reminder_age_days: reminder.ageDays,
        relationship: { module: 'objectives', table: 'kpi_monthly_reviews', id: review.id, ref: periodLabel(review), company_id: review.company_id, url: recordUrl }
      },
      idempotency_key: idempotencyKey,
      next_attempt_at: now.toISOString()
    };
    await queueNotification(context, body);
    queued++;
  }

  return { ok: true, reviews_evaluated: evaluated, notifications_queued: queued, skipped: skipped };
}

function reminderForReview(review, now) {
  if (!review || !['submitted', 'verified'].includes(String(review.status || '').toLowerCase())) return null;
  const updated = Date.parse(review.updated_at || review.submitted_at || '');
  if (!Number.isFinite(updated)) return null;
  const age = now.getTime() - updated;
  if (age < REMINDER_AFTER_MS) return null;
  return { ageDays: Math.max(1, Math.floor(age / REMINDER_AFTER_MS)) };
}

function assignedProfileId(review) {
  const route = review && review.route && typeof review.route === 'object' ? review.route : {};
  const id = review && review.status === 'submitted' ? route.reviewer : route.approver;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function bestEmail(profile) {
  const values = [profile && profile.real_email, profile && profile.email];
  return values.map(value => String(value || '').trim().toLowerCase())
    .find(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !value.endsWith('.local')) || null;
}

function periodLabel(review) {
  return 'KPI review ' + String(review && review.year || '') + '-' + String(review && review.month || '').padStart(2, '0');
}

function reviewUrl(review) {
  return 'https://auris360.app/?goto=objectives&review=' + encodeURIComponent(review.id)
    + '&year=' + encodeURIComponent(review.year) + '&month=' + encodeURIComponent(review.month)
    + '&company=' + encodeURIComponent(review.company_id);
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function reminderBody(review, profile, recordUrl, ageDays) {
  const status = String(review.status || '').replace(/_/g, ' ');
  return '<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:20px">'
    + '<div style="max-width:640px;margin:auto;background:#fff;border-radius:12px;overflow:hidden">'
    + '<div style="background:#0b7f61;color:#fff;padding:18px 22px"><strong>AURIS360</strong><br>KPI monthly review reminder</div>'
    + '<div style="padding:22px"><h2 style="margin-top:0">Decision required for ' + escapeHtml(periodLabel(review)) + '</h2>'
    + '<p>Hello ' + escapeHtml(profile.full_name || 'colleague') + ',</p>'
    + '<p>This monthly KPI review has been <strong>' + escapeHtml(status) + '</strong> for ' + ageDays + ' day(s) and is waiting for your decision.</p>'
    + '<p style="text-align:center;margin-top:22px"><a href="' + escapeHtml(recordUrl) + '" style="background:#0b7f61;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none">Open exact KPI review</a></p>'
    + '</div></div></body></html>';
}

async function queueNotification(context, body) {
  const response = await context.fetchImpl(context.baseUrl + '/rest/v1/notification_queue?on_conflict=company_id%2Cidempotency_key', {
    method: 'POST',
    headers: { ...context.headers, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error('Unable to queue KPI review reminder: ' + response.status + ' ' + (await response.text()).slice(0, 300));
}

async function readRows(context, path) {
  const response = await context.fetchImpl(context.baseUrl + '/rest/v1' + path, { headers: context.headers });
  if (!response.ok) throw new Error('Unable to read KPI review reminder data: ' + response.status + ' ' + (await response.text()).slice(0, 300));
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function supabaseContext(options) {
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { baseUrl, fetchImpl: options.fetchImpl || fetch, headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' } };
}

function validateEnvironment() {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'].filter(name => !process.env[name]);
  if (missing.length) throw new Error('Missing required environment variables: ' + missing.join(', '));
}

function safeError(error) {
  return String(error && error.message ? error.message : error || 'Unknown error').slice(0, 500);
}

module.exports._test = { assignedProfileId, bestEmail, periodLabel, reminderForReview, reminderBody, reviewUrl, safeError };
