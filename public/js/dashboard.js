/* ── State ──────────────────────────────────────────────── */
let clients   = [];
let campaigns = [];
let clickChart = null;

/* ── Init ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Set today as default date in metrics form
  document.getElementById('m-date').value = today();
  loadDashboard();
  loadClients();
  loadCampaigns();
  setupForms();
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Tab switching ──────────────────────────────────────── */
function showTab(name) {
  document.querySelectorAll('[id^="tab-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.remove('hidden');
  event.currentTarget.classList.add('active');
  if (name === 'dashboard') loadDashboard();
  if (name === 'clients')   renderClientsTable();
  if (name === 'campaigns') renderCampaignsTable();
}

/* ── Dashboard ──────────────────────────────────────────── */
async function loadDashboard() {
  const days = document.getElementById('days-filter').value;
  const data = await apiFetch(`/api/dashboard?days=${days}`);
  if (!data) return;

  clients   = data.clients;
  campaigns = data.campaigns;

  // Stat cards
  const totalClicks   = campaigns.reduce((s, c) => s + c.clicks, 0);
  const totalMessages = campaigns.reduce((s, c) => s + c.messages_sent, 0);
  const totalSubs     = campaigns.reduce((s, c) => s + c.new_subscribers, 0);
  setText('s-clicks',   totalClicks.toLocaleString());
  setText('s-messages', totalMessages.toLocaleString());
  setText('s-subs',     totalSubs.toLocaleString());
  setText('s-camps',    campaigns.length.toString());

  // Dashboard table
  const tbody = document.getElementById('dashboard-table');
  if (campaigns.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">暂无推广项目数据</div></td></tr>`;
  } else {
    tbody.innerHTML = campaigns.map(c => `
      <tr>
        <td>${esc(c.clients?.name || '—')}</td>
        <td>${esc(c.name)}</td>
        <td><span class="badge ${platformBadge(c.platform)}">${esc(c.platform)}</span></td>
        <td><strong class="text-orange">${c.clicks.toLocaleString()}</strong></td>
        <td>${c.messages_sent.toLocaleString()}</td>
        <td>${c.new_subscribers.toLocaleString()}</td>
        <td>
          <div class="copy-link">
            <code title="${c.tracking_url}">${c.tracking_url}</code>
            <button onclick="copyText('${c.tracking_url}')">复制</button>
          </div>
        </td>
        <td>
          <a href="/report?id=${c.client_id}" target="_blank" class="btn btn-ghost btn-sm">查看</a>
        </td>
      </tr>
    `).join('');
  }

  // Click chart (aggregate all campaigns by day)
  await renderClickChart(days);
}

async function renderClickChart(days) {
  // Build last N days labels
  const labels = [];
  const dataMap = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(key.slice(5)); // MM-DD
    dataMap[key] = 0;
  }

  // Fetch click data for each campaign and aggregate
  await Promise.all(campaigns.map(async c => {
    const byDay = await apiFetch(`/api/clicks-by-day/${c.id}?days=${days}`);
    if (byDay) {
      Object.entries(byDay).forEach(([day, count]) => {
        if (dataMap[day] !== undefined) dataMap[day] += count;
      });
    }
  }));

  const values = Object.values(dataMap);
  const ctx = document.getElementById('click-chart').getContext('2d');
  if (clickChart) clickChart.destroy();
  clickChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '点击次数',
        data: values,
        borderColor: '#f97316',
        backgroundColor: 'rgba(249,115,22,0.08)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: '#f97316',
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b' } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', precision: 0 } },
      },
    },
  });
}

/* ── Clients ────────────────────────────────────────────── */
async function loadClients() {
  clients = await apiFetch('/api/clients') || [];
  renderClientsTable();
  populateClientSelects();
}

