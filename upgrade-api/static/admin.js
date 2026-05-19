/**
 * gopay 运维面板 - 前端控制
 *
 * 所有管理接口需要 X-Admin-Token，token 保存在 localStorage。
 * SSE 用 fetch + ReadableStream 实现（EventSource 无法带 header）。
 */

const API = "/api";
const TOKEN_KEY = "gopay-admin-token";

const $ = (sel) => document.querySelector(sel);
const els = {
  tokenInput: $("#tokenInput"),
  saveTokenBtn: $("#saveTokenBtn"),
  clearTokenBtn: $("#clearTokenBtn"),
  copyMagicLinkBtn: $("#copyMagicLinkBtn"),
  authStatus: $("#authStatus"),
  refreshBtn: $("#refreshBtn"),
  serviceBadge: $("#serviceBadge"),
  healthBadge: $("#healthBadge"),
  curBranch: $("#curBranch"),
  curCommit: $("#curCommit"),
  curMsg: $("#curMsg"),
  healthUrl: $("#healthUrl"),
  logBox: $("#logBox"),
  jobBadge: $("#jobBadge"),
  backupsBox: $("#backupsBox"),
  reloadBackupsBtn: $("#reloadBackupsBtn"),
  ordersBox: $("#ordersBox"),
  reloadOrdersBtn: $("#reloadOrdersBtn"),
  orderQuery: $("#orderQuery"),
  dedupOrdersBtn: $("#dedupOrdersBtn"),
  exportAuthZipBtn: $("#exportAuthZipBtn"),
  deployGitBtn: $("#deployGitBtn"),
  deployZipBtn: $("#deployZipBtn"),
  gitRef: $("#gitRef"),
  gitPipInstall: $("#gitPipInstall"),
  gitNote: $("#gitNote"),
  zipFile: $("#zipFile"),
  zipPipInstall: $("#zipPipInstall"),
  zipNote: $("#zipNote"),
};

// ---------- token ----------
function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
function setToken(v) {
  if (v) localStorage.setItem(TOKEN_KEY, v);
  else localStorage.removeItem(TOKEN_KEY);
  syncTokenUI();
}
function syncTokenUI() {
  const t = getToken();
  els.tokenInput.value = t;
  if (t) {
    els.authStatus.textContent = `已配置（长度 ${t.length}）,该浏览器已免登录`;
    els.authStatus.dataset.state = "ok";
  } else {
    els.authStatus.textContent = "未配置";
    els.authStatus.dataset.state = "missing";
  }
}

// URL hash 自动登录:支持 #tk=<token> 一次性快捷登录,落地到 localStorage 后清掉 hash
// 注意:hash 不会发送到服务器(无 nginx 日志泄漏),仅在浏览器内存
function parseTokenFromHash() {
  if (location.hash.startsWith("#tk=")) {
    const token = decodeURIComponent(location.hash.slice(4));
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      history.replaceState(null, "", location.pathname + location.search);
    }
  }
}

els.saveTokenBtn.addEventListener("click", () => {
  setToken(els.tokenInput.value.trim());
  refreshAll();
});
els.clearTokenBtn.addEventListener("click", () => setToken(""));

els.copyMagicLinkBtn.addEventListener("click", async () => {
  const t = getToken();
  if (!t) { alert("请先在上面输入并保存 token"); return; }
  const url = `${location.origin}${location.pathname}#tk=${encodeURIComponent(t)}`;
  try {
    await navigator.clipboard.writeText(url);
    els.copyMagicLinkBtn.textContent = "✓ 已复制,Cmd+D 加书签";
    setTimeout(() => { els.copyMagicLinkBtn.textContent = "📌 复制免登录链接"; }, 3000);
  } catch (e) {
    prompt("自动复制失败,请手动复制下面的链接:", url);
  }
});

