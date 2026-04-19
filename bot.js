require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const supabase    = require('./db');

if (!process.env.BOT_TOKEN) {
  console.warn('⚠️  BOT_TOKEN not set — Telegram bot disabled.');
  module.exports = { sendReport: async () => {} };
  return;
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const CHAT_ID = process.env.CHAT_ID;

// ── Helper: generate report text ──────────────────────────────
async function buildReportText(dateStr) {
  const date = dateStr || new Date().toISOString().slice(0, 10);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const reportDate = dateStr || yesterday.toISOString().slice(0, 10);

  // Get all campaigns with client name
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name, tracking_code, clients(name)');

  if (!campaigns || campaigns.length === 0) {
    return `📊 *日报 — ${reportDate}*\n\n暂无活跃推广项目。`;
  }

  const campaignIds = campaigns.map(c => c.id);

  // Clicks for report date
  const dayStart = `${reportDate}T00:00:00.000Z`;
  const dayEnd   = `${reportDate}T23:59:59.999Z`;
  const { data: clicks } = await supabase
    .from('click_events')
    .select('campaign_id')
    .in('campaign_id', campaignIds)
    .gte('clicked_at', dayStart)
    .lte('clicked_at', dayEnd);

  const clicksByCampaign = {};
  (clicks || []).forEach(c => {
    clicksByCampaign[c.campaign_id] = (clicksByCampaign[c.campaign_id] || 0) + 1;
  });

  // Daily metrics for report date
  const { data: metrics } = await supabase
    .from('daily_metrics')
    .select('*')
    .in('campaign_id', campaignIds)
    .eq('date', reportDate);

  const metricsByCampaign = {};
  (metrics || []).forEach(m => { metricsByCampaign[m.campaign_id] = m; });

  // Build message
  let totalClicks = 0, totalMessages = 0, totalSubs = 0;
  let lines = [`📊 *广告日报 — ${reportDate}*\n`];

  campaigns.forEach(c => {
    const clicks  = clicksByCampaign[c.id] || 0;
    const m       = metricsByCampaign[c.id] || {};
    const msgs    = m.messages_sent    || 0;
    const subs    = m.new_subscribers  || 0;
    const ctr     = msgs > 0 ? ((clicks / msgs) * 100).toFixed(1) : '—';

    totalClicks   += clicks;
    totalMessages += msgs;
    totalSubs     += subs;

    lines.push(
      `👤 *${c.clients?.name || '未知客户'}* — ${c.name}\n` +
      `   📤 发出消息：${msgs.toLocaleString()} 条\n` +
      `   👆 链接点击：${clicks.toLocaleString()} 次\n` +
      `   👥 新增订阅：${subs.toLocaleString()} 人\n` +
      `   📈 点击率：${ctr}%\n`
    );
  });

  lines.push(
    `─────────────────\n` +
    `📦 *合计 ${campaigns.length} 个项目*\n` +
    `   总发送：${totalMessages.toLocaleString()} 条\n` +
    `   总点击：${totalClicks.toLocaleString()} 次\n` +
    `   总订阅：${totalSubs.toLocaleString()} 人`
  );

  return lines.join('\n');
}

// ── Export for scheduler ──────────────────────────────────────
async function sendReport(dateStr) {
  if (!CHAT_ID) return console.warn('⚠️  CHAT_ID not set — skipping report send.');
  const text = await buildReportText(dateStr);
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
}
// ── Order approved — send credentials to admin ────────────────
async function sendOrderApproved(order, creds) {
  if (!CHAT_ID) return;
  const portalUrl = `${process.env.BASE_URL}/portal`;
  const text =
    `✅ *订单已批准！*\n\n` +
    `👤 客户：${order.customer_name}\n` +
    `📦 套餐：${order.package_name}\n` +
    `💰 金额：RM ${Number(order.final_price).toLocaleString()}\n\n` +
    (creds.alreadyExisted
      ? `🔑 此客户已有账号：\`${creds.username}\`\n`
      : `🔑 *新账号已创建：*\n账号：\`${creds.username}\`\n密码：\`${creds.password}\`\n\n`) +
    `🌐 Portal：${portalUrl}\n\n` +
    `请通过 WhatsApp 将账号密码发送给客户 👆`;
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
}

module.exports = { sendReport, sendOrderAlert, sendClientReports, sendOrderApproved };

// ── New order alert ───────────────────────────────────────────
async function sendOrderAlert(order) {
  if (!CHAT_ID) return;
  const emoji = order.source === 'calculator' ? '🧮' : '🌐';
  const text =
    `🔔 *新订单！*\n\n` +
    `${emoji} 来源：${order.source === 'calculator' ? '免费预测工具' : '官网'}\n` +
    `👤 客户：${order.customer_name}\n` +
    `📱 联系：${order.customer_contact}\n` +
    `📦 套餐：${order.package_name}\n` +
    `💰 金额：RM ${Number(order.final_price).toLocaleString()}` +
    (order.discount_pct ? ` (享 ${order.discount_pct}% 折扣)` : '') + `\n` +
    (order.business_description ? `📝 备注：${order.business_description}\n` : '') +
    `\n✅ 请登入后台审批订单`;
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
}

// ── Client daily reports ──────────────────────────────────────
async function sendClientReports(dateStr) {
  const reportDate = dateStr || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const dayStart = `${reportDate}T00:00:00.000Z`;
  const dayEnd   = `${reportDate}T23:59:59.999Z`;

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, telegram_chat_id')
    .not('telegram_chat_id', 'is', null);

  if (!clients || clients.length === 0) return;

  for (const client of clients) {
    try {
      const { data: campaigns } = await supabase
        .from('campaigns')
        .select('id, name, tracking_code')
        .eq('client_id', client.id);

      if (!campaigns || campaigns.length === 0) continue;
      const ids = campaigns.map(c => c.id);

      const [{ data: clicks }, { data: pixels }, { data: metrics }] = await Promise.all([
        supabase.from('click_events').select('campaign_id').in('campaign_id', ids).gte('clicked_at', dayStart).lte('clicked_at', dayEnd),
        supabase.from('pixel_events').select('campaign_id, event_type').in('campaign_id', ids).gte('created_at', dayStart).lte('created_at', dayEnd),
        supabase.from('daily_metrics').select('*').in('campaign_id', ids).eq('date', reportDate),
      ]);

      const totalClicks  = (clicks || []).length;
      const totalVisits  = (pixels || []).filter(p => p.event_type === 'visit').length;
      const totalLeads   = (pixels || []).filter(p => p.event_type === 'lead').length;
      const totalConv    = (pixels || []).filter(p => p.event_type === 'conversion').length;
      const totalSent    = (metrics || []).reduce((s, m) => s + m.messages_sent, 0);
      const totalSubs    = (metrics || []).reduce((s, m) => s + m.new_subscribers, 0);
      const convRate     = totalClicks > 0 ? ((totalConv / totalClicks) * 100).toFixed(1) : '—';

      const text =
        `📊 *你的广告日报 — ${reportDate}*\n\n` +
        `📤 消息发送：${totalSent.toLocaleString()} 条\n` +
        `👆 链接点击：${totalClicks.toLocaleString()} 次\n` +
        `🌐 访问网站：${totalVisits.toLocaleString()} 次\n` +
        (totalLeads  > 0 ? `📋 表单询问：${totalLeads.toLocaleString()} 次\n` : '') +
        `💰 成功转化：${totalConv.toLocaleString()} 次\n` +
        `👥 新增订阅：${totalSubs.toLocaleString()} 人\n` +
        `📈 点击转化率：${convRate}%\n\n` +
        `_由 CL SDN BHD 提供追踪服务 🚀_`;

      await bot.sendMessage(client.telegram_chat_id, text, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error(`Failed to send report to client ${client.name}:`, e.message);
    }
  }
}

// ── Bot commands ──────────────────────────────────────────────

// /start — show help + chat ID (so clients can share their ID with admin)
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 *CL SDN BHD 广告日报 Bot*\n\n` +
    `📌 你的 Chat ID：\`${msg.chat.id}\`\n` +
    `请将此 ID 发给 CL SDN BHD 以接收每日广告报告\n\n` +
    `可用指令：\n` +
    `📊 /report — 昨日所有项目数据\n` +
    `📅 /report YYYY-MM-DD — 指定日期报告\n` +
    `➕ /addmetrics <代码> <发送数> <新订阅> — 手动录入今日数据\n` +
    `📋 /campaigns — 列出所有追踪链接\n` +
    `\nBase URL: ${process.env.BASE_URL}`,
    { parse_mode: 'Markdown' }
  );
});

