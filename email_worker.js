// ================================================================
// AURIS360 Email Worker
// Deploy as a Vercel Serverless Function OR run as a cron job
// File: /api/send-emails.js  (place in your Vercel project)
// ================================================================
// 
// Setup:
// 1. Create a free Resend account at resend.com
// 2. Get your API key from resend.com/api-keys
// 3. Add to Vercel environment variables:
//    RESEND_API_KEY = re_xxxxxxxxxxxx
//    SUPABASE_URL   = https://iarfxjhahzbhncsaohbg.supabase.co
//    SUPABASE_SERVICE_KEY = your_service_role_key (from Supabase Settings > API)
// 4. Add to vercel.json (create this file in your repo root):
//    { "crons": [{ "path": "/api/send-emails", "schedule": "*/5 * * * *" }] }
//    This runs every 5 minutes to send pending emails
// ================================================================

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY      = process.env.RESEND_API_KEY;

export default async function handler(req, res) {
  // Security: only allow cron calls or manual triggers with correct header
  const authHeader = req.headers['authorization'];
  const cronHeader = req.headers['x-vercel-cron'];
  
  if (!cronHeader && authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results = await processEmailQueue();
    return res.status(200).json(results);
  } catch (err) {
    console.error('Email worker error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function processEmailQueue() {
  // 1. Fetch pending notifications
  const fetchRes = await fetch(
    SUPABASE_URL + '/rest/v1/notification_queue?status=eq.pending&order=created_at.asc&limit=50',
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      }
    }
  );
  
  const notifications = await fetchRes.json();
  if (!notifications.length) return { sent: 0, failed: 0, message: 'No pending notifications' };

  let sent = 0, failed = 0;

  for (const notif of notifications) {
    try {
      // Get the from_email for this company
      const settingsRes = await fetch(
        SUPABASE_URL + '/rest/v1/notification_settings?company_id=eq.' + notif.company_id,
        { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY } }
      );
      const settings = await settingsRes.json();
      const fromEmail = settings[0]?.from_email || 'AURIS360 <noreply@auris360.app>';
      const fromName  = settings[0]?.from_name  || 'AURIS360 by SEPHS Consulting';

      // 2. Send via Resend
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + RESEND_API_KEY,
        },
        body: JSON.stringify({
          from: fromName + ' <' + fromEmail + '>',
          to:   [notif.to_email],
          subject: notif.subject,
          html:    notif.body_html,
          tags: [
            { name: 'type',       value: notif.type },
            { name: 'company_id', value: notif.company_id },
          ]
        })
      });

      if (sendRes.ok) {
        // 3. Mark as sent
        await fetch(
          SUPABASE_URL + '/rest/v1/notification_queue?id=eq.' + notif.id,
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() })
          }
        );
        sent++;
      } else {
        const errData = await sendRes.json();
        throw new Error(errData.message || 'Resend API error');
      }
    } catch (err) {
      // Mark as failed
      await fetch(
        SUPABASE_URL + '/rest/v1/notification_queue?id=eq.' + notif.id,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            status: 'failed',
            error_msg: err.message,
            retry_count: (notif.retry_count || 0) + 1
          })
        }
      );
      failed++;
      console.error('Failed to send to', notif.to_email, ':', err.message);
    }
  }

  return { sent, failed, total: notifications.length };
}