// ---------- http ----------
async function api(path, options = {}) {
  const headers = {
    "X-Admin-Token": getToken(),
    ...(options.headers || {}),
  };
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const resp = await fetch(API + path, { ...options, headers });
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!resp.ok) {
    const detail = data && (data.detail || data.message) ? data.detail || data.message : text || resp.statusText;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

// ---------- status ----------
async function loadStatus() {
  try {
    // /api/ota/status 需要 token；/api/upgrade/stats 不需要
    if (!getToken()) {
      els.serviceBadge.dataset.state = "loading";
      els.serviceBadge.textContent = "服务状态：需要先配 token";
      els.healthBadge.dataset.state = "loading";
      els.healthBadge.textContent = "健康：—";
      els.curBranch.textContent = "—";
      els.curCommit.textContent = "—";
      els.curMsg.textContent = "—";
      els.healthUrl.textContent = "—";
      return;
    }
    const s = await api("/ota/status");
    els.serviceBadge.dataset.state = s.serviceActive ? "online" : "offline";
    els.serviceBadge.textContent = `服务：${s.service} ${s.serviceActive ? "active" : "inactive"}`;
    els.healthBadge.dataset.state = s.healthOk ? "online" : "offline";
    els.healthBadge.textContent = `健康：${s.healthOk ? "OK" : "FAIL"}`;
    els.curBranch.textContent = s.currentBranch || "—";
    els.curCommit.textContent = s.currentCommit ? s.currentCommit.slice(0, 12) + "  (" + s.currentCommit + ")" : "—";
    els.curMsg.textContent = s.currentCommitMessage || "—";
    els.healthUrl.textContent = s.healthUrl;
  } catch (e) {
    els.serviceBadge.dataset.state = "offline";
    els.serviceBadge.textContent = "服务状态：" + e.message;
    els.healthBadge.dataset.state = "offline";
    els.healthBadge.textContent = "健康：—";
  }
}

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = true));
    document.querySelector("#tab-" + tab.dataset.tab).hidden = false;
  });
});

// ---------- log streaming ----------
let currentReader = null;

function appendLog(line) {
  const atBottom = els.logBox.scrollTop + els.logBox.clientHeight >= els.logBox.scrollHeight - 20;
  els.logBox.textContent += "\n" + line;
  if (atBottom) els.logBox.scrollTop = els.logBox.scrollHeight;
}

function clearLog() { els.logBox.textContent = ""; }

function setJobBadge(state, text) {
  els.jobBadge.hidden = false;
  els.jobBadge.dataset.state = state;
  els.jobBadge.textContent = text;
}

async function streamJob(jobId) {
  if (currentReader) {
    try { await currentReader.cancel(); } catch { }
  }
  setJobBadge("running", `job: ${jobId} · running`);

  // 用 fetch + ReadableStream，因为 EventSource 不支持自定义 header
  const resp = await fetch(`${API}/ota/jobs/${jobId}/logs`, {
    headers: { "X-Admin-Token": getToken() },
  });
  if (!resp.ok) {
    appendLog(`!! 日志流连接失败：HTTP ${resp.status}`);
    setJobBadge("failed", "stream failed");
    return;
  }
  const reader = resp.body.getReader();
  currentReader = reader;
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 按 SSE 事件分割：\n\n
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const ev of events) {
      const lines = ev.split("\n");
      let eventName = "message";
      let dataParts = [];
      for (const ln of lines) {
        if (ln.startsWith("event:")) eventName = ln.slice(6).trim();
        else if (ln.startsWith("data:")) dataParts.push(ln.slice(5).trim());
      }
      const data = dataParts.join("\n");
      if (eventName === "message" && data) {
        try { appendLog(JSON.parse(data)); }
        catch { appendLog(data); }
      } else if (eventName === "done") {
        try {
          const payload = JSON.parse(data);
          setJobBadge(payload.status, `job: ${jobId} · ${payload.status}`);
        } catch { setJobBadge("success", `job: ${jobId} · done`); }
        // 刷新备份 & 状态
        loadStatus();
        loadBackups();
      }
      // open / 心跳忽略
    }
  }
}

// ---------- deploy ----------
els.deployGitBtn.addEventListener("click", async () => {
  if (!getToken()) { alert("请先保存管理员 token"); return; }
  const ref = els.gitRef.value.trim();
  if (!ref) { alert("请填写 ref"); return; }
  const note = els.gitNote.value.trim();
  const runPipInstall = els.gitPipInstall.checked;

  if (!confirm(`确定从 git 升级到 "${ref}"？\n该操作会备份当前版本、切换代码、重启服务。`)) return;
  clearLog();
  appendLog(`>> 开始 git 部署 ref=${ref} pipInstall=${runPipInstall}`);
  els.deployGitBtn.disabled = true;
  try {
    const job = await api("/ota/deploy/git", {
      method: "POST",
      body: JSON.stringify({ ref, runPipInstall, note }),
    });
    await streamJob(job.jobId);
  } catch (e) {
    appendLog(`!! 发起失败：${e.message}`);
    setJobBadge("failed", "request failed");
  } finally {
    els.deployGitBtn.disabled = false;
  }
});

