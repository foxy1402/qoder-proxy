/* global app.js — vanilla JS SPA */
'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  page: 'endpoints',
  config: {},
  models: [],
  chat: { messages: [], model: 'lite', streaming: false },
  logs: { entries: [], filter: '', autoRefresh: false, timer: null, expanded: null },
  sysLogs: { entries: [], autoRefresh: false, timer: null },
};

// ── Utils ────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour12: false });
}
function fmtUptime(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}
function fmtMs(ms) { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`; }

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function mdToHtml(text) {
  let h = escHtml(text);
  // fenced code blocks
  h = h.replace(/```(?:[a-z]*)\n?([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`);
  // inline code
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // line breaks
  h = h.replace(/\n/g, '<br>');
  return h;
}

function syntaxJson(obj) {
  if (obj == null) return '<span class="json-null">null</span>';
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (m) => {
    if (/^"/.test(m)) return /:$/.test(m) ? `<span class="json-key">${m}</span>` : `<span class="json-string">${m}</span>`;
    if (/true|false/.test(m)) return `<span class="json-bool">${m}</span>`;
    if (/null/.test(m)) return `<span class="json-null">${m}</span>`;
    return `<span class="json-number">${m}</span>`;
  });
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
  });
}

// ── Routing ──────────────────────────────────────────────────────────────────
const routes = { endpoints: renderEndpoints, playground: renderPlayground, logs: renderLogs, 'system-logs': renderSystemLogs };

function navigateTo(page) {
  if (!routes[page]) page = 'endpoints';
  // Cleanup previous page timers
  clearInterval(state.logs.timer); state.logs.autoRefresh = false;
  clearInterval(state.sysLogs.timer); state.sysLogs.autoRefresh = false;
  state.page = page;
  window.location.hash = page;
  updateSidebar();
  routes[page]();
}

window.addEventListener('hashchange', () => navigateTo(window.location.hash.slice(1)));

function updateSidebar() {
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.page === state.page));
}

// ── Status polling ────────────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const d = await api('/dashboard/api/status');
    const dot = $('status-indicator'), lbl = $('status-label');
    dot.className = `status-dot status-${d.status === 'ok' ? 'ok' : 'degraded'}`;
    lbl.textContent = d.status === 'ok' ? 'Online' : 'Degraded';
    lbl.style.color = d.status === 'ok' ? '#34d399' : '#f87171';
    $('qodercli-ver').textContent = `qodercli ${d.qodercli}`;
    $('uptime-label').textContent = `Up ${fmtUptime(d.uptime)}`;
    $('mem-label').textContent = `${d.memoryMB} MB`;
    $('sidebar-version').textContent = `v${d.version}`;
  } catch { /* ignore */ }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    // Wire sidebar nav
    document.querySelectorAll('.nav-item').forEach(a => {
      a.addEventListener('click', (e) => { e.preventDefault(); navigateTo(a.dataset.page); });
    });
    // Parallel boot fetches
    const [cfg, mdl] = await Promise.all([
      api('/dashboard/api/config'),
      api('/dashboard/api/models'),
    ]);
    state.config  = cfg;
    state.models  = mdl.models || [];
    if (state.models.length) state.chat.model = state.models[0].id;

    await fetchStatus();
    setInterval(fetchStatus, 15000);

    navigateTo(window.location.hash.slice(1) || 'endpoints');
  } catch (err) {
    $('content').innerHTML = `<div class="empty-state" style="color:#f87171">Boot error: ${escHtml(err.message)}</div>`;
  }
}

// ── Page: Endpoints ───────────────────────────────────────────────────────────
function renderEndpoints() {
  const base = state.config.publicBaseUrl || window.location.origin;
  const v1   = `${base}/v1`;
  const key  = state.config.proxyApiKey;

  const endpoints = [
    { method:'GET',  path:'/v1/models',            desc:'List all available models and aliases.',        curl:`curl ${v1}/models${key ? ` \\\n  -H "Authorization: Bearer ${key}"` : ''}` },
    { method:'POST', path:'/v1/chat/completions',  desc:'OpenAI-compatible chat completions (streaming supported).', curl:`curl ${v1}/chat/completions \\\n  -H "Content-Type: application/json"${key ? ` \\\n  -H "Authorization: Bearer ${key}"` : ''} \\\n  -d '{"model":"lite","messages":[{"role":"user","content":"Hello!"}]}'` },
    { method:'POST', path:'/v1/completions',       desc:'Legacy text completions endpoint.',             curl:`curl ${v1}/completions \\\n  -H "Content-Type: application/json"${key ? ` \\\n  -H "Authorization: Bearer ${key}"` : ''} \\\n  -d '{"model":"lite","prompt":"Once upon a time"}'` },
    { method:'GET',  path:'/health',               desc:'Health check — returns qodercli version and server status.',curl:`curl ${base}/health` },
  ];

  const epCards = endpoints.map((ep, i) => `
    <div class="endpoint-card">
      <div class="ep-header">
        <span class="method-badge method-${ep.method}">${ep.method}</span>
        <span class="ep-path">${escHtml(ep.path)}</span>
      </div>
      <div class="ep-body">
        <p class="ep-desc">${escHtml(ep.desc)}</p>
        <div class="ep-curl" id="curl-${i}">${escHtml(ep.curl)}<button class="copy-curl" onclick="copyText(document.getElementById('curl-${i}').innerText,this)">Copy</button></div>
      </div>
    </div>`).join('');

  const compat = ['OpenAI Python SDK','LangChain','LM Studio','Cursor','Continue.dev','Open WebUI','Aider','Cline','AnythingLLM'];

  const isHttp = base.startsWith('http://');
  const httpsWarning = isHttp ? `
    <div class="card card-sm" style="border-color:rgba(245,158,11,.3);margin-top:12px">
      <p style="color:#fcd34d;font-size:13px">⚠️ <strong>HTTP detected</strong> — If your provider uses HTTPS, make sure to use <code style="font-family:'JetBrains Mono',monospace">https://</code> in your base URL. Using <code>http://</code> with an HTTPS server causes 301 redirects that break POST requests.</p>
    </div>` : '';

  $('content').innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Endpoints</h1><p class="page-sub">Your OpenAI-compatible proxy — drop this URL into any app</p></div></div>

    <div class="hero-card">
      <div class="hero-label">🌐 Base URL (OpenAI-compatible)</div>
      <div class="hero-url" id="hero-url">${escHtml(v1)}</div>
      <div class="hero-actions">
        <button class="copy-btn" id="copy-url-btn" onclick="copyText('${v1}',this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Base URL
        </button>
        <button class="copy-btn-ghost" onclick="copyText('${v1}/chat/completions',this)">Copy Chat Endpoint</button>
      </div>
    </div>
    ${httpsWarning}

    ${key ? `<div class="card card-sm">
      <div class="card-title">🔑 Proxy API Key</div>
      <div class="key-row">
        <span class="key-value hidden" id="key-val">${escHtml(key)}</span>
        <button class="btn-sm" id="reveal-btn" onclick="toggleKey()">Reveal</button>
        <button class="btn-sm" onclick="copyText('${key}',this)">Copy</button>
      </div>
      <p style="font-size:12px;color:var(--text3);margin-top:8px">Use as: <code style="font-family:'JetBrains Mono',monospace">Authorization: Bearer ${escHtml(key)}</code></p>
    </div>` : `<div class="card card-sm" style="border-color:rgba(245,158,11,.3)"><p style="color:#fcd34d;font-size:13px">⚠️ PROXY_API_KEY is not set — anyone can call this proxy without a key.</p></div>`}

    <div class="card">
      <div class="card-title">Compatible With</div>
      <div class="compat-grid">${compat.map(c=>`<span class="compat-badge">${c}</span>`).join('')}</div>
    </div>

    <div class="page-header" style="margin-bottom:0"><h2 class="page-title" style="font-size:16px">API Reference</h2></div>
    <div class="endpoint-grid">${epCards}</div>`;
}

window.toggleKey = () => {
  const v = $('key-val'), b = $('reveal-btn');
  const hidden = v.classList.toggle('hidden');
  b.textContent = hidden ? 'Reveal' : 'Hide';
};

// ── Page: Playground ──────────────────────────────────────────────────────────
function renderPlayground() {
  $('content').innerHTML = `
    <div class="playground-wrap" style="height:calc(100vh - ${52+56}px)">
      <div class="page-header" style="margin-bottom:0">
        <div><h1 class="page-title">Playground</h1><p class="page-sub">Test the proxy in real-time with any model</p></div>
      </div>
      <div class="pg-toolbar">
        <div class="model-select-wrap" id="model-wrap">
          <button class="model-select-btn" id="model-btn" onclick="toggleModelDropdown()">
            <span id="model-label-display">lite</span>
            <span class="tier-badge tier-free" id="model-tier-display">free</span>
            <svg class="arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="model-dropdown" id="model-dropdown">
            <div class="model-search"><input type="text" placeholder="Search models…" id="model-search-input" oninput="filterModels(this.value)"></div>
            <div id="model-list"></div>
          </div>
        </div>
        <div class="pg-toolbar-right">
          <button class="btn btn-ghost" style="font-size:12px" onclick="clearChat()">Clear</button>
        </div>
      </div>
      <div class="chat-area" id="chat-area"></div>
      <div class="chat-input-row">
        <textarea id="chat-input" placeholder="Type a message… (Enter to send, Shift+Enter for newline)" rows="1" oninput="autoResize(this)" onkeydown="chatKeydown(event)"></textarea>
        <button class="send-btn" id="send-btn" onclick="sendMessage()">Send</button>
      </div>
    </div>`;

  buildModelList(state.models);
  renderMessages();
  selectModel(state.chat.model);

  // Close dropdown on outside click
  document.addEventListener('click', outsideDropdownClose);
}

function outsideDropdownClose(e) {
  const wrap = $('model-wrap');
  if (wrap && !wrap.contains(e.target)) closeModelDropdown();
}

function buildModelList(models, filter = '') {
  const list = $('model-list');
  if (!list) return;
  const f = filter.toLowerCase();
  const native = models.filter(m => !f || m.id.includes(f) || m.label.toLowerCase().includes(f));

  if (!native.length) { list.innerHTML = '<div class="empty-state" style="padding:16px">No models match</div>'; return; }

  // Group by tier
  const groups = { free: [], paid: [], new: [] };
  native.forEach(m => { if (groups[m.tier]) groups[m.tier].push(m); });

  const labels = { free: '🎁 Free Tier', paid: '💎 Paid Tier', new: '✨ New Models' };
  let html = '';
  for (const [tier, items] of Object.entries(groups)) {
    if (!items.length) continue;
    html += `<div class="model-group-label">${labels[tier]}</div>`;
    items.forEach(m => {
      html += `
        <div class="model-option${m.id === state.chat.model ? ' selected' : ''}" onclick="selectModel('${m.id}')">
          <div>
            <div class="model-name">${escHtml(m.label)} <span style="color:var(--text3);font-size:11px">(${escHtml(m.id)})</span></div>
            <div class="model-desc">${escHtml(m.description)}</div>
          </div>
          <span class="tier-badge tier-${tier}">${tier}</span>
        </div>`;
    });
  }
  list.innerHTML = html;
}

window.toggleModelDropdown = () => {
  const btn = $('model-btn'), drop = $('model-dropdown');
  btn.classList.toggle('open'); drop.classList.toggle('open');
  if (drop.classList.contains('open')) { const inp = $('model-search-input'); if (inp) { inp.value=''; inp.focus(); buildModelList(state.models); } }
};
function closeModelDropdown() {
  const btn = $('model-btn'), drop = $('model-dropdown');
  if (btn) btn.classList.remove('open'); if (drop) drop.classList.remove('open');
}

window.filterModels = (v) => buildModelList(state.models, v);

window.selectModel = (id) => {
  state.chat.model = id;
  const m = state.models.find(x => x.id === id) || { label: id, tier: 'free' };
  const d = $('model-label-display'), t = $('model-tier-display');
  if (d) d.textContent = m.label || id;
  if (t) { t.textContent = m.tier; t.className = `tier-badge tier-${m.tier}`; }
  buildModelList(state.models);
  closeModelDropdown();
};

function renderMessages() {
  const area = $('chat-area');
  if (!area) return;
  const msgs = state.chat.messages;
  if (!msgs.length) {
    area.innerHTML = `<div class="chat-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><p>Select a model and start chatting</p></div>`;
    return;
  }
  area.innerHTML = msgs.map((m, i) => `
    <div class="msg msg-${m.role}" style="${m.role==='user'?'align-self:flex-end':''}">
      <div class="msg-bubble">${m.role === 'assistant' ? mdToHtml(m.content || '...') : escHtml(m.content)}</div>
    </div>`).join('');
  if (state.chat.streaming) area.innerHTML += `<div class="msg msg-assistant"><div class="msg-bubble"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div>`;
  area.scrollTop = area.scrollHeight;
}

window.clearChat = () => { state.chat.messages = []; renderMessages(); };

window.autoResize = (ta) => { ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,160)+'px'; };

window.chatKeydown = (e) => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

window.sendMessage = async () => {
  const inp = $('chat-input');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text || state.chat.streaming) return;
  inp.value = ''; inp.style.height='auto';

  state.chat.messages.push({ role: 'user', content: text });
  state.chat.streaming = true;
  renderMessages();
  $('send-btn').disabled = true;

  const assistant = { role: 'assistant', content: '' };
  state.chat.messages.push(assistant);

  try {
    const res = await fetch('/dashboard/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        messages: state.chat.messages.slice(0, -1), // All messages except the empty assistant message we just added
        model: state.chat.model 
      }),
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText.includes('Not authenticated') ? 'Not authenticated - please refresh and login' : 'Server error'}`);
    }

    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    let chunkCount = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6); 
        if (raw === '[DONE]') break;
        
        try {
          const chunk = JSON.parse(raw);
          
          // Skip initial connection message
          if (chunk.type === 'connection') continue;
          
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta) { 
            assistant.content += delta; 
            chunkCount++;
            renderMessages();
          }
        } catch (e) { 
          console.warn('Failed to parse SSE chunk:', raw); 
        }
      }
    }
  } catch (err) {
    console.error('Chat error:', err);
    assistant.content = `⚠️ Error: ${err.message}`;
  }
  
  state.chat.streaming = false;
  renderMessages();
  $('send-btn').disabled = false;
};

// ── Page: Logs ────────────────────────────────────────────────────────────────
function renderLogs() {
  $('content').innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Request Logs</h1><p class="page-sub">Incoming API calls — click a row to inspect payloads</p></div></div>
    <div class="logs-toolbar">
      <input class="filter-input" id="log-filter" placeholder="Filter by path…" oninput="applyLogFilter(this.value)">
      <div class="logs-toolbar-right">
        <button class="auto-refresh-toggle" id="ar-btn" onclick="toggleLogAutoRefresh()">⟳ Auto-refresh</button>
        <button class="btn btn-ghost" style="font-size:12px" onclick="fetchLogsData()">↺ Refresh</button>
        <button class="btn btn-danger" style="font-size:12px" onclick="clearLogsData()">Clear</button>
      </div>
    </div>
    <div class="table-wrap" id="log-table-wrap">
      <div class="empty-state">Loading…</div>
    </div>`;
  fetchLogsData();
}

