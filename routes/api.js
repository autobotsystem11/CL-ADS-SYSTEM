const express = require('express');
const router = express.Router();
const supabase = require('../db');
const { nanoid } = require('nanoid');

// ── Clients ──────────────────────────────────────────────────

// GET /api/clients
router.get('/clients', async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/clients  { name, contact }
router.post('/clients', async (req, res) => {
  const { name, contact } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabase
    .from('clients')
    .insert({ name, contact })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/clients/:id
router.delete('/clients/:id', async (req, res) => {
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Campaigns ─────────────────────────────────────────────────

// GET /api/campaigns?client_id=xxx
router.get('/campaigns', async (req, res) => {
  let query = supabase
    .from('campaigns')
    .select(`*, clients(name)`)
    .order('created_at', { ascending: false });
  if (req.query.client_id) query = query.eq('client_id', req.query.client_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/campaigns  { client_id, name, platform, target_url }
router.post('/campaigns', async (req, res) => {
  const { client_id, name, platform, target_url } = req.body;
  if (!client_id || !name || !target_url)
    return res.status(400).json({ error: 'client_id, name, target_url required' });

  const tracking_code = nanoid(7); // e.g. "V1StGXR"
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ client_id, name, platform: platform || 'telegram', tracking_code, target_url })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/campaigns/:id
router.delete('/campaigns/:id', async (req, res) => {
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Daily Metrics ─────────────────────────────────────────────

// POST /api/metrics  { campaign_id, date?, messages_sent, new_subscribers }
router.post('/metrics', async (req, res) => {
  const { campaign_id, date, messages_sent, new_subscribers } = req.body;
  if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });
  const { data, error } = await supabase
    .from('daily_metrics')
    .upsert({
      campaign_id,
      date: date || new Date().toISOString().slice(0, 10),
      messages_sent:   messages_sent   || 0,
      new_subscribers: new_subscribers || 0,
    }, { onConflict: 'campaign_id,date' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── Dashboard aggregates ──────────────────────────────────────

// GET /api/dashboard — summary for all clients + campaigns (last 7 days)
router.get('/dashboard', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString();

  const [{ data: clients }, { data: campaigns }, { data: clicks }, { data: metrics }] =
    await Promise.all([
      supabase.from('clients').select('*'),
      supabase.from('campaigns').select('*, clients(name)'),
      supabase.from('click_events').select('campaign_id, clicked_at').gte('clicked_at', sinceISO),
      supabase.from('daily_metrics').select('*').gte('date', since.toISOString().slice(0, 10)),
    ]);

  // Aggregate clicks per campaign
  const clicksByCampaign = {};
  (clicks || []).forEach(c => {
    clicksByCampaign[c.campaign_id] = (clicksByCampaign[c.campaign_id] || 0) + 1;
  });

  // Aggregate metrics per campaign
  const metricsByCampaign = {};
  (metrics || []).forEach(m => {
    if (!metricsByCampaign[m.campaign_id]) {
      metricsByCampaign[m.campaign_id] = { messages_sent: 0, new_subscribers: 0 };
    }
    metricsByCampaign[m.campaign_id].messages_sent   += m.messages_sent;
    metricsByCampaign[m.campaign_id].new_subscribers += m.new_subscribers;
  });

  // Build enriched campaign list
  const enriched = (campaigns || []).map(c => ({
    ...c,
    clicks:          clicksByCampaign[c.id] || 0,
    messages_sent:   metricsByCampaign[c.id]?.messages_sent   || 0,
    new_subscribers: metricsByCampaign[c.id]?.new_subscribers || 0,
    tracking_url:    `${process.env.BASE_URL}/go/${c.tracking_code}`,
  }));

  res.json({ clients: clients || [], campaigns: enriched });
});

// GET /api/client-report/:clientId — data for one client's report page
router.get('/client-report/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const days = 30;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [{ data: client }, { data: campaigns }] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase.from('campaigns').select('*').eq('client_id', clientId),
  ]);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // For each campaign fetch clicks grouped by day (last 30 days)
  const campaignIds = (campaigns || []).map(c => c.id);
  const { data: clicks } = campaignIds.length
    ? await supabase
        .from('click_events')
        .select('campaign_id, clicked_at')
        .in('campaign_id', campaignIds)
        .gte('clicked_at', since.toISOString())
    : { data: [] };

  const { data: metrics } = campaignIds.length
    ? await supabase
        .from('daily_metrics')
        .select('*')
        .in('campaign_id', campaignIds)
        .gte('date', since.toISOString().slice(0, 10))
    : { data: [] };

  // Build daily click time series (last 30 days)
  const clicksByDay = {};
  (clicks || []).forEach(c => {
    const day = c.clicked_at.slice(0, 10);
    clicksByDay[day] = (clicksByDay[day] || 0) + 1;
  });

  // Total aggregates
  const totals = {
    clicks:          (clicks  || []).length,
    messages_sent:   (metrics || []).reduce((s, m) => s + m.messages_sent,   0),
    new_subscribers: (metrics || []).reduce((s, m) => s + m.new_subscribers, 0),
  };

  res.json({ client, campaigns: campaigns || [], clicksByDay, totals });
});

// GET /api/clicks-by-day/:campaignId — for sparkline charts
router.get('/clicks-by-day/:campaignId', async (req, res) => {
  const days = parseInt(req.query.days) || 14;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data: clicks } = await supabase
    .from('click_events')
    .select('clicked_at')
    .eq('campaign_id', req.params.campaignId)
    .gte('clicked_at', since.toISOString());

  const byDay = {};
  (clicks || []).forEach(c => {
    const day = c.clicked_at.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  });
  res.json(byDay);
});

module.exports = router;