els.deployZipBtn.addEventListener("click", async () => {
  if (!getToken()) { alert("请先保存管理员 token"); return; }
  const file = els.zipFile.files[0];
  if (!file) { alert("请选择 zip 文件"); return; }
  if (!confirm(`确定用 "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} MB) 覆盖部署？`)) return;

  clearLog();
  appendLog(`>> 上传 zip ${file.name}`);
  els.deployZipBtn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("runPipInstall", String(els.zipPipInstall.checked));
    fd.append("note", els.zipNote.value.trim());
    const job = await api("/ota/deploy/zip", { method: "POST", body: fd });
    await streamJob(job.jobId);
  } catch (e) {
    appendLog(`!! 发起失败：${e.message}`);
    setJobBadge("failed", "request failed");
  } finally {
    els.deployZipBtn.disabled = false;
  }
});

// ---------- backups ----------
function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}
function fmtTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString("zh-CN", { hour12: false });
}

async function loadBackups() {
  if (!getToken()) { els.backupsBox.innerHTML = '<p class="empty">需要先配置 token</p>'; return; }
  try {
    const list = await api("/ota/backups");
    if (!list.length) { els.backupsBox.innerHTML = '<p class="empty">暂无备份</p>'; return; }
    els.backupsBox.innerHTML = `
      <table>
        <thead><tr>
          <th>ID</th><th>时间</th><th>commit_before</th><th>备注</th><th>大小</th><th></th>
        </tr></thead>
        <tbody>
          ${list.map((b) => `
            <tr>
              <td class="mono">${b.id}</td>
              <td>${fmtTime(b.createdAt)}</td>
              <td class="mono">${(b.commitBefore || "").slice(0, 12) || "—"}</td>
              <td>${b.note ? escapeHtml(b.note) : ""}</td>
              <td>${fmtBytes(b.sizeBytes)}</td>
              <td><button class="danger-btn" data-rollback="${b.id}">回滚到此版本</button></td>
            </tr>`).join("")}
        </tbody>
      </table>`;
    els.backupsBox.querySelectorAll("[data-rollback]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.rollback;
        if (!confirm(`确定回滚到备份 ${id}？\n这会用此备份覆盖当前代码并重启服务。`)) return;
        clearLog();
        appendLog(`>> 回滚到 ${id}`);
        try {
          const job = await api("/ota/rollback", { method: "POST", body: JSON.stringify({ backupId: id }) });
          await streamJob(job.jobId);
        } catch (e) {
          appendLog(`!! 回滚发起失败：${e.message}`);
        }
      });
    });
  } catch (e) {
    els.backupsBox.innerHTML = `<p class="empty">加载失败：${escapeHtml(e.message)}</p>`;
  }
}
els.reloadBackupsBtn.addEventListener("click", loadBackups);

// ---------- orders ----------
const STATUS_LABEL = {
  queued: "排队中",
  processing: "处理中",
  done: "已完成",
  refunded: "已退款",
};

