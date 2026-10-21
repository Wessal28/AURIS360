// Queue generic, privacy-preserving Occupational Health due notices.
module.exports = async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  if (!['GET', 'POST'].includes(String(req.method || 'GET').toUpperCase()))
    return res.status(405).json({ error: 'GET or POST only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
    return res.status(500).json({ error: 'Occupational Health reminder service is not configured' });
  try {
    const base = String(process.env.SUPABASE_URL).replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_KEY;
    const response = await fetch(base + '/rest/v1/rpc/process_occupational_health_reminders', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!response.ok) throw new Error('Reminder processor returned status ' + response.status);
    return res.status(200).json({ ok: true, result: await response.json() });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error).slice(0, 200) });
  }
};
