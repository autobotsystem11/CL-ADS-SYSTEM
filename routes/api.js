const express = require('express');
const router = express.Router();
const supabase = require('../db');
const { nanoid } = require('nanoid');
const { createClientCredentials } = require('./auth');

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

// POST /api/clients  { name, contact, telegram_chat_id }
router.post('/clients', async (req, res) => {
  const { name, contact, telegram_chat_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabase
    .from('clients')
    .insert({ name, contact, telegram_chat_id: telegram_chat_id || null })
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

// ── Pixel tracking ────────────────────────────────────────────
const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
function sendGif(res) {
  res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(PIXEL_GIF);
}

// GET /api/pixel?ref=TRACKING_CODE&event=visit|lead|conversion
router.get('/pixel', async (req, res) => {
  const { ref, event } = req.query;
  if (ref && event) {
    const { data: campaign } = await supabase
      .from('campaigns').select('id').eq('tracking_code', ref).single();
    if (campaign) {
      supabase.from('pixel_events').insert({
        campaign_id: campaign.id,
        event_type:  event,
        ip:          req.headers['x-forwarded-for'] || req.ip || null,
        user_agent:  req.headers['user-agent'] || null,
        referer:     req.headers['referer'] || null,
      }).then(() => {}).catch(() => {});
    }
  }
  sendGif(res);
});

// ── Dashboard aggregates ──────────────────────────────────────

// GET /api/dashboard — summary for all clients + campaigns (last 7 days)
router.get('/dashboard', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString();

  const [{ data: clients }, { data: campaigns }, { data: clicks }, { data: metrics }, { data: pixels }] =
    await Promise.all([
      supabase.from('clients').select('*'),
      supabase.from('campaigns').select('*, clients(name)'),
      supabase.from('click_events').select('campaign_id, clicked_at').gte('clicked_at', sinceISO),
      supabase.from('daily_metrics').select('*').gte('date', since.toISOString().slice(0, 10)),
      supabase.from('pixel_events').select('campaign_id, event_type').gte('created_at', sinceISO),
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

  // Aggregate pixel events per campaign
  const pixelByCampaign = {};
  (pixels || []).forEach(p => {
    if (!pixelByCampaign[p.campaign_id]) pixelByCampaign[p.campaign_id] = { visit: 0, lead: 0, conversion: 0 };
    pixelByCampaign[p.campaign_id][p.event_type] = (pixelByCampaign[p.campaign_id][p.event_type] || 0) + 1;
  });

  // Build enriched campaign list
  const enriched = (campaigns || []).map(c => ({
    ...c,
    clicks:          clicksByCampaign[c.id] || 0,
    messages_sent:   metricsByCampaign[c.id]?.messages_sent   || 0,
    new_subscribers: metricsByCampaign[c.id]?.new_subscribers || 0,
    tracking_url:    `${process.env.BASE_URL}/go/${c.tracking_code}`,
    visits:          pixelByCampaign[c.id]?.visit      || 0,
    leads:           pixelByCampaign[c.id]?.lead       || 0,
    conversions:     pixelByCampaign[c.id]?.conversion || 0,
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

  const { data: pixelEvents } = campaignIds.length
    ? await supabase
        .from('pixel_events')
        .select('event_type, created_at')
        .in('campaign_id', campaignIds)
        .gte('created_at', since.toISOString())
    : { data: [] };

  // Build daily click time series (last 30 days)
  const clicksByDay = {};
  (clicks || []).forEach(c => {
    const day = c.clicked_at.slice(0, 10);
    clicksByDay[day] = (clicksByDay[day] || 0) + 1;
  });

  // Pixel event totals
  const pixelTotals = { visit: 0, lead: 0, conversion: 0 };
  (pixelEvents || []).forEach(p => { pixelTotals[p.event_type] = (pixelTotals[p.event_type] || 0) + 1; });

  // Total aggregates
  const totals = {
    clicks:          (clicks  || []).length,
    messages_sent:   (metrics || []).reduce((s, m) => s + m.messages_sent,   0),
    new_subscribers: (metrics || []).reduce((s, m) => s + m.new_subscribers, 0),
    visits:          pixelTotals.visit,
    leads:           pixelTotals.lead,
    conversions:     pixelTotals.conversion,
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

// ── Orders ────────────────────────────────────────────────────

// POST /api/orders
router.post('/orders', async (req, res) => {
  const { customer_name, customer_contact, package_name, package_price, final_price, discount_pct, business_description, source } = req.body;
  if (!customer_name || !customer_contact || !package_name)
    return res.status(400).json({ error: 'customer_name, customer_contact, package_name required' });
  const { data, error } = await supabase
    .from('orders')
    .insert({ customer_name, customer_contact, package_name, package_price, final_price, discount_pct: discount_pct || 0, business_description, source: source || 'website' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Notify via Telegram bot
  try {
    const bot = require('../bot');
    if (bot.sendOrderAlert) bot.sendOrderAlert(data);
  } catch (_) {}

  res.status(201).json(data);
});

// GET /api/orders
router.get('/orders', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/orders/:id  { status: 'approved'|'rejected' }
router.patch('/orders/:id', async (req, res) => {
  const { status } = req.body;
  const { data: order, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // On approval: find or create client account, then generate login credentials
  if (status === 'approved') {
    try {
      // Try to find a matching client by name
      const { data: clients } = await supabase
        .from('clients')
        .select('id, name')
        .ilike('name', `%${order.customer_name}%`)
        .limit(1);

      let clientId = clients?.[0]?.id;
      let clientName = clients?.[0]?.name || order.customer_name;

      // If no matching client exists, create one
      if (!clientId) {
        const { data: newClient } = await supabase
          .from('clients')
          .insert({ name: order.customer_name, contact: order.customer_contact })
          .select()
          .single();
        clientId  = newClient?.id;
        clientName = newClient?.name || order.customer_name;
      }

      if (clientId) {
        const creds = await createClientCredentials(clientId, clientName);

        // Notify admin + send credentials to client via Telegram
        try {
          const bot = require('../bot');
          if (bot.sendOrderApproved) bot.sendOrderApproved(order, creds);
          if (!creds.alreadyExisted && creds.password && bot.sendClientCredentials) {
            bot.sendClientCredentials(clientId, creds.username, creds.password);
          }
        } catch (_) {}

        return res.json({ ...order, credentials: creds });
      }
    } catch (e) {
      console.error('Credential creation error:', e.message);
    }
  }

  res.json(order);
});

// ── Expenses ──────────────────────────────────────────────────

// GET /api/expenses
router.get('/expenses', async (req, res) => {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .order('date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/expenses
router.post('/expenses', async (req, res) => {
  const { description, amount, date, category } = req.body;
  if (!description || !amount || !date)
    return res.status(400).json({ error: 'description, amount, date required' });
  const { data, error } = await supabase
    .from('expenses')
    .insert({ description, amount, date, category: category || 'general' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/expenses/:id
router.delete('/expenses/:id', async (req, res) => {
  const { error } = await supabase.from('expenses').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/finance — revenue, expenses, profit summary
router.get('/finance', async (req, res) => {
  const [{ data: orders }, { data: expenses }] = await Promise.all([
    supabase.from('orders').select('final_price, status, created_at'),
    supabase.from('expenses').select('amount'),
  ]);
  const revenue    = (orders || []).filter(o => o.status === 'approved').reduce((s, o) => s + Number(o.final_price), 0);
  const pending    = (orders || []).filter(o => o.status === 'pending').reduce((s, o) => s + Number(o.final_price), 0);
  const totalExp   = (expenses || []).reduce((s, e) => s + Number(e.amount), 0);
  const profit     = revenue - totalExp;
  res.json({ revenue, pending, expenses: totalExp, profit, orderCount: (orders || []).length });
});

module.exports = router;