async function downloadAuthed(path, fallbackName) {
  // FileResponse 接口需要 X-Admin-Token,a[href] 不能带 header → 用 fetch + blob
  const resp = await fetch(API + path, { headers: { "X-Admin-Token": getToken() } });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- order details modal ----------
function ensureModal() {
  let modal = document.querySelector("#orderDetailsModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "orderDetailsModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.6);display:none;align-items:center;justify-content:center;z-index:9999;";
  modal.innerHTML = `
    <div id="orderDetailsBox" style="background:#fff;border-radius:14px;max-width:680px;width:90%;max-height:84vh;overflow:auto;padding:24px 28px;box-shadow:0 24px 60px rgba(0,0,0,.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 id="orderDetailsTitle" style="margin:0;font-size:18px;">订单详情</h3>
        <button id="orderDetailsClose" type="button" style="border:0;background:transparent;font-size:22px;cursor:pointer;color:#64748b;">×</button>
      </div>
      <div id="orderDetailsBody" style="font-size:14px;color:#1e293b;line-height:1.7;"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
  modal.querySelector("#orderDetailsClose").addEventListener("click", () => { modal.style.display = "none"; });
  return modal;
}

function fmtBool(v, yes = "✓", no = "✗") { return v ? `<span style="color:#16a34a;font-weight:600;">${yes}</span>` : `<span style="color:#dc2626;">${no}</span>`; }

async function showOrderDetails(orderId) {
  const modal = ensureModal();
  const body = modal.querySelector("#orderDetailsBody");
  modal.querySelector("#orderDetailsTitle").textContent = `订单 #${orderId} 详情`;
  body.innerHTML = '<p style="color:#64748b;">载入中…</p>';
  modal.style.display = "flex";
  try {
    const d = await api(`/admin/orders/${orderId}/details`);
    const planBadge = d.plan_type
      ? `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${d.plan_type === 'plus' ? '#3b82f6' : d.plan_type === 'pro' ? '#8b5cf6' : '#94a3b8'};color:#fff;font-size:12px;font-weight:600;">${escapeHtml(d.plan_type)}</span>`
      : '<span style="color:#94a3b8;">未知</span>';
    const warnHtml = (d.warnings || []).length
      ? `<ul style="margin:6px 0 0 18px;padding:0;color:#b45309;">${(d.warnings).map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
      : '<span style="color:#16a34a;">无</span>';
    const errBlock = d.convert_error
      ? `<div style="margin-top:12px;padding:10px 12px;background:#fee2e2;border-left:3px solid #dc2626;border-radius:4px;color:#991b1b;font-size:13px;">⚠️ ${escapeHtml(d.convert_error)}</div>`
      : "";
    body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#64748b;width:140px;">订单号</td><td class="mono">${escapeHtml(d.order_no)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">提交人邮箱</td><td>${escapeHtml(d.submitter_email)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">订单状态</td><td>${escapeHtml(d.status)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">提交时间</td><td>${fmtTime(d.created_at)}</td></tr>
        <tr><td colspan="2" style="padding:14px 0 6px;border-top:1px dashed #e2e8f0;font-weight:700;color:#0f172a;">ChatGPT 账号信息</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">账号邮箱</td><td>${escapeHtml(d.session_email || '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">套餐 (plan)</td><td>${planBadge}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">account_id</td><td class="mono" style="font-size:12px;">${escapeHtml(d.account_id || '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">expired</td><td class="mono" style="font-size:12px;">${escapeHtml(d.expired || '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">access_token</td><td>${fmtBool(d.has_access_token)} <code style="font-size:11px;color:#64748b;">${escapeHtml(d.access_token_preview || '')}</code></td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">refresh_token</td><td>${fmtBool(d.has_refresh_token)} <code style="font-size:11px;color:#64748b;">${escapeHtml(d.refresh_token_preview || '')}</code></td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">id_token</td><td>${fmtBool(d.has_id_token)}${d.id_token_synthetic ? ' <span style="color:#b45309;">(合成,占位)</span>' : ''}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">disabled</td><td>${fmtBool(!d.disabled, "✓ 可用", "✗ 已停用")}</td></tr>
        <tr><td colspan="2" style="padding:14px 0 6px;border-top:1px dashed #e2e8f0;font-weight:700;color:#0f172a;">磁盘文件</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">原始 session</td><td>${fmtBool(d.has_session_file)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">CPA auth.json</td><td>${fmtBool(d.has_auth_file)}</td></tr>
        <tr><td colspan="2" style="padding:14px 0 6px;border-top:1px dashed #e2e8f0;font-weight:700;color:#0f172a;">校验告警</td></tr>
        <tr><td colspan="2" style="padding:6px 0;">${warnHtml}</td></tr>
        <tr><td colspan="2" style="padding:14px 0 6px;border-top:1px dashed #e2e8f0;font-weight:700;color:#0f172a;">备注 (note)</td></tr>
        <tr><td colspan="2" style="padding:6px 0;font-size:13px;color:#475569;white-space:pre-wrap;">${escapeHtml(d.note || '(空)')}</td></tr>
      </table>
      ${errBlock}
      <div style="margin-top:16px;display:flex;gap:8px;">
        <button class="ghost-btn" id="dlSessFromModal">↓ 下载 session</button>
        <button class="ghost-btn" id="dlAuthFromModal">↓ 下载 auth.json</button>
      </div>`;
    body.querySelector("#dlSessFromModal").addEventListener("click", () => downloadAuthed(`/admin/orders/${orderId}/session`, `order-${orderId}-session.json`).catch(e => alert(e.message)));
    body.querySelector("#dlAuthFromModal").addEventListener("click", () => downloadAuthed(`/admin/orders/${orderId}/auth`, `order-${orderId}-auth.json`).catch(e => alert(e.message)));
  } catch (e) {
    body.innerHTML = `<p style="color:#dc2626;">加载失败:${escapeHtml(e.message)}</p>`;
  }
}

async function changeOrderStatus(orderId, currentStatus) {
  const next = prompt(
    `订单 #${orderId} 当前状态: ${currentStatus}\n` +
    "请输入新状态 (queued / processing / done / refunded):",
    currentStatus === "queued" ? "processing" : "done",
  );
  if (!next) return;
  const trimmed = next.trim();
  if (!["queued", "processing", "done", "refunded"].includes(trimmed)) {
    alert("无效状态: " + trimmed);
    return;
  }
  const note = prompt("备注 (会追加到订单 note,可空):", "") || "";
  try {
    await api(`/admin/orders/${orderId}/status`, {
      method: "POST",
      body: JSON.stringify({ status: trimmed, note }),
    });
    loadOrders();
  } catch (e) {
    alert("改状态失败: " + e.message);
  }
}

async function loadOrders() {
  if (!getToken()) { els.ordersBox.innerHTML = '<p class="empty">需要先配置 token</p>'; return; }
  try {
    const q = els.orderQuery.value.trim();
    const r = await api(`/admin/orders?limit=100${q ? "&q=" + encodeURIComponent(q) : ""}`);
    if (!r.items.length) { els.ordersBox.innerHTML = '<p class="empty">暂无订单</p>'; return; }
    els.ordersBox.innerHTML = `
      <p class="hint">共 ${r.total} 条，显示最近 ${r.items.length} 条</p>
      <table>
        <thead><tr>
          <th>#</th><th>状态</th><th>邮箱</th><th>订单号</th>
          <th>Session 邮箱 / Plan</th><th>素材</th>
          <th>邀请码↓</th><th>本人码↑</th>
          <th>时间</th><th>备注</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${r.items.map((o) => {
      const status = o.status || "queued";
      const sessionLabel = o.session_email
        ? `${escapeHtml(o.session_email)} <span class="mono" style="opacity:.7">${escapeHtml(o.session_plan || "?")}</span>`
        : '<span style="opacity:.5">—</span>';
      const sessBtn = o.has_session
        ? `<button class="ghost-btn" data-dl-session="${o.id}" title="下载原始 session JSON">↓session</button>`
        : '<span style="opacity:.5">无</span>';
      const authBtn = o.has_auth
        ? `<button class="ghost-btn" data-dl-auth="${o.id}" title="下载 CPA auth.json">↓auth</button>`
        : "";
      const noteShort = o.note ? escapeHtml(o.note.split("\n").pop()).slice(0, 60) : "";
      return `
            <tr>
              <td><a href="javascript:void(0)" data-detail="${o.id}" style="color:#2357ff;font-weight:700;">#${o.id}</a></td>
              <td><span class="badge" data-state="${status === 'done' ? 'online' : status === 'refunded' ? 'offline' : 'loading'}">${STATUS_LABEL[status] || status}</span></td>
              <td>${escapeHtml(o.email)}</td>
              <td class="mono">${escapeHtml(o.order_no)}</td>
              <td>${sessionLabel}</td>
              <td>${sessBtn} ${authBtn}</td>
              <td class="mono">${escapeHtml(o.invite_code || "")}</td>
              <td class="mono">${escapeHtml(o.own_invite_code)}</td>
              <td>${fmtTime(o.created_at)}</td>
              <td title="${escapeHtml(o.note || '')}">${noteShort}</td>
              <td>
                <button class="ghost-btn" data-detail="${o.id}" title="查看 session 详情">详情</button>
                <button class="ghost-btn" data-status="${o.id}" data-cur="${status}">改状态</button>
              </td>
            </tr>`;
    }).join("")}
        </tbody>
      </table>`;

    // 绑事件
    els.ordersBox.querySelectorAll("[data-dl-session]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.dlSession;
        downloadAuthed(`/admin/orders/${id}/session`, `order-${id}-session.json`)
          .catch((e) => alert("下载失败: " + e.message));
      });
    });
    els.ordersBox.querySelectorAll("[data-dl-auth]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.dlAuth;
        downloadAuthed(`/admin/orders/${id}/auth`, `order-${id}-auth.json`)
          .catch((e) => alert("下载失败: " + e.message));
      });
    });
    els.ordersBox.querySelectorAll("[data-status]").forEach((btn) => {
      btn.addEventListener("click", () => changeOrderStatus(btn.dataset.status, btn.dataset.cur));
    });
    els.ordersBox.querySelectorAll("[data-detail]").forEach((el) => {
      el.addEventListener("click", () => showOrderDetails(el.dataset.detail));
    });
  } catch (e) {
    els.ordersBox.innerHTML = `<p class="empty">加载失败：${escapeHtml(e.message)}</p>`;
  }
}
els.reloadOrdersBtn.addEventListener("click", loadOrders);
els.orderQuery.addEventListener("keydown", (e) => { if (e.key === "Enter") loadOrders(); });