async function fetchLogsData() {
  try {
    const d = await api('/dashboard/api/logs');
    state.logs.entries = d.logs || [];
    renderLogTable();
    updateNavBadge('nav-log-count', state.logs.entries.length);
  } catch (e) { if ($('log-table-wrap')) $('log-table-wrap').innerHTML = `<div class="empty-state" style="color:#f87171">Error: ${escHtml(e.message)}</div>`; }
}
window.fetchLogsData = fetchLogsData;

function renderLogTable() {
  const wrap = $('log-table-wrap'); if (!wrap) return;
  const filter = state.logs.filter.toLowerCase();
  const rows = state.logs.entries.filter(r => !filter || r.path?.toLowerCase().includes(filter));
  if (!rows.length) { wrap.innerHTML = '<div class="empty-state">No log entries yet — make an API call to see it here</div>'; return; }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th><th></th></tr></thead>
      <tbody id="log-tbody">${rows.map((r,i) => `
        <tr onclick="toggleLogDetail('${r.id}')" data-id="${r.id}">
          <td class="td-ts">${rows.length - i}</td>
          <td class="td-ts">${fmtTime(r.timestamp)}</td>
          <td><span class="method-badge method-${r.method}">${escHtml(r.method)}</span></td>
          <td class="td-path">${escHtml(r.path)}</td>
          <td><span class="status-chip ${statusClass(r.statusCode)}">${r.statusCode}</span>${r.isStream ? '<span class="stream-chip">SSE</span>' : ''}</td>
          <td class="td-dur">${fmtMs(r.durationMs)}</td>
          <td style="color:var(--text3);font-size:12px">${r.streamChunks ? r.streamChunks + ' chunks' : ''}</td>
        </tr>
        <tr id="detail-${r.id}" style="display:none"><td colspan="7" style="padding:0">
          <div class="log-detail" id="detail-inner-${r.id}">
            <div class="log-detail-grid">
              <div><div class="log-detail-label">Request Payload</div><div class="json-block">${syntaxJson(r.requestPayload)}</div></div>
              <div><div class="log-detail-label">${r.isStream ? 'Assembled Response Text' : 'Response Payload'}</div><div class="json-block">${r.isStream ? escHtml(r.responsePayload || '(empty)') : syntaxJson(r.responsePayload)}</div></div>
            </div>
            ${r.error ? `<div style="margin-top:10px"><div class="log-detail-label" style="color:#f87171">Error</div><div class="json-block" style="border-color:rgba(239,68,68,.3)">${syntaxJson(r.error)}</div></div>` : ''}
          </div>
        </td></tr>`).join('')}
      </tbody>
    </table>`;
}

window.toggleLogDetail = (id) => {
  const row = document.getElementById(`detail-${id}`);
  const inner = document.getElementById(`detail-inner-${id}`);
  if (!row) return;
  const open = row.style.display !== 'none' && inner.classList.contains('open');
  // Close all others
  document.querySelectorAll('[id^="detail-inner-"]').forEach(d => d.classList.remove('open'));
  document.querySelectorAll('[id^="detail-"]').forEach(r => { if (r.tagName==='TR') r.style.display='none'; });
  if (!open) { row.style.display=''; inner.classList.add('open'); }
};

window.applyLogFilter = (v) => { state.logs.filter = v; renderLogTable(); };

window.toggleLogAutoRefresh = () => {
  const btn = $('ar-btn'); if (!btn) return;
  state.logs.autoRefresh = !state.logs.autoRefresh;
  btn.classList.toggle('on', state.logs.autoRefresh);
  btn.textContent = state.logs.autoRefresh ? '⟳ Auto-refresh ON' : '⟳ Auto-refresh';
  if (state.logs.autoRefresh) state.logs.timer = setInterval(fetchLogsData, 5000);
  else clearInterval(state.logs.timer);
};

async function clearLogsData() {
  await fetch('/dashboard/api/logs', { method: 'DELETE' });
  state.logs.entries = [];
  renderLogTable();
  updateNavBadge('nav-log-count', 0);
}
window.clearLogsData = clearLogsData;

function statusClass(code) {
  if (code >= 200 && code < 300) return 's2xx';
  if (code >= 400 && code < 500) return 's4xx';
  if (code >= 500) return 's5xx';
  return 's-other';
}

// ── Page: System Logs ─────────────────────────────────────────────────────────
function renderSystemLogs() {
  $('content').innerHTML = `
    <div class="page-header"><div><h1 class="page-title">System Logs</h1><p class="page-sub">qodercli stderr, auth events, startup diagnostics</p></div></div>
    <div class="sys-toolbar">
      <div class="sys-toolbar-right">
        <button class="auto-refresh-toggle" id="sar-btn" onclick="toggleSysAutoRefresh()">⟳ Auto-refresh</button>
        <button class="btn btn-ghost" style="font-size:12px" onclick="fetchSysLogsData()">↺ Refresh</button>
        <button class="btn btn-danger" style="font-size:12px" onclick="clearSysData()">Clear</button>
      </div>
    </div>
    <div class="terminal" id="terminal">
      <div class="empty-state">Loading…</div>
    </div>`;
  fetchSysLogsData();
}

async function fetchSysLogsData() {
  try {
    const d = await api('/dashboard/api/logs/system');
    state.sysLogs.entries = d.logs || [];
    renderTerminal();
    const warns = state.sysLogs.entries.filter(l => l.level === 'warn' || l.level === 'error').length;
    updateNavBadge('nav-sys-count', warns);
  } catch (e) { if ($('terminal')) $('terminal').innerHTML = `<div style="color:#f87171">Error: ${escHtml(e.message)}</div>`; }
}
window.fetchSysLogsData = fetchSysLogsData;

function renderTerminal() {
  const t = $('terminal'); if (!t) return;
  const entries = [...state.sysLogs.entries].reverse(); // oldest first
  if (!entries.length) { t.innerHTML = '<div class="empty-state">No system log entries yet</div>'; return; }
  t.innerHTML = entries.map(l => `
    <div class="log-line level-${l.level}">
      <span class="log-ts">${fmtDate(l.timestamp)}</span>
      <span class="log-src src-${(l.source||'server').replace(/[^a-z-]/g,'-')}">${escHtml(l.source||'server')}</span>
      <span class="log-msg">${escHtml(l.message)}</span>
    </div>`).join('');
  t.scrollTop = t.scrollHeight;
}

window.toggleSysAutoRefresh = () => {
  const btn = $('sar-btn'); if (!btn) return;
  state.sysLogs.autoRefresh = !state.sysLogs.autoRefresh;
  btn.classList.toggle('on', state.sysLogs.autoRefresh);
  btn.textContent = state.sysLogs.autoRefresh ? '⟳ Auto-refresh ON' : '⟳ Auto-refresh';
  if (state.sysLogs.autoRefresh) state.sysLogs.timer = setInterval(fetchSysLogsData, 5000);
  else clearInterval(state.sysLogs.timer);
};

async function clearSysData() {
  await fetch('/dashboard/api/logs/system', { method: 'DELETE' });
  state.sysLogs.entries = [];
  renderTerminal();
  updateNavBadge('nav-sys-count', 0);
}
window.clearSysData = clearSysData;

// ── Nav badges ────────────────────────────────────────────────────────────────
function updateNavBadge(id, count) {
  const el = $(id); if (!el) return;
  el.textContent = count || '';
  el.classList.toggle('show', count > 0);
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
