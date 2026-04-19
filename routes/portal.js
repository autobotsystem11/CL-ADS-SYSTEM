const express  = require('express');
const router   = express.Router();
const supabase = require('../db');

// Middleware: validate session token
async function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, username')
    .eq('session_token', token)
    .single();

  if (!client) return res.status(401).json({ error: 'Invalid session' });
  req.client = client;
  next();
}

// GET /portal/stats?days=30
router.get('/stats', requireAuth, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString();
  const sinceDate = since.toISOString().slice(0, 10);

  const clientId = req.client.id;

  // Get campaigns for this client
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name, platform, tracking_code, created_at')
    .eq('client_id', clientId);

  if (!campaigns || campaigns.length === 0) {
    return res.json({ campaigns: [], totals: {}, dailyClicks: {}, orders: [] });
  }

  const ids = campaigns.map(c => c.id);

  // Fetch all data in parallel
  const [
    { data: clicks },
    { data: pixels },
    { data: metrics },
    { data: orders },
  ] = await Promise.all([
    supabase.from('click_events').select('campaign_id, clicked_at').in('campaign_id', ids).gte('clicked_at', sinceISO),
    supabase.from('pixel_events').select('campaign_id, event_type, created_at').in('campaign_id', ids).gte('created_at', sinceISO),
    supabase.from('daily_metrics').select('*').in('campaign_id', ids).gte('date', sinceDate),
    supabase.from('orders').select('final_price, package_name, status, created_at').eq('source', 'website').gte('created_at', sinceISO),
  ]);

  // Per-campaign aggregates
  const clicksByCamp  = {};
  const pixelsByCamp  = {};
  const metricsByCamp = {};

  (clicks || []).forEach(c => { clicksByCamp[c.campaign_id] = (clicksByCamp[c.campaign_id] || 0) + 1; });

  (pixels || []).forEach(p => {
    if (!pixelsByCamp[p.campaign_id]) pixelsByCamp[p.campaign_id] = { visit: 0, lead: 0, conversion: 0 };
    pixelsByCamp[p.campaign_id][p.event_type] = (pixelsByCamp[p.campaign_id][p.event_type] || 0) + 1;
  });

  (metrics || []).forEach(m => {
    if (!metricsByCamp[m.campaign_id]) metricsByCamp[m.campaign_id] = { messages_sent: 0, new_subscribers: 0 };
    metricsByCamp[m.campaign_id].messages_sent   += m.messages_sent;
    metricsByCamp[m.campaign_id].new_subscribers += m.new_subscribers;
  });

  // Total spend from approved orders for this client (all time for context)
  const { data: allOrders } = await supabase
    .from('orders')
    .select('final_price, status, package_name, created_at, customer_name')
    .eq('customer_contact', req.client.name) // best match we have
    .order('created_at', { ascending: false });

  // Calculate totals
  const totalClicks  = (clicks  || []).length;
  const totalVisits  = (pixels  || []).filter(p => p.event_type === 'visit').length;
  const totalLeads   = (pixels  || []).filter(p => p.event_type === 'lead').length;
  const totalConv    = (pixels  || []).filter(p => p.event_type === 'conversion').length;
  const totalSent    = (metrics || []).reduce((s, m) => s + m.messages_sent,   0);
  const totalSubs    = (metrics || []).reduce((s, m) => s + m.new_subscribers, 0);

  // Spend = sum of approved orders linked to client
  const approvedOrders = await supabase
    .from('orders')
    .select('final_price, package_name, status, created_at')
    .eq('status', 'approved');

  // Since we can't perfectly link orders to client_id (orders don't have client_id),
  // we use the client's own order tracking via customer_name/contact
  // For now, get spend from the client's orders by matching customer_contact to client name
  // Admin can input spend manually too — we expose it here for display
  const totalSpend = 0; // placeholder — will be set from approved order amount

  // Daily clicks series
  const dailyClicks = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dailyClicks[d.toISOString().slice(0, 10)] = 0;
  }
  (clicks || []).forEach(c => {
    const day = c.clicked_at.slice(0, 10);
    if (dailyClicks[day] !== undefined) dailyClicks[day]++;
  });

  // Daily visits series
  const dailyVisits = {};
  Object.keys(dailyClicks).forEach(d => { dailyVisits[d] = 0; });
  (pixels || []).filter(p => p.event_type === 'visit').forEach(p => {
    const day = p.created_at.slice(0, 10);
    if (dailyVisits[day] !== undefined) dailyVisits[day]++;
  });

  // Enrich campaigns
  const enriched = campaigns.map(c => ({
    ...c,
    clicks:          clicksByCamp[c.id]  || 0,
    visits:          pixelsByCamp[c.id]?.visit      || 0,
    leads:           pixelsByCamp[c.id]?.lead       || 0,
    conversions:     pixelsByCamp[c.id]?.conversion || 0,
    messages_sent:   metricsByCamp[c.id]?.messages_sent   || 0,
    new_subscribers: metricsByCamp[c.id]?.new_subscribers || 0,
  }));

  res.json({
    campaigns: enriched,
    totals: {
      clicks:    totalClicks,
      visits:    totalVisits,
      leads:     totalLeads,
      conversions: totalConv,
      messages_sent:   totalSent,
      new_subscribers: totalSubs,
    },
    dailyClicks,
    dailyVisits,
  });
});

module.exports = router;
