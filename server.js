require('dotenv').config();
const express = require('express');
const path    = require('path');

const trackRouter = require('./routes/track');
const apiRouter   = require('./routes/api');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────
app.use('/go',  trackRouter);   // tracking redirect links
app.use('/api', apiRouter);     // REST API

// ── Catch-all: serve index.html for /report page ─────────────
app.get('/report', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

app.get('/calculator', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'calculator.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Ad Dashboard running at http://localhost:${PORT}`);
  console.log(`   Admin dashboard : http://localhost:${PORT}`);
  console.log(`   Client report   : http://localhost:${PORT}/report?id=<clientId>`);
  console.log(`   Tracking link   : http://localhost:${PORT}/go/<code>\n`);

  // Start Telegram bot + daily scheduler (local only, not on Vercel serverless)
  if (!process.env.VERCEL) {
    require('./bot');
    require('./scheduler');
  }
});
