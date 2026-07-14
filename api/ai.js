// AURIS360 AI proxy
// Keeps AI provider keys on the server and requires a logged-in Supabase user.

function limitProviderContent(content) {
  if (Array.isArray(content)) {
    return content.map(function(part) {
      if (!part || typeof part !== 'object') return { type: 'text', text: String(part || '').slice(0, 12000) };
      if (part.type === 'text') {
        return Object.assign({}, part, { text: String(part.text || '').slice(0, 12000) });
      }
      return part;
    });
  }
  return String(content || '').slice(0, 12000);
}

function normaliseMessages(messages) {
  return messages.map(function(m) {
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: limitProviderContent(m.content)
    };
  });
}

function toOpenAIContent(content) {
  if (!Array.isArray(content)) return String(content || '');
  return content.map(function(part) {
    if (!part || typeof part !== 'object') {
      return { type: 'input_text', text: String(part || '').slice(0, 12000) };
    }
    if (part.type === 'text') {
      return { type: 'input_text', text: String(part.text || '').slice(0, 12000) };
    }
    if (part.type === 'image' && part.source && part.source.data) {
      return {
        type: 'input_image',
        image_url: 'data:' + (part.source.media_type || 'image/png') + ';base64,' + part.source.data
      };
    }
    return { type: 'input_text', text: JSON.stringify(part).slice(0, 12000) };
  });
}

function getOutputText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string') return data.output_text;
  if (Array.isArray(data.output)) {
    return data.output.map(function(item) {
      if (!Array.isArray(item.content)) return '';
      return item.content.map(function(part) {
        return part.text || '';
      }).join('');
    }).join('');
  }
  if (Array.isArray(data.choices)) {
    return data.choices.map(function(choice) {
      return choice.message && choice.message.content ? choice.message.content : '';
    }).join('');
  }
  if (Array.isArray(data.content)) {
    return data.content.map(function(part) {
      return part.text || '';
    }).join('');
  }
  return '';
}

const AI_ALLOWED_ROLES = ['sephs_admin', 'admin', 'hse_manager', 'hse_officer'];

async function getUserRole(supabaseUrl, supabaseKey, user, userToken) {
  const metaRole = user && user.user_metadata && user.user_metadata.role;
  const appMetaRole = user && user.app_metadata && user.app_metadata.role;
  if (AI_ALLOWED_ROLES.indexOf(metaRole) !== -1) return metaRole;
  if (AI_ALLOWED_ROLES.indexOf(appMetaRole) !== -1) return appMetaRole;
  if (!user || !user.id) return '';

  const profileRes = await fetch(
    supabaseUrl + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=role&limit=1',
    {
      headers: {
        apikey: supabaseKey,
        Authorization: 'Bearer ' + (process.env.SUPABASE_SERVICE_KEY || userToken),
        Accept: 'application/json'
      }
    }
  );
  if (!profileRes.ok) return metaRole || appMetaRole || '';
  const rows = await profileRes.json().catch(function() { return []; });
  return rows && rows[0] && rows[0].role ? rows[0].role : (metaRole || appMetaRole || '');
}

async function callOpenAI(input, messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || process.env.AI_MODEL;
  if (!apiKey) {
    return {
      status: 500,
      body: {
        error: 'OpenAI is selected but OPENAI_API_KEY is not configured in Vercel.'
      }
    };
  }
  if (!model) {
    return {
      status: 500,
      body: {
        error: 'OpenAI is selected but OPENAI_MODEL is not configured in Vercel.'
      }
    };
  }

  const inputItems = [];
  if (input.system) {
    inputItems.push({
      role: 'system',
      content: String(input.system).slice(0, 4000)
    });
  }
  messages.forEach(function(m) {
    inputItems.push({
      role: m.role,
      content: toOpenAIContent(m.content)
    });
  });

  const aiRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      max_output_tokens: Math.min(Number(input.max_tokens || 2000), 4000),
      input: inputItems
    })
  });

  const data = await aiRes.json().catch(function() { return null; });
  if (!aiRes.ok) {
    return {
      status: aiRes.status,
      body: data || { error: 'OpenAI request failed' }
    };
  }

  return {
    status: aiRes.status,
    body: {
      provider: 'openai',
      model: model,
      content: [{ type: 'text', text: getOutputText(data) }],
      raw: data
    }
  };
}

async function callAnthropic(input, messages) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || process.env.AI_MODEL || input.model;
  if (!apiKey) {
    return {
      status: 500,
      body: {
        error: 'Claude is selected but ANTHROPIC_API_KEY is not configured in Vercel.'
      }
    };
  }
  if (!model) {
    return {
      status: 500,
      body: {
        error: 'Claude is selected but ANTHROPIC_MODEL is not configured in Vercel.'
      }
    };
  }

  const payload = {
    model: model,
    max_tokens: Math.min(Number(input.max_tokens || 2000), 4000),
    messages: messages
  };
  if (input.system) payload.system = String(input.system).slice(0, 4000);

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  const data = await aiRes.json().catch(function() { return null; });
  if (!aiRes.ok) {
    return {
      status: aiRes.status,
      body: data || { error: 'Claude request failed' }
    };
  }

  return {
    status: aiRes.status,
    body: Object.assign({ provider: 'anthropic', model: model }, data)
  };
}

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

  try {
    const userRes = await fetch(supabaseUrl + '/auth/v1/user', {
      headers: { apikey: supabaseKey, Authorization: 'Bearer ' + userToken }
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Invalid session' });
    }
    const user = await userRes.json();
    const role = await getUserRole(supabaseUrl, supabaseKey, user, userToken);
    if (AI_ALLOWED_ROLES.indexOf(role) === -1) {
      return res.status(403).json({
        error: 'AURIS AI is restricted to SEPHS admin, company admin, HSE manager and HSE officer roles.'
      });
    }

    const input = req.body || {};
    const messages = normaliseMessages(Array.isArray(input.messages) ? input.messages : []);
    if (!messages.length) {
      return res.status(400).json({ error: 'messages are required' });
    }

    const configuredProvider = String(process.env.AI_PROVIDER || '').toLowerCase();
    const provider = configuredProvider || 'openai';
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'claude') {
      return res.status(500).json({
        error: 'Invalid AI_PROVIDER. Use openai, anthropic, or claude.'
      });
    }
    const result = provider === 'openai'
      ? await callOpenAI(input, messages)
      : await callAnthropic(input, messages);

    res.status(result.status).setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(result.body));
  } catch (err) {
    return res.status(500).json({ error: err.message || 'AI request failed' });
  }
};