// ---------- 去重 ----------
async function runDedup() {
  if (!getToken()) { alert("请先配置 admin token"); return; }
  els.dedupOrdersBtn.disabled = true;
  const oldText = els.dedupOrdersBtn.textContent;
  els.dedupOrdersBtn.textContent = "扫描中…";
  try {
    // 第一步:dry-run 看一眼
    const preview = await api(`/admin/orders/dedup?dry_run=true`, { method: "POST" });
    if (preview.merged_total === 0) {
      alert(`✓ 扫描了 ${preview.scanned_emails} 个邮箱,没有发现重复。`);
      return;
    }
    // 弹列表确认
    const lines = preview.groups.map((g) =>
      `• ${g.email}\n    保留 #${g.kept_id}${g.kept_has_auth ? " (已转 auth ✓)" : " (未转 auth ✗)"}\n    合并 ${g.removed_ids.map((i) => "#" + i).join(", ")}`
    ).join("\n\n");
    const msg =
      `发现 ${preview.duplicate_emails} 个邮箱有重复,共 ${preview.merged_total} 条订单将被标记为 refunded:\n\n` +
      `${lines}\n\n` +
      `策略:同邮箱保留最新 (id 最大) 一条,其余改为 refunded(磁盘上 session/auth 文件保留)。\n\n` +
      `确认执行?`;
    if (!confirm(msg)) return;
    // 第二步:真执行
    const result = await api(`/admin/orders/dedup?dry_run=false`, { method: "POST" });
    alert(`✓ 完成。本次合并了 ${result.merged_total} 条订单 (${result.duplicate_emails} 个邮箱)。`);
    loadOrders();
  } catch (e) {
    alert("去重失败: " + e.message);
  } finally {
    els.dedupOrdersBtn.disabled = false;
    els.dedupOrdersBtn.textContent = oldText;
  }
}
els.dedupOrdersBtn.addEventListener("click", runDedup);

