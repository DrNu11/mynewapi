/**
 * gopay 在线升级 - 前端逻辑
 *
 * 设计：
 *   - 所有 API 走相对路径 /api/upgrade/*，由 nginx + FastAPI 提供
 *   - 进入页面时拉一次统计，更新右上角状态徽章
 *   - 如果 URL 携带 ?invite=GPxxxxxx，自动填入邀请码
 *   - 提交成功后展示真实 queueCount、ownInviteCode、message
 */

const API_BASE = "/api/upgrade";

const form = document.querySelector("#upgradeForm");
const submitButton = document.querySelector("#submitButton");
const errorCard = document.querySelector("#errorCard");
const resultCard = document.querySelector("#resultCard");
const queueCount = document.querySelector("#queueCount");
const inviteMessage = document.querySelector("#inviteMessage");
const shareLink = document.querySelector("#shareLink");
const copyButton = document.querySelector("#copyButton");
const statusPill = document.querySelector("#statusPill");
const inviteInput = document.querySelector("#inviteCode");

// 自动回填邀请码
const urlParams = new URLSearchParams(window.location.search);
const incomingInvite = urlParams.get("invite") || "";
if (incomingInvite && inviteInput && !inviteInput.value) {
  inviteInput.value = incomingInvite.trim().slice(0, 32);
}

function setStatus(state, text) {
  if (!statusPill) return;
  statusPill.dataset.state = state;
  statusPill.textContent = text;
}

function showError(text) {
  if (!errorCard) return;
  errorCard.textContent = text;
  errorCard.hidden = false;
  errorCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideError() {
  if (!errorCard) return;
  errorCard.hidden = true;
  errorCard.textContent = "";
}

function buildShareLink(ownCode) {
  const url = new URL(window.location.href);
  url.searchParams.set("invite", ownCode);
  return url.toString();
}

async function fetchJson(path, options = {}) {
  const resp = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!resp.ok) {
    const detail = data && (data.detail || data.message) ? data.detail || data.message : text || resp.statusText;
    const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.status = resp.status;
    throw err;
  }
  return data;
}

async function refreshStats() {
  try {
    const data = await fetchJson(`${API_BASE}/stats`);
    setStatus("online", `当前 ${data.queueCount} 人已提交`);
  } catch (e) {
    setStatus("offline", "暂时无法连接");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();

  const formData = new FormData(form);
  const payload = {
    email: String(formData.get("email") || "").trim(),
    order: String(formData.get("order") || "").trim(),
    inviteCode: String(formData.get("inviteCode") || "").trim(),
  };

  submitButton.disabled = true;
  submitButton.textContent = "提交中…";

  try {
    const data = await fetchJson(`${API_BASE}/submit`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    queueCount.textContent = String(data.queueCount);
    inviteMessage.textContent = data.message;
    shareLink.value = buildShareLink(data.ownInviteCode);
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setStatus("online", `当前 ${data.queueCount} 人已提交`);
  } catch (err) {
    showError(`提交失败：${err.message || "未知错误"}`);
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
  } catch {
    // 不支持 clipboard API：退化为选中
    shareLink.select();
    copyButton.textContent = "请手动复制";
  }
  setTimeout(() => {
    copyButton.textContent = "复制邀请链接";
  }, 1400);
});

refreshStats();
