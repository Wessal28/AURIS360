// AURIS360 AI proxy
// Keeps AI provider keys on the server and requires a logged-in Supabase user.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!userToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase environment is not configured' });
  }

  const aiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!aiKey) {
    return res.status(500).json({ error: 'AI provider key is not configured. Add ANTHROPIC_API_KEY in Vercel.' });
  }

  try {
    const userRes = await fetch(supabaseUrl + '/auth/v1/user', {
      headers: { apikey: supabaseKey, Authorization: 'Bearer ' + userToken }
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const input = req.body || {};
    const messages = Array.isArray(input.messages) ? input.messages : [];
    if (!messages.length) {
      return res.status(400).json({ error: 'messages are required' });
    }

    const payload = {
      model: process.env.ANTHROPIC_MODEL || input.model || 'claude-sonnet-4-20250514',
      max_tokens: Math.min(Number(input.max_tokens || 2000), 4000),
      messages: messages.map(function(m) {
        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, 12000)
        };
      })
    };
    if (input.system) payload.system = String(input.system).slice(0, 4000);

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': aiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    const text = await aiRes.text();
    res.status(aiRes.status).setHeader('Content-Type', 'application/json');
    return res.send(text);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'AI request failed' });
  }
};