// /report [date]
bot.onText(/\/report(?:\s+(\d{4}-\d{2}-\d{2}))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const date   = match[1] || null; // null = yesterday
  try {
    await bot.sendMessage(chatId, '⏳ 正在生成报告...');
    const text = await buildReportText(date);
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `❌ 错误：${e.message}`);
  }
});

// /addmetrics <code> <messages_sent> <new_subscribers>
bot.onText(/\/addmetrics (\S+) (\d+) (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const [, code, msgs, subs] = match;

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name, clients(name)')
    .eq('tracking_code', code)
    .single();

  if (!campaign) {
    return bot.sendMessage(chatId, `❌ 找不到追踪代码 \`${code}\``, { parse_mode: 'Markdown' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from('daily_metrics')
    .upsert({
      campaign_id:     campaign.id,
      date:            today,
      messages_sent:   parseInt(msgs),
      new_subscribers: parseInt(subs),
    }, { onConflict: 'campaign_id,date' });

  if (error) return bot.sendMessage(chatId, `❌ 保存失败：${error.message}`);

  bot.sendMessage(chatId,
    `✅ *数据已记录*\n\n` +
    `客户：${campaign.clients?.name}\n` +
    `项目：${campaign.name}\n` +
    `日期：${today}\n` +
    `发送：${msgs} 条\n` +
    `新增订阅：${subs} 人`,
    { parse_mode: 'Markdown' }
  );
});

// /campaigns — list all tracking links
bot.onText(/\/campaigns/, async (msg) => {
  const chatId = msg.chat.id;
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('name, tracking_code, clients(name)')
    .order('created_at', { ascending: false });

  if (!campaigns || campaigns.length === 0) {
    return bot.sendMessage(chatId, '暂无推广项目。');
  }

  const lines = campaigns.map(c =>
    `• *${c.clients?.name}* — ${c.name}\n  代码：\`${c.tracking_code}\`\n  链接：${process.env.BASE_URL}/go/${c.tracking_code}`
  );
  bot.sendMessage(chatId, lines.join('\n\n'), { parse_mode: 'Markdown' });
});

console.log('🤖 Telegram bot started.');
