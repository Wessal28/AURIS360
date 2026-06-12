// AURIS360 Resend Webhook - Vercel Serverless Function
// Receives delivery events from Resend (bounced, complained, delivered, etc.)
// and records them on the matching notification_queue row so failed emails
// are visible in the Email Notifications settings page.
//
// SETUP (one-time):
//   1. Deploy this file as /api/resend-webhook.js (commit to GitHub as usual)
//   2. Resend Dashboard -> Webhooks -> Add Endpoint:
//        URL: https://app.auris360.com/api/resend-webhook
//        Events: email.bounced, email.complained, email.delivered, email.delivery_delayed
//   3. Copy the webhook signing secret (starts with "whsec_") and add it in
//      Vercel -> Settings -> Environment Variables as RESEND_WEBHOOK_SECRET,
//      then redeploy once.

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const SECRET = process.env.RESEND_WEBHOOK_SECRET;
  if (!SECRET) return res.status(500).json({ error: 'RESEND_WEBHOOK_SECRET not configured' });

  // ── Read the raw body (signature is computed over the exact bytes) ──────
  const rawBody = await readRawBody(req);

  // ── Verify the Svix signature Resend signs webhooks with ────────────────
  const svixId = req.headers['svix-id'];
  const svixTimestamp = req.headers['svix-timestamp'];
  const svixSignature = req.headers['svix-signature'];
  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(401).json({ error: 'Missing signature headers' });
  }
  try {
    const secretBytes = Buffer.from(SECRET.replace('whsec_', ''), 'base64');
    const signedContent = svixId + '.' + svixTimestamp + '.' + rawBody;
    const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
    const provided = String(svixSignature).split(' ').map(s => s.split(',')[1]).filter(Boolean);
    const valid = provided.some(sig => {
      try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
      catch (_) { return false; }
    });
    if (!valid) return res.status(401).json({ error: 'Invalid signature' });
  } catch (e) {
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  // ── Process the event ────────────────────────────────────────────────────
  let event;
  try { event = JSON.parse(rawBody); } catch (_) { return res.status(400).json({ error: 'Bad JSON' }); }

  const type = event.type || '';
  const emailId = event.data && event.data.email_id;
  if (!emailId) return res.status(200).json({ ok: true, skipped: 'no email_id' });

  // Map Resend events to a queue status + message
  let patch = null;
  if (type === 'email.bounced') {
    const reason = (event.data.bounce && (event.data.bounce.message || event.data.bounce.subType)) || 'recipient address rejected';
    patch = { status: 'bounced', error_msg: 'Bounced: ' + String(reason).substring(0, 200) };
  } else if (type === 'email.complained') {
    patch = { status: 'bounced', error_msg: 'Marked as spam by recipient' };
  } else if (type === 'email.delivery_delayed') {
    patch = { error_msg: 'Delivery delayed - will retry' }; // keep status as-is
  } else if (type === 'email.delivered') {
    patch = { status: 'delivered' };
  } else {
    return res.status(200).json({ ok: true, skipped: type });
  }

  try {
    const SB = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    const r = await fetch(SB + '/rest/v1/notification_queue?resend_id=eq.' + encodeURIComponent(emailId), {
      method: 'PATCH',
      headers: {
        'apikey': KEY, 'Authorization': 'Bearer ' + KEY,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal'
      },
      body: JSON.stringify(patch)
    });
    return res.status(200).json({ ok: true, type, updated: r.ok });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined && req.body !== null) {
      // Vercel may have parsed it already - re-serialize consistently
      if (typeof req.body === 'string') return resolve(req.body);
      try { return resolve(JSON.stringify(req.body)); } catch (_) {}
    }
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
