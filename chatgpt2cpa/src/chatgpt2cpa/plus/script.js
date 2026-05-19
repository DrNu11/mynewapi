/**
 * gopay 在线升级 - 用户面 (chatgpt2cpa 前端)
 *
 * 流程:
 *   1. 用户粘贴 ChatGPT session JSON → 失焦时本地预校验 + 调本地 /api/convert
 *      探查 plan_type / warnings,实时反馈在 #sessionHint
 *   2. 提交时:
 *      a. 客户端 JSON.parse + 必填校验
 *      b. 调 /api/convert 拿到 auth_data (转 CPA auth.json)
 *      c. POST /api/upgrade/submit (upgrade-api,via nginx 同源反代) 一并带上
 *         sessionJson + authJson
 *   3. 显示新接口返回:queueCount / ownInviteCode / inviteCredits / message
 *
 * 部署假设:
 *   生产 nginx 把 /api/upgrade/* 反代到 upgrade-api:7889,其他到 chatgpt2cpa:7888
 *   开发时可以在 html 内通过 window.__UPGRADE_API_BASE='http://127.0.0.1:7889' 覆盖
 */

function detectUpgradeBase() {
  if (window.__UPGRADE_API_BASE) return window.__UPGRADE_API_BASE;
  // 本地开发约定:chatgpt2cpa 跑在 :7888,upgrade-api 同主机 :7889
  const { protocol, hostname, port } = window.location;
  const localHosts = new Set(["127.0.0.1", "localhost"]);
  if (localHosts.has(hostname) && (port === "7888" || port === "8000")) {
    return `${protocol}//${hostname}:7889`;
  }
  return ""; // 生产:nginx 同源反代,相对路径即可
}
const UPGRADE_BASE = detectUpgradeBase().replace(/\/$/, "");
const upgradeUrl = (path) => `${UPGRADE_BASE}${path}`;

const form = document.querySelector("#upgradeForm");
const resultCard = document.querySelector("#resultCard");
const queueCount = document.querySelector("#queueCount");
const inviteMessage = document.querySelector("#inviteMessage");
const shareLink = document.querySelector("#shareLink");
const copyButton = document.querySelector("#copyButton");
const submitButton = document.querySelector("#submitButton");
const errorMessage = document.querySelector("#errorMessage");
const inviteCodeInput = document.querySelector("#inviteCode");
const sessionInput = document.querySelector("#sessionJson");
const sessionHint = document.querySelector("#sessionHint");
const queueProgressNum = document.querySelector("#queueProgressNum");
const queueProgressBar = document.querySelector("#queueProgressBar");
const queueProgressHint = document.querySelector("#queueProgressHint");

const inviteFromUrl = new URL(window.location.href).searchParams.get("invite");
if (inviteFromUrl) {
  inviteCodeInput.value = inviteFromUrl;
}

// 进度条:每 100 人为一批,满 100 人时填满,展示给用户"队列在动"的视觉感受
const QUEUE_BATCH_SIZE = 100;

function renderQueueProgress(count) {
  if (!queueProgressNum) return;
  queueProgressNum.textContent = String(count);
  // pct 公式:count 占 batch 的比例,封顶 100%
  const pct = Math.min(100, Math.round((count / QUEUE_BATCH_SIZE) * 100));
  queueProgressBar.style.width = pct + "%";
  if (count === 0) {
    queueProgressHint.textContent = "公益站,处理速度有限,提交后请耐心等待。";
  } else {
    const remain = Math.max(0, QUEUE_BATCH_SIZE - (count % QUEUE_BATCH_SIZE));
    queueProgressHint.textContent = `公益站,处理速度有限。当前批次还差 ${remain} 人满 ${QUEUE_BATCH_SIZE},请耐心等待。`;
  }
}

async function refreshQueueStats() {
  try {
    const resp = await fetch(upgradeUrl("/api/upgrade/stats"));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderQueueProgress(data.queueCount || 0);
  } catch (e) {
    if (queueProgressHint) queueProgressHint.textContent = `进度暂时无法加载:${e.message}`;
  }
}

refreshQueueStats();

function setError(message) {
  errorMessage.textContent = message || "";
  errorMessage.hidden = !message;
}

function setSessionHint(text, color = "#94a3b8") {
  sessionHint.textContent = text || "粘贴后会自动检测是否有效。";
  sessionHint.style.color = color;
}

// 缓存最近一次成功转换的结果,提交时直接复用避免重复转
let lastConvert = { raw: "", authData: null };

