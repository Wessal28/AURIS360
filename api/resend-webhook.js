// AURIS360 Resend delivery webhook.
// Configure RESEND_WEBHOOK_SECRET and register /api/resend-webhook in Resend.

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook is not configured' });

  try {
    const rawBody = await readRawBody(req);
    verifySignature(req.headers, rawBody, secret);

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch (_) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const type = String(event.type || '');
    const emailId = event.data && event.data.email_id;
    if (!emailId) return res.status(200).json({ ok: true, skipped: 'no email_id' });

    const patch = eventPatch(type, event.data || {});
    if (!patch) return res.status(200).json({ ok: true, skipped: type || 'unknown event' });

    validateEnvironment();
    const baseUrl = String(process.env.SUPABASE_URL).replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_KEY;
    const response = await fetch(
      baseUrl + '/rest/v1/notification_queue?provider_message_id=eq.' + encodeURIComponent(emailId),
      {
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify(patch)
      }
    );

    if (!response.ok) {
      return res.status(502).json({ error: 'Queue update failed', status: response.status });
    }

    const updated = await response.json();
    return res.status(200).json({ ok: true, type, updated: Array.isArray(updated) ? updated.length : 0 });
  } catch (err) {
    const status = err && err.statusCode ? err.statusCode : 500;
    return res.status(status).json({ error: safeError(err) });
  }
};

// Preserve the exact request bytes required for Svix signature verification.
module.exports.config = { api: { bodyParser: false } };

function validateEnvironment() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('Notification data service is not configured');
  }
}

function eventPatch(type, data) {
  const now = new Date().toISOString();
  if (type === 'email.delivered') {
    return { status: 'delivered', delivered_at: now, error_msg: null };
  }
  if (type === 'email.bounced') {
    const bounce = data.bounce || {};
    const reason = bounce.message || bounce.subType || bounce.type || 'recipient address rejected';
    return { status: 'bounced', bounced_at: now, error_msg: ('Bounced: ' + reason).slice(0, 500) };
  }
  if (type === 'email.complained') {
    return { status: 'bounced', bounced_at: now, error_msg: 'Recipient marked the message as spam' };
  }
  if (type === 'email.delivery_delayed') {
    return { error_msg: 'Provider reports delayed delivery' };
  }
  return null;
}

function verifySignature(headers, rawBody, secret) {
  const messageId = header(headers, 'svix-id');
  const timestamp = header(headers, 'svix-timestamp');
  const signatureHeader = header(headers, 'svix-signature');
  if (!messageId || !timestamp || !signatureHeader) throw httpError(401, 'Missing signature headers');

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    throw httpError(401, 'Webhook timestamp is outside the five-minute tolerance');
  }

  let secretBytes;
  try {
    secretBytes = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  } catch (_) {
    throw httpError(503, 'Webhook signing secret is invalid');
  }

  const signedContent = Buffer.concat([
    Buffer.from(messageId + '.' + timestamp + '.', 'utf8'),
    rawBody
  ]);
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest();
  const provided = String(signatureHeader)
    .split(/\s+/)
    .map(part => part.includes(',') ? part.slice(part.indexOf(',') + 1) : '')
    .filter(Boolean);

  const valid = provided.some(value => {
    try {
      const decoded = Buffer.from(value, 'base64');
      return decoded.length === expected.length && crypto.timingSafeEqual(decoded, expected);
    } catch (_) {
      return false;
    }
  });
  if (!valid) throw httpError(401, 'Invalid signature');
}

function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body, 'utf8'));
  if (req.body && typeof req.body === 'object') {
    return Promise.reject(httpError(400, 'Raw webhook body unavailable; disable request body parsing for this route'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function header(headers, name) {
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeError(error) {
  return String(error && error.message ? error.message : error || 'Unknown error').slice(0, 500);
}

module.exports._test = { eventPatch, verifySignature };
