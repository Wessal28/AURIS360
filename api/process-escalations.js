// AURIS360 scheduled Master Action Plan escalation processor.

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (!process.env.CRON_SECRET || authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!['GET', 'POST'].includes(String(req.method || 'GET').toUpperCase())) {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    validateEnvironment();
    const result = await processEscalations();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: safeError(error) });
  }
};

async function processEscalations() {
  const baseUrl = String(process.env.SUPABASE_URL).replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY;
  const response = await fetch(baseUrl + '/rest/v1/rpc/process_action_notification_escalations', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_limit: 500 })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error('Escalation processor failed: ' + response.status + ' ' + detail.slice(0, 500));
  }
  return { ok: true, result: await response.json() };
}

function validateEnvironment() {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'].filter(name => !process.env[name]);
  if (missing.length) throw new Error('Missing required environment variables: ' + missing.join(', '));
}

function safeError(error) {
  return String(error && error.message ? error.message : error || 'Unknown error').slice(0, 500);
}

module.exports._test = { safeError };
