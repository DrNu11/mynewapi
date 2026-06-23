'use strict';

const http = require('http');
const { execFile } = require('child_process');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 1777);
const HOST = process.env.HOST || '0.0.0.0';
const AUDIT_DB = process.env.AUDIT_DB || '/opt/nassa-cards/data/audit.db';
const CARDS_DB = process.env.CARDS_DB || '/opt/nassa-cards/data/cards.db';
const NEWAPI_CONTAINER = process.env.NEWAPI_CONTAINER || 'newapi-prod-new-api-1';
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS = process.env.AUTH_PASS || '';

const MAX_LIMIT = 300;

function run(command, args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout || stderr);
    });
  });
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sqlString(value) {
  return String(value || '').replaceAll("'", "''");
}

function maskSecret(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9]{10,}/g, (key) => `${key.slice(0, 12)}...${key.slice(-6)}`)
    .replace(/Bearer\s+([A-Za-z0-9._-]{20,})/gi, (_m, key) => `Bearer ${key.slice(0, 8)}...${key.slice(-6)}`);
}

function safeRaw(text) {
  return maskSecret(String(text || ''));
}

function isAuthed(req) {
  if (!AUTH_PASS) return false;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const index = decoded.indexOf(':');
  if (index < 0) return false;
  const user = decoded.slice(0, index);
  const pass = decoded.slice(index + 1);
  if (user.length !== AUTH_USER.length || pass.length !== AUTH_PASS.length) return false;
  const userOk = crypto.timingSafeEqual(Buffer.from(user), Buffer.from(AUTH_USER));
  const passOk = crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(AUTH_PASS));
  return userOk && passOk;
}

function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Nassa Error Logs"',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end('Authentication required');
  return false;
}

async function sqliteJson(dbPath, sql) {
  const out = await run('sqlite3', ['-json', dbPath, sql]);
  if (!out.trim()) return [];
  return JSON.parse(out);
}

function buildCardWhere(url, onlyErrors) {
  const minutes = clampInt(url.searchParams.get('minutes'), 60, 1, 1440);
  const cardId = url.searchParams.get('card_id');
  const key = url.searchParams.get('key');
  const q = url.searchParams.get('q');
  const wheres = [`ts >= strftime('%s','now')-${minutes * 60}`];
  if (onlyErrors) {
    wheres.push('status_code not in (200,0)');
  }
  if (cardId) {
    wheres.push(`card_id = ${clampInt(cardId, 0, 0, 100000000)}`);
  }
  if (key) {
    const escaped = sqlString(key);
    wheres.push(`(sk_prefix like '%${escaped}%' or response_text like '%${escaped}%')`);
  }
  if (q) {
    const escaped = sqlString(q);
    wheres.push(`(response_text like '%${escaped}%' or model like '%${escaped}%' or ip like '%${escaped}%')`);
  }
  return wheres.join(' and ');
}

async function cardErrors(url) {
  const limit = clampInt(url.searchParams.get('limit'), 120, 1, MAX_LIMIT);
  const where = buildCardWhere(url, true);
  const rows = await sqliteJson(AUDIT_DB, `
    select
      datetime(ts,'unixepoch','+8 hours') as time,
      card_id,
      sk_prefix,
      ip,
      endpoint,
      model,
      status_code,
      duration_ms,
      request_size,
      response_finish_reason,
      substr(coalesce(response_text,''),1,4000) as raw_response
    from conversation_logs
    where ${where}
    order by ts desc
    limit ${limit};
  `);
  return rows.map((row) => ({ ...row, raw_response: safeRaw(row.raw_response), sk_prefix: safeRaw(row.sk_prefix) }));
}

async function suspiciousRows(url) {
  const limit = clampInt(url.searchParams.get('limit'), 120, 1, MAX_LIMIT);
  const where = buildCardWhere(url, false);
  const rows = await sqliteJson(AUDIT_DB, `
    select
      datetime(ts,'unixepoch','+8 hours') as time,
      card_id,
      sk_prefix,
      ip,
      endpoint,
      model,
      status_code,
      duration_ms,
      request_size,
      length(coalesce(response_text,'')) as response_length,
      response_finish_reason,
      substr(coalesce(response_text,''),1,4000) as raw_response
    from conversation_logs
    where ${where}
      and status_code = 200
      and (length(coalesce(response_text,'')) = 0 or duration_ms is null or response_finish_reason is null or response_finish_reason = '')
    order by ts desc
    limit ${limit};
  `);
  return rows.map((row) => ({ ...row, raw_response: safeRaw(row.raw_response), sk_prefix: safeRaw(row.sk_prefix) }));
}