function renderClientsTable() {
  const tbody = document.getElementById('clients-table');
  if (!tbody) return;
  if (clients.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">暂无客户，点击右上角新增</div></td></tr>`;
    return;
  }
  tbody.innerHTML = clients.map(c => `
    <tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td class="text-muted">${esc(c.contact || '—')}</td>
      <td class="text-muted font-mono" style="font-size:12px">${new Date(c.created_at).toLocaleDateString('zh-CN')}</td>
      <td>
        <div class="copy-link">
          <code>/report?id=${c.id}</code>
          <button onclick="copyText(location.origin+'/report?id=${c.id}')">复制</button>
        </div>
      </td>
      <td>
        <div style="display:flex;gap:6px">
          <a href="/report?id=${c.id}" target="_blank" class="btn btn-ghost btn-sm">报告</a>
          <button class="btn btn-danger btn-sm" onclick="deleteClient('${c.id}')">删除</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function deleteClient(id) {
  if (!confirm('删除此客户会同时删除其所有推广项目及数据，确定吗？')) return;
  await apiFetch(`/api/clients/${id}`, { method: 'DELETE' });
  toast('已删除', 'success');
  loadClients();
  loadCampaigns();
  loadDashboard();
}

/* ── Campaigns ──────────────────────────────────────────── */
async function loadCampaigns() {
  campaigns = await apiFetch('/api/campaigns') || [];
  renderCampaignsTable();
  populateCampaignSelect();
}

function renderCampaignsTable() {
  const tbody = document.getElementById('campaigns-table');
  if (!tbody) return;
  if (campaigns.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">暂无推广项目</div></td></tr>`;
    return;
  }
  tbody.innerHTML = campaigns.map(c => `
    <tr>
      <td>${esc(c.clients?.name || '—')}</td>
      <td><strong>${esc(c.name)}</strong></td>
      <td><span class="badge ${platformBadge(c.platform)}">${esc(c.platform)}</span></td>
      <td>
        <div class="copy-link">
          <code>${location.origin}/go/${c.tracking_code}</code>
          <button onclick="copyText('${location.origin}/go/${c.tracking_code}')">复制</button>
        </div>
      </td>
      <td class="text-muted" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.target_url)}">${esc(c.target_url)}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteCampaign('${c.id}')">删除</button>
      </td>
    </tr>
  `).join('');
}

async function deleteCampaign(id) {
  if (!confirm('确定删除此推广项目及其所有数据？')) return;
  await apiFetch(`/api/campaigns/${id}`, { method: 'DELETE' });
  toast('已删除', 'success');
  loadCampaigns();
  loadDashboard();
}

/* ── Forms ──────────────────────────────────────────────── */
function setupForms() {
  // Add client
  document.getElementById('client-form').addEventListener('submit', async e => {
    e.preventDefault();
    const res = await apiFetch('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: val('c-name'), contact: val('c-contact') }),
    });
    if (res) {
      toast('客户已添加 ✅', 'success');
      closeModal('modal-add-client');
      e.target.reset();
      await loadClients();
    }
  });

  // Add campaign
  document.getElementById('campaign-form').addEventListener('submit', async e => {
    e.preventDefault();
    const res = await apiFetch('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        client_id:  val('cp-client'),
        name:       val('cp-name'),
        platform:   val('cp-platform'),
        target_url: val('cp-url'),
      }),
    });
    if (res) {
      toast(`追踪链接已生成：/go/${res.tracking_code} ✅`, 'success');
      closeModal('modal-add-campaign');
      e.target.reset();
      await loadCampaigns();
      loadDashboard();
    }
  });

  // Metrics form
  document.getElementById('metrics-form').addEventListener('submit', async e => {
    e.preventDefault();
    const res = await apiFetch('/api/metrics', {
      method: 'POST',
      body: JSON.stringify({
        campaign_id:     val('m-campaign'),
        date:            val('m-date'),
        messages_sent:   parseInt(val('m-messages')),
        new_subscribers: parseInt(val('m-subs')),
      }),
    });
    if (res) {
      const el = document.getElementById('metrics-result');
      el.textContent = `✅ 数据已保存！日期：${res.date}，发送：${res.messages_sent} 条，新增订阅：${res.new_subscribers} 人`;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 5000);
    }
  });
}

function populateClientSelects() {
  const selects = ['cp-client'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">— 选择客户 —</option>` +
      clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    el.value = cur;
  });
}

function populateCampaignSelect() {
  const el = document.getElementById('m-campaign');
  if (!el) return;
  el.innerHTML = `<option value="">— 选择项目 —</option>` +
    campaigns.map(c => `<option value="${c.id}">${esc(c.clients?.name || '')} — ${esc(c.name)} (${c.tracking_code})</option>`).join('');
}

/* ── Helpers ────────────────────────────────────────────── */
async function apiFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  try {
    const res = await fetch(url, { ...opts, headers });
    const data = await res.json();
    if (!res.ok) { toast(data.error || '请求失败', 'error'); return null; }
    return data;
  } catch (e) {
    toast('网络错误：' + e.message, 'error');
    return null;
  }
}

function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function val(id)        { return document.getElementById(id).value; }
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function esc(s)         { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function platformBadge(p) {
  return { telegram: 'badge-blue', facebook: 'badge-purple', instagram: 'badge-orange', other: 'badge-green' }[p] || 'badge-green';
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('已复制 ✓', 'success'));
}

let toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.add('hidden'); });
});