async function convertSession(raw) {
  // 本地 chatgpt2cpa 的 /api/convert (相对路径,跟 chatgpt2cpa 同源)
  const resp = await fetch("/api/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw_json: raw, filename: "", export_format: "cpa" }),
  });
  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body) {
    const detail = body && body.detail ? body.detail : `转换失败 HTTP ${resp.status}`;
    throw new Error(detail);
  }
  return body; // { export_format, filename, download_data, auth_data, warnings }
}

let validateTimer = null;
sessionInput.addEventListener("input", () => {
  const raw = sessionInput.value.trim();
  if (!raw) {
    setSessionHint("");
    lastConvert = { raw: "", authData: null };
    return;
  }
  // debounce 500ms 等用户粘完
  clearTimeout(validateTimer);
  setSessionHint("检测中…", "#94a3b8");
  validateTimer = setTimeout(async () => {
    try {
      JSON.parse(raw); // 客户端先快速判 JSON 合法
    } catch (e) {
      setSessionHint("✗ 不是有效 JSON,请重新复制完整内容。", "#f87171");
      lastConvert = { raw: "", authData: null };
      return;
    }
    try {
      const r = await convertSession(raw);
      lastConvert = { raw, authData: r.auth_data };
      const plan = (r.auth_data && r.auth_data.plan_type) || "unknown";
      const email = (r.auth_data && r.auth_data.email) || "";
      const warn = (r.warnings || []).length ? ` · ${r.warnings.length} 条警告` : "";
      setSessionHint(`✓ session 解析成功:${email || "(无邮箱)"} · plan=${plan}${warn}`, "#4ade80");
    } catch (e) {
      setSessionHint(`✗ session 校验失败:${e.message}`, "#f87171");
      lastConvert = { raw: "", authData: null };
    }
  }, 500);
});

function autoOrderNo() {
  // 自动订单号:GP-AUTO-<毫秒时间戳>-<4位随机>,保证全局唯一,管理员能从前缀一眼区分
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `GP-AUTO-${Date.now()}-${rnd}`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");
  submitButton.disabled = true;
  submitButton.textContent = "提交中...";

  const formData = new FormData(form);
  const inviteCode = String(formData.get("inviteCode") || "").trim();
  const sessionRaw = String(formData.get("sessionJson") || "").trim();

  if (!sessionRaw) {
    setError("请粘贴 ChatGPT session JSON。");
    submitButton.disabled = false;
    submitButton.textContent = "提交升级申请";
    return;
  }

  // 客户端只校验是不是合法 JSON;真正的 session→auth.json 转换由后端做。
  // 这样 plus 页面不再依赖 chatgpt2cpa 服务,后端是唯一的真相源。
  let parsedSession;
  try {
    parsedSession = JSON.parse(sessionRaw);
  } catch (e) {
    setError(`session 不是合法 JSON:${e.message}`);
    submitButton.disabled = false;
    submitButton.textContent = "提交升级申请";
    return;
  }

  // 邮箱从 session 自动提取 (UI 已不收集);取不到就让后端自己拒
  const email =
    (parsedSession && parsedSession.user && parsedSession.user.email)
    || (parsedSession && parsedSession.email)
    || "";
  if (!email) {
    setError("session 中没有 email,请检查是否完整粘贴 chatgpt.com/api/auth/session 的 JSON。");
    submitButton.disabled = false;
    submitButton.textContent = "提交升级申请";
    return;
  }

  const payload = {
    email: String(email).trim(),
    order: autoOrderNo(),
    inviteCode,
    sessionJson: sessionRaw,
    // 不再传 authJson — 后端会自己转,前端传啥都没用 (已被 routes/upgrade.py 忽略)
  };

  try {
    const response = await fetch(upgradeUrl("/api/upgrade/submit"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      const detail = body && (body.detail || body.message) ? body.detail || body.message : `HTTP ${response.status}`;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }

    queueCount.textContent = String(body.queueCount);
    renderQueueProgress(body.queueCount); // 同步刷新左侧进度条
    inviteMessage.textContent = body.message || "提交成功。";
    // 用本页 url + ?invite= 组装分享链接
    const url = new URL(window.location.href);
    url.searchParams.set("invite", body.ownInviteCode);
    shareLink.value = url.toString();
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    setError(error instanceof Error ? error.message : "提交失败，请稍后重试。");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "提交升级申请";
  }
});

copyButton.addEventListener("click", async () => {
  if (!shareLink.value) return;

  try {
    await navigator.clipboard.writeText(shareLink.value);
    copyButton.textContent = "已复制";
    setTimeout(() => {
      copyButton.textContent = "复制邀请链接";
    }, 1400);
  } catch {
    setError("复制失败，请手动复制邀请链接。");
  }
});
