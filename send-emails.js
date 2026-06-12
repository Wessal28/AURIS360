// AURIS360 Email Worker - Vercel Serverless Function
// CommonJS format - works without extra config

module.exports = async function handler(req, res) {
  const cronHeader = req.headers['x-vercel-cron'];
  const authHeader = req.headers['authorization'];
  if (!cronHeader && authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const results = await processEmailQueue();
    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

async function processEmailQueue() {
  const SB = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND = process.env.RESEND_API_KEY;
  const headers = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

  const r = await fetch(SB + '/rest/v1/notification_queue?status=eq.pending&order=created_at.asc&limit=50', { headers });
  const notifications = await r.json();
  if (!Array.isArray(notifications) || !notifications.length) {
    return { sent: 0, failed: 0, message: 'No pending notifications' };
  }

  let sent = 0, failed = 0;
  for (const n of notifications) {
    try {
      const sr = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'AURIS360 by SEPHS Consulting <onboarding@resend.dev>',
          to: [n.to_email],
          subject: n.subject,
          html: n.body_html
        })
      });
      if (sr.ok) {
        // Capture Resend's email id so the /api/resend-webhook can match
        // bounce/delivery events back to this queue row.
        let resendId = null;
        try { const sd = await sr.json(); resendId = sd && sd.id; } catch (_) {}
        await fetch(SB + '/rest/v1/notification_queue?id=eq.' + n.id, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), resend_id: resendId })
        });
        sent++;
      } else {
        const e = await sr.json();
        throw new Error(e.message || 'Resend error ' + sr.status);
      }
    } catch (err) {
      await fetch(SB + '/rest/v1/notification_queue?id=eq.' + n.id, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'failed', error_msg: err.message, retry_count: (n.retry_count || 0) + 1 })
      });
      failed++;
    }
  }
  return { sent, failed, total: notifications.length };
}
