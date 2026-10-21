// Vercel serverless function: verifies the Telegram Mini App identity, then asks n8n for that user's data.
// Env vars (Vercel > Project > Settings > Environment Variables):
//   N8N_WEBHOOK_URL    e.g. https://xxxx.ngrok-free.dev/webhook/repvibe/output   (required)
//   TELEGRAM_BOT_TOKEN your bot token, used to verify initData                    (required in production)
//   DEFAULT_USER_ID    dev only: used when the page is opened outside Telegram. Remove in production.
const crypto = require('crypto');

function verifyInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const a = Buffer.from(calc, 'hex'), b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const age = Math.floor(Date.now() / 1000) - Number(params.get('auth_date') || 0);
  if (!(age >= 0 && age < 86400)) return null; // reject initData older than 24h
  try { const u = JSON.parse(params.get('user') || '{}'); return u.id ? String(u.id) : null; } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return res.status(500).json({ error: 'N8N_WEBHOOK_URL is not set on the server.' });

  const initData = req.headers['x-telegram-init-data'];
  const token = process.env.TELEGRAM_BOT_TOKEN;
  let userId = null;
  if (initData) {
    if (!token) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not set on the server.' });
    userId = verifyInitData(String(initData), token);
    if (!userId) return res.status(401).json({ error: 'Telegram session is invalid or expired. Reopen this page from the bot.' });
  } else if (process.env.DEFAULT_USER_ID) {
    userId = String(process.env.DEFAULT_USER_ID);
  } else {
    return res.status(401).json({ error: 'No Telegram identity. Open this page from the RepVibe bot.' });
  }

  let target;
  try { target = new URL(url); target.searchParams.set('user_id', userId); }
  catch (e) { return res.status(500).json({ error: 'N8N_WEBHOOK_URL is not a valid URL.' }); }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(target, { method: 'GET', signal: ctrl.signal, headers: { 'ngrok-skip-browser-warning': 'true', Accept: 'application/json' } });
    const text = await r.text();
    let json;
    try { json = text ? JSON.parse(text) : { splits: [] }; }
    catch (e) { return res.status(502).json({ error: 'n8n did not return JSON. Is the workflow active and the URL a /webhook/ one (not /webhook-test/)?' }); }
    return res.status(r.ok ? 200 : 502).json(r.ok ? json : { error: `n8n answered ${r.status}.` });
  } catch (e) {
    return res.status(502).json({ error: e && e.name === 'AbortError' ? 'n8n took too long to answer.' : 'Could not reach n8n. Is it running and is the tunnel up?' });
  } finally { clearTimeout(timer); }
};
