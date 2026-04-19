document.addEventListener('DOMContentLoaded', async () => {
  const params   = new URLSearchParams(location.search);
  const clientId = params.get('id');

  if (!clientId) return showError();

  const data = await fetch(`/api/client-report/${clientId}`)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  if (!data) return showError();

  document.getElementById('loading').classList.add('hidden');
  document.getElementById('report-content').classList.remove('hidden');
  document.title = `${data.client.name} — 广告数据报告`;

  // Header
  document.getElementById('r-client-name').textContent = data.client.name;
  document.getElementById('r-date-range').textContent  = `过去 30 天数据 · 生成于 ${new Date().toLocaleDateString('zh-CN')}`;

  // Summary stats
  const stats = [
    { label: '总点击次数', value: data.totals.clicks.toLocaleString(),          color: 'stat-orange', sub: '追踪链接点击' },
    { label: '总发送消息', value: data.totals.messages_sent.toLocaleString(),   color: 'stat-blue',   sub: '条推广消息' },
    { label: '新增订阅',   value: data.totals.new_subscribers.toLocaleString(), color: 'stat-green',  sub: '新用户' },
    { label: '活跃项目',   value: data.campaigns.length.toString(),             color: 'stat-purple', sub: '个推广项目' },
  ];
  document.getElementById('r-stats').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value ${s.color}">${s.value}</div>
      <div class="stat-sub">${s.sub}</div>
    </div>
  `).join('');

  // Click chart (last 30 days)
  const labels = [], values = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(key.slice(5));
    values.push(data.clicksByDay[key] || 0);
  }
  new Chart(document.getElementById('r-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '点击次数',
        data: values,
        backgroundColor: 'rgba(249,115,22,0.5)',
        borderColor: '#f97316',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', maxTicksLimit: 10 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', precision: 0 } },
      },
    },
  });

  // Campaigns breakdown
  const platformLabel = { telegram: '🤖 Telegram', facebook: '📘 Facebook', instagram: '📸 Instagram', other: '🌐 其他' };
  document.getElementById('r-campaigns').innerHTML = data.campaigns.map(c => `
    <div class="campaign-card">
      <h3>${esc(c.name)}</h3>
      <span style="font-size:12px;color:var(--muted)">${platformLabel[c.platform] || c.platform}</span>
      <div class="campaign-metrics">
        <div class="c-metric">
          <div class="val stat-orange" id="clicks-${c.id}">—</div>
          <div class="lbl">点击次数</div>
        </div>
        <div class="c-metric">
          <div class="val stat-blue" id="msgs-${c.id}">—</div>
          <div class="lbl">发出消息</div>
        </div>
        <div class="c-metric">
          <div class="val stat-green" id="subs-${c.id}">—</div>
          <div class="lbl">新增订阅</div>
        </div>
      </div>
    </div>
  `).join('') || '<p class="text-muted">暂无推广项目</p>';

  // Fetch per-campaign click counts
  await Promise.all(data.campaigns.map(async c => {
    const byDay = await fetch(`/api/clicks-by-day/${c.id}?days=30`).then(r => r.json()).catch(() => ({}));
    const total = Object.values(byDay).reduce((a, b) => a + b, 0);
    const el = document.getElementById(`clicks-${c.id}`);
    if (el) el.textContent = total.toLocaleString();
  }));

  // Fill msgs & subs from totals (per campaign from API response is aggregated already)
  // We'll just show dashes since per-campaign metrics aren't in client-report — fetch them
  const metricsRes = await fetch(`/api/dashboard?days=30`).then(r => r.json()).catch(() => null);
  if (metricsRes) {
    metricsRes.campaigns
      .filter(c => c.client_id === clientId)
      .forEach(c => {
        const msgsEl = document.getElementById(`msgs-${c.id}`);
        const subsEl = document.getElementById(`subs-${c.id}`);
        if (msgsEl) msgsEl.textContent = c.messages_sent.toLocaleString();
        if (subsEl) subsEl.textContent = c.new_subscribers.toLocaleString();
      });
  }
});

function showError() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error-state').classList.remove('hidden');
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
