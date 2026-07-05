import express from 'express';

const app = express();
app.use(express.json());

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  API_SECRET,
  PORT = '8080',
} = process.env;

const REQUIRED = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'API_SECRET'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const LEVEL_PREFIX = { info: 'ℹ️', warn: '⚠️', error: '🚨', success: '✅' };

function auth(req, res, next) {
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description ?? 'Telegram API error');
  return data;
}

// POST /send
// Body: { message: string, level?: "info"|"warn"|"error"|"success", title?: string }
app.post('/send', auth, async (req, res) => {
  const { message, level = 'info', title } = req.body ?? {};
  if (!message) return res.status(400).json({ error: '"message" is required' });

  const prefix = LEVEL_PREFIX[level] ?? LEVEL_PREFIX.info;
  const text = title
    ? `${prefix} <b>${title}</b>\n${message}`
    : `${prefix} ${message}`;

  try {
    await sendTelegram(text);
    res.json({ ok: true });
  } catch (err) {
    console.error('Telegram error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /health
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`tg-notify listening on :${PORT}`));
