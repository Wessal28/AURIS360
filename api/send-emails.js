// ================================================================
// AURIS360 Email Worker - Vercel Serverless Function
// ================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const cronHeader = req.headers['x-vercel-cron'];
  if (!cronHeader && authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const results = await processEmailQueue();
    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function processEmailQueue() {
  const fetchRes = await fetch(
    SUPABASE_URL + '/rest/v1/notification_queue?status=eq.pending&order=created_at.asc&limit=50',
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY } }
  );
  const notifications = await fetchRes.json();
  if (!notifications.length) return { sent: 0, failed: 0, message: 'No pending notifications' };
  let sent = 0, failed = 0;
  for (const notif of notifications) {
    try {
      const settingsRes = await fetch(
        SUPABASE_URL + '/rest/v1/notification_settings?company_id=eq.' + notif.company_id,
        { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY } }
      );
      const settings = await settingsRes.json();
      const fromName = (settings[0] && settings[0].from_name) || 'AURIS360 by SEPHS Consulting';
      const fromEmail = (settings[0] && settings[0].from_email) || 'onboarding@resend.dev';
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND_API_KEY },
        body: JSON.stringify({
          from: fromName + ' <' + fromEmail + '>',
          to: [notif.to_email],
          subject: notif.subject,
          html: notif.body_html
        })
      });
      if (sendRes.ok) {
        await fetch(SUPABASE_URL + '/rest/v1/notification_queue?id=eq.' + notif.id, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() })
        });
        sent++;
      } else {
        const e = await sendRes.json();
        throw new Error(e.message || 'Resend error');
      }
    } catch (err) {
      await fetch(SUPABASE_URL + '/rest/v1/notification_queue?id=eq.' + notif.id, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'failed', error_msg: err.message, retry_count: (notif.retry_count || 0) + 1 })
      });
      failed++;
    }
  }
  return { sent, failed, total: notifications.length };
}