// ---------- 一键导出 auth.json zip ----------
async function exportAuthZip() {
  if (!getToken()) { alert("请先配置 admin token"); return; }
  els.exportAuthZipBtn.disabled = true;
  const oldText = els.exportAuthZipBtn.textContent;
  els.exportAuthZipBtn.textContent = "打包中…";
  try {
    const resp = await fetch(API + "/admin/orders/export-auth-zip", {
      headers: { "X-Admin-Token": getToken() },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }
    const count = resp.headers.get("X-Auth-Count") || "?";
    // 从 Content-Disposition 抽 filename;失败用 fallback
    const cd = resp.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="([^"]+)"/);
    const filename = m ? m[1] : `cpa-auths-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.zip`;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    els.exportAuthZipBtn.textContent = `✓ 已下载 ${count} 份`;
    setTimeout(() => { els.exportAuthZipBtn.textContent = oldText; }, 3000);
  } catch (e) {
    alert("导出失败: " + e.message);
    els.exportAuthZipBtn.textContent = oldText;
  } finally {
    els.exportAuthZipBtn.disabled = false;
  }
}
els.exportAuthZipBtn.addEventListener("click", exportAuthZip);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- bootstrap ----------
function refreshAll() {
  loadStatus();
  loadBackups();
  loadOrders();
}

els.refreshBtn.addEventListener("click", refreshAll);

parseTokenFromHash();   // 优先从 URL #tk=... 提取 token,实现"点链接即登录"
syncTokenUI();
refreshAll();