async function cardInfo(url) {
  const cardId = clampInt(url.searchParams.get('card_id'), 0, 0, 100000000);
  const key = url.searchParams.get('key');
  const wheres = [];
  if (cardId) wheres.push(`id = ${cardId}`);
  if (key) wheres.push(`newapi_token_key like '%${sqlString(key)}%' or code like '%${sqlString(key)}%'`);
  if (!wheres.length) return [];
  const rows = await sqliteJson(CARDS_DB, `
    select
      id,
      substr(code,1,12)||'...'||substr(code,-6) as code_mask,
      plan,
      status,
      newapi_token_id,
      newapi_user_id,
      rph,
      pool,
      activator_ip,
      disable_reason,
      datetime(created_at,'unixepoch','+8 hours') as created_at,
      datetime(expires_at,'unixepoch','+8 hours') as expires_at,
      substr(coalesce(newapi_token_key,''),1,12)||'...'||substr(coalesce(newapi_token_key,''),-6) as token_mask
    from cards
    where ${wheres.join(' or ')}
    limit 20;
  `);
  return rows.map((row) => ({
    ...row,
    token_mask: safeRaw(row.token_mask),
    code_mask: safeRaw(row.code_mask)
  }));
}

async function newapiErrors(url) {
  const minutes = clampInt(url.searchParams.get('minutes'), 60, 1, 1440);
  const limit = clampInt(url.searchParams.get('limit'), 160, 1, MAX_LIMIT);
  const q = String(url.searchParams.get('q') || '').toLowerCase();
  const out = await run('docker', ['logs', '--since', `${minutes}m`, NEWAPI_CONTAINER], 12000);
  const patterns = [
    'relay error',
    'channel error',
    '重试：',
    '| 400 |',
    '| 401 |',
    '| 403 |',
    '| 429 |',
    '| 502 |',
    '| 524 |',
    'record consume log'
  ];
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => patterns.some((pattern) => line.includes(pattern)))
    .filter((line) => !q || line.toLowerCase().includes(q))
    .slice(-limit)
    .reverse()
    .map((line) => safeRaw(line));
}

function sendJson(res, data) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, error) {
  res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: error.message, detail: safeRaw(error.stderr || '') }, null, 2));
}

