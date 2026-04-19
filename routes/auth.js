const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const router   = express.Router();
const supabase = require('../db');

// POST /auth/login  { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username and password required' });

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, username, password_hash, session_token')
    .eq('username', username.trim().toLowerCase())
    .single();

  if (!client || !client.password_hash)
    return res.status(401).json({ error: '账号或密码错误' });

  const match = await bcrypt.compare(password, client.password_hash);
  if (!match)
    return res.status(401).json({ error: '账号或密码错误' });

  // Refresh session token on every login
  const token = crypto.randomUUID();
  await supabase.from('clients').update({ session_token: token }).eq('id', client.id);

  res.json({ token, client_id: client.id, name: client.name });
});

// GET /auth/me  — validate token
router.get('/me', async (req, res) => {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'No token' });

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, username, telegram_chat_id')
    .eq('session_token', token)
    .single();

  if (!client) return res.status(401).json({ error: 'Invalid token' });
  res.json(client);
});

// Helper exported for api.js to call on order approval
async function createClientCredentials(clientId, clientName) {
  // Check if already has credentials
  const { data: existing } = await supabase
    .from('clients').select('username').eq('id', clientId).single();
  if (existing?.username) return { username: existing.username, password: null, alreadyExisted: true };

  // Generate username from name (lowercase, no spaces)
  const base = clientName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'client';
  // Ensure unique by appending random 4 digits if needed
  const username = base + Math.floor(1000 + Math.random() * 9000);

  // Generate random 8-char password
  const password = crypto.randomBytes(4).toString('hex'); // 8 hex chars

  const hash  = await bcrypt.hash(password, 10);
  const token = crypto.randomUUID();

  await supabase.from('clients').update({
    username,
    password_hash:  hash,
    session_token:  token,
  }).eq('id', clientId);

  return { username, password, alreadyExisted: false };
}

module.exports = { router, createClientCredentials };
