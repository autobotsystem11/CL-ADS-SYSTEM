const express = require('express');
const router = express.Router();
const supabase = require('../db');

// GET /go/:code — log click then redirect
router.get('/:code', async (req, res) => {
  const { code } = req.params;

  // Find campaign by tracking code
  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('id, target_url')
    .eq('tracking_code', code)
    .single();

  if (error || !campaign) {
    return res.status(404).send('Link not found.');
  }

  // Log the click (fire-and-forget, don't block the redirect)
  supabase.from('click_events').insert({
    campaign_id: campaign.id,
    user_agent: req.headers['user-agent'] || null,
    referer:    req.headers['referer'] || null,
  }).then(() => {}).catch(() => {});

  // Redirect immediately
  res.redirect(302, campaign.target_url);
});

module.exports = router;