function html() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NassaAPI 错误日志</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #05070b;
      --panel: rgba(255,255,255,.06);
      --panel-2: rgba(255,255,255,.09);
      --line: rgba(255,255,255,.12);
      --text: #f5f7fb;
      --muted: #9aa4b2;
      --accent: #7dd3fc;
      --red: #fb7185;
      --green: #34d399;
      --yellow: #fbbf24;
      --shadow: 0 24px 80px rgba(0,0,0,.42);
      --ease: cubic-bezier(.32,.72,0,1);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 20% -10%, rgba(59,130,246,.26), transparent 34rem),
        radial-gradient(circle at 90% 0%, rgba(168,85,247,.20), transparent 30rem),
        var(--bg);
    }
    .wrap { width: min(1440px, calc(100% - 32px)); margin: 0 auto; padding: 34px 0 44px; }
    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 22px;
    }
    .eyebrow { color: var(--accent); font-size: 12px; letter-spacing: .16em; text-transform: uppercase; font-weight: 700; }
    h1 { margin: 8px 0 0; font-size: clamp(34px, 5vw, 64px); line-height: .95; letter-spacing: -.035em; }
    .sub { color: var(--muted); margin-top: 12px; font-size: 15px; }
    .live {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 14px; border: 1px solid var(--line); border-radius: 999px;
      background: rgba(255,255,255,.05); color: var(--muted); white-space: nowrap;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 22px var(--green); }
    .controls {
      display: grid;
      grid-template-columns: 1.1fr .8fr .8fr .8fr auto;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: rgba(255,255,255,.045);
      backdrop-filter: blur(30px) saturate(150%);
      box-shadow: var(--shadow);
      margin-bottom: 16px;
    }
    input, select, button {
      height: 44px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.07);
      color: var(--text);
      padding: 0 14px;
      outline: none;
      font: inherit;
      transition: border-color .35s var(--ease), background .35s var(--ease), transform .35s var(--ease);
    }
    select option { background: #10131a; color: var(--text); }
    input::placeholder { color: #6f7b8c; }
    input:focus, select:focus { border-color: rgba(125,211,252,.62); background: rgba(255,255,255,.095); }
    button { cursor: pointer; background: #f5f7fb; color: #05070b; font-weight: 700; border: 0; padding: 0 20px; }
    button:hover { transform: scale(.98); }
    .grid { display: grid; grid-template-columns: 360px 1fr; gap: 16px; align-items: start; }
    .panel {
      border: 1px solid var(--line);
      border-radius: 30px;
      background: rgba(255,255,255,.045);
      backdrop-filter: blur(34px) saturate(150%);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .panel-head {
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      padding: 18px 18px 14px;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .panel-title { font-weight: 750; letter-spacing: -.015em; }
    .pill { color: var(--muted); font-size: 12px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 999px; }
    .side { padding: 14px; display: grid; gap: 10px; }
    .stat {
      padding: 14px; border: 1px solid rgba(255,255,255,.08); border-radius: 22px;
      background: rgba(255,255,255,.045);
    }
    .stat .k { color: var(--muted); font-size: 12px; }
    .stat .v { font-size: 20px; margin-top: 6px; font-weight: 750; }
    .tabs { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid rgba(255,255,255,.08); flex-wrap: wrap; }
    .tab {
      height: 36px; padding: 0 13px; border-radius: 999px; display: inline-flex; align-items: center;
      color: var(--muted); background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
      cursor: pointer; transition: all .35s var(--ease);
    }
    .tab.active { color: #061018; background: var(--accent); border-color: transparent; font-weight: 750; }
    .list { padding: 12px; display: grid; gap: 10px; max-height: calc(100vh - 270px); overflow: auto; }
    .row {
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 22px;
      background: rgba(255,255,255,.045);
      overflow: hidden;
    }
    .meta {
      display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,.06);
      color: var(--muted);
      font-size: 12px;
    }
    .badge { padding: 4px 8px; border-radius: 999px; background: rgba(255,255,255,.08); color: var(--text); }
    .bad { color: #fff; background: rgba(251,113,133,.26); }
    .ok { color: #04110c; background: var(--green); }
    pre {
      margin: 0;
      padding: 14px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #dbe7f5;
      font-size: 12px;
      line-height: 1.55;
    }
    .empty { color: var(--muted); padding: 28px; text-align: center; }
    .loading { opacity: .68; }
    @media (max-width: 900px) {
      header { align-items: flex-start; flex-direction: column; }
      .controls { grid-template-columns: 1fr; border-radius: 24px; }
      .grid { grid-template-columns: 1fr; }
      .list { max-height: none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <div class="eyebrow">NASSAAPI OBSERVABILITY</div>
        <h1>客户报错原始日志</h1>
        <div class="sub">只读查询 card 审计库与 NewAPI 容器错误行，默认隐藏完整密钥。</div>
      </div>
      <div class="live"><span class="dot"></span><span id="clock">Live</span></div>
    </header>

    <section class="controls">
      <input id="q" placeholder="搜索 IP / 错误 / request id / 关键字" />
      <input id="cardId" placeholder="card_id，例如 470" />
      <input id="key" placeholder="key 片段，例如 sk-X6MyXauD" />
      <select id="minutes">
        <option value="30">最近 30 分钟</option>
        <option value="60" selected>最近 1 小时</option>
        <option value="360">最近 6 小时</option>
        <option value="1440">最近 24 小时</option>
      </select>
      <button id="refresh">刷新</button>
    </section>

    <main class="grid">
      <aside class="panel">
        <div class="panel-head">
          <div class="panel-title">概览</div>
          <div class="pill" id="updated">未加载</div>
        </div>
        <div class="side">
          <div class="stat"><div class="k">Card 最终错误</div><div class="v" id="countErrors">-</div></div>
          <div class="stat"><div class="k">空响应可疑记录</div><div class="v" id="countSuspicious">-</div></div>
          <div class="stat"><div class="k">NewAPI 原始错误行</div><div class="v" id="countNewapi">-</div></div>
          <div class="stat"><div class="k">当前筛选</div><div class="v" id="filterText">最近 1 小时</div></div>
        </div>
      </aside>

      <section class="panel">
        <div class="tabs">
          <div class="tab active" data-tab="errors">Card 最终错误</div>
          <div class="tab" data-tab="suspicious">空响应可疑</div>
          <div class="tab" data-tab="newapi">NewAPI 原始错误</div>
          <div class="tab" data-tab="card">卡信息</div>
        </div>
        <div class="list" id="list"><div class="empty">正在加载...</div></div>
      </section>
    </main>
  </div>

  <script>
    const state = { tab: 'errors', data: { errors: [], suspicious: [], newapi: [], card: [] } };
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    function params() {
      const p = new URLSearchParams();
      p.set('minutes', $('minutes').value);
      if ($('q').value.trim()) p.set('q', $('q').value.trim());
      if ($('cardId').value.trim()) p.set('card_id', $('cardId').value.trim());
      if ($('key').value.trim()) p.set('key', $('key').value.trim());
      p.set('limit', '180');
      return p;
    }

    async function get(path) {
      const res = await fetch(path + '?' + params().toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    async function load() {
      $('list').classList.add('loading');
      try {
        const [errors, suspicious, newapi, card] = await Promise.all([
          get('/api/card-errors'),
          get('/api/suspicious'),
          get('/api/newapi-errors'),
          get('/api/card-info')
        ]);
        state.data = { errors, suspicious, newapi, card };
        $('countErrors').textContent = errors.length;
        $('countSuspicious').textContent = suspicious.length;
        $('countNewapi').textContent = newapi.length;
        $('updated').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        $('filterText').textContent = $('minutes').selectedOptions[0].textContent;
        render();
      } catch (error) {
        $('list').innerHTML = '<div class="empty">加载失败：' + esc(error.message) + '</div>';
      } finally {
        $('list').classList.remove('loading');
      }
    }

    function rowMeta(parts) {
      return '<div class="meta">' + parts.filter(Boolean).map(p => '<span class="badge ' + (p.bad ? 'bad' : p.ok ? 'ok' : '') + '">' + esc(p.text) + '</span>').join('') + '</div>';
    }

    function renderStructured(rows) {
      if (!rows.length) return '<div class="empty">当前筛选没有记录</div>';
      return rows.map(r => '<article class="row">' +
        rowMeta([
          { text: r.time },
          { text: 'card ' + (r.card_id ?? '-') },
          { text: r.status_code ?? '-', bad: Number(r.status_code) >= 400, ok: Number(r.status_code) === 200 },
          { text: r.model || '-' },
          { text: r.ip || '-' },
          { text: (r.duration_ms ?? '-') + 'ms' },
          { text: 'size ' + (r.request_size ?? '-') }
        ]) +
        '<pre>' + esc(r.raw_response || JSON.stringify(r, null, 2)) + '</pre>' +
      '</article>').join('');
    }

    function renderLines(lines) {
      if (!lines.length) return '<div class="empty">当前筛选没有 NewAPI 错误行</div>';
      return lines.map(line => '<article class="row">' + rowMeta([{ text: 'raw docker log' }]) + '<pre>' + esc(line) + '</pre></article>').join('');
    }

    function renderCard(rows) {
      if (!rows.length) return '<div class="empty">输入 card_id 或 key 片段后显示卡信息</div>';
      return rows.map(r => '<article class="row">' +
        rowMeta([{ text: 'card ' + r.id }, { text: r.status, ok: r.status === 'activated' }, { text: 'rph ' + r.rph }]) +
        '<pre>' + esc(JSON.stringify(r, null, 2)) + '</pre>' +
      '</article>').join('');
    }

    function render() {
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
      const list = $('list');
      if (state.tab === 'errors') list.innerHTML = renderStructured(state.data.errors);
      if (state.tab === 'suspicious') list.innerHTML = renderStructured(state.data.suspicious);
      if (state.tab === 'newapi') list.innerHTML = renderLines(state.data.newapi);
      if (state.tab === 'card') list.innerHTML = renderCard(state.data.card);
    }

    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      render();
    }));
    $('refresh').addEventListener('click', load);
    ['q','cardId','key'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') load(); }));
    $('minutes').addEventListener('change', load);
    setInterval(() => $('clock').textContent = new Date().toLocaleString('zh-CN', { hour12: false }), 1000);
    load();
    setInterval(load, 30000);
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html());
      return;
    }
    if (url.pathname === '/api/card-errors') return sendJson(res, await cardErrors(url));
    if (url.pathname === '/api/suspicious') return sendJson(res, await suspiciousRows(url));
    if (url.pathname === '/api/newapi-errors') return sendJson(res, await newapiErrors(url));
    if (url.pathname === '/api/card-info') return sendJson(res, await cardInfo(url));
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Nassa error log viewer listening on http://${HOST}:${PORT}`);
});
