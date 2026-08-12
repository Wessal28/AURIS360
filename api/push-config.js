// Public browser-push configuration. The VAPID private key never leaves server.

module.exports = async function handler(req, res) {
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  return res.status(200).json({ enabled: !!publicKey, publicKey: publicKey || null });
};
