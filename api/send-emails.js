// AURIS360 Email Worker - Vercel Serverless Function
// Sends queued notifications with SMTP when configured, otherwise falls back to Resend.

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
  const headers = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

  const r = await fetch(SB + '/rest/v1/notification_queue?status=eq.pending&order=created_at.asc&limit=50', { headers });
  const notifications = await r.json();
  if (!Array.isArray(notifications) || !notifications.length) {
    return { sent: 0, failed: 0, message: 'No pending notifications' };
  }

  let sent = 0, failed = 0;
  for (const n of notifications) {
    try {
      if (!isDeliverableEmail(n.to_email)) {
        await fetch(SB + '/rest/v1/notification_queue?id=eq.' + n.id, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            status: 'skipped',
            error_msg: 'No real email address for this user. Use in-app, WhatsApp, or SMS notification.',
            sent_at: new Date().toISOString()
          })
        });
        continue;
      }
      const settingsRes = await fetch(SB + '/rest/v1/notification_settings?company_id=eq.' + n.company_id + '&limit=1', { headers });
      const settingsRows = await settingsRes.json();
      const settings = Array.isArray(settingsRows) && settingsRows[0] ? settingsRows[0] : {};
      if (settings.email_enabled === false) {
        await fetch(SB + '/rest/v1/notification_queue?id=eq.' + n.id, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: 'skipped', error_msg: 'Email notifications disabled for company' })
        });
        continue;
      }
      const sendResult = await sendNotificationEmail(n);
      if (sendResult.ok) {
        await fetch(SB + '/rest/v1/notification_queue?id=eq.' + n.id, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), resend_id: sendResult.providerId || null })
        });
        sent++;
      } else {
        throw new Error(sendResult.error || 'Email provider error');
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

function isDeliverableEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  return !value.endsWith('.local');
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendNotificationEmail(n) {
  if (smtpConfigured()) return sendWithSmtp(n);
  if (process.env.RESEND_API_KEY) return sendWithResend(n);
  return {
    ok: false,
    error: 'Email sender is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM in Vercel, or add RESEND_API_KEY.'
  };
}

async function sendWithSmtp(n) {
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const fromAddress = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const info = await transporter.sendMail({
    from: fromAddress,
    to: n.to_name ? '"' + String(n.to_name).replace(/"/g, '') + '" <' + n.to_email + '>' : n.to_email,
    subject: n.subject,
    html: n.body_html
  });

  return { ok: true, providerId: info && info.messageId ? info.messageId : null };
}

async function sendWithResend(n) {
  const fromAddress = process.env.EMAIL_FROM || 'AURIS360 by SEPHS Consulting <onboarding@resend.dev>';
  const sr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
    body: JSON.stringify({
      from: fromAddress,
      to: [n.to_email],
      subject: n.subject,
      html: n.body_html
    })
  });
  if (!sr.ok) {
    let msg = 'Resend error ' + sr.status;
    try {
      const e = await sr.json();
      msg = e.message || msg;
    } catch (_) {}
    return { ok: false, error: msg };
  }
  let resendId = null;
  try { const sd = await sr.json(); resendId = sd && sd.id; } catch (_) {}
  return { ok: true, providerId: resendId };
}
