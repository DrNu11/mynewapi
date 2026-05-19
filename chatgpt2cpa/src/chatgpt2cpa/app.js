const el = {
  form: document.getElementById("upgradeForm"),
  sessionJson: document.getElementById("sessionJson"),
  accessToken: document.getElementById("accessToken"),
  tokenStatus: document.getElementById("tokenStatus"),
  orderId: document.getElementById("orderId"),
  inviteCode: document.getElementById("inviteCode"),
  errorBox: document.getElementById("errorBox"),
  resultCard: document.getElementById("resultCard"),
  queueCount: document.getElementById("queueCount"),
  summary: document.getElementById("summary"),
  chanceCount: document.getElementById("chanceCount"),
  ownInviteCode: document.getElementById("ownInviteCode"),
  bonusCount: document.getElementById("bonusCount"),
  inviteMessage: document.getElementById("inviteMessage"),
  shareLink: document.getElementById("shareLink"),
  copyButton: document.getElementById("copyButton"),
};

const STORAGE_KEY = "gopay-plus-queue-count";
const INVITE_KEY = "gopay-plus-invite-count";
const BONUS_KEY = "gopay-plus-bonus-count";
const CHANCE_KEY = "gopay-plus-chance-count";

let tokenTimer = 0;
let inviteSeed = localStorage.getItem("gopay-plus-own-invite-seed");

if (!inviteSeed) {
  inviteSeed = `${Date.now()}-${Math.random()}`;
  localStorage.setItem("gopay-plus-own-invite-seed", inviteSeed);
}

function setError(message) {
  el.errorBox.textContent = message || "";
  el.errorBox.hidden = !message;
}

function getStoredNumber(key, fallback) {
  const rawValue = localStorage.getItem(key);
  if (rawValue === null) return fallback;

  const value = Number(rawValue);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function kv(label, value) {
  const row = document.createElement("div");
  row.className = "kv";

  const key = document.createElement("div");
  key.className = "k";
  key.textContent = label;

  const val = document.createElement("div");
  val.className = "v";
  val.textContent = value || "-";

  row.append(key, val);
  return row;
}

function mask(value) {
  if (!value) return "-";
  const text = String(value);
  if (text.length <= 10) return "已填写";
  return `${text.slice(0, 5)}••••${text.slice(-5)}`;
}

function findValue(source, keys) {
  const queue = [source];
  const visited = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);

    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(current, key) && current[key]) {
        return current[key];
      }
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return "";
}

function createInviteCode(seed) {
  let hash = 0;
  const normalized = String(seed || "gopay").trim().toLowerCase();

  for (const char of normalized) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1000000;
  }

  return `GP${String(hash).padStart(6, "0")}`;
}

function parseSessionJson(rawJson) {
  if (!rawJson.trim()) {
    throw new Error("请先粘贴 ChatGPT session JSON。");
  }

  try {
    return JSON.parse(rawJson);
  } catch {
    throw new Error("粘贴内容不是合法 JSON，请从 session 页面复制完整返回内容。");
  }
}

function setTokenStatus(text, state) {
  el.tokenStatus.textContent = text;
  el.tokenStatus.className = `token-status ${state || ""}`.trim();
}

function updateInviteShare(seed) {
  const ownInviteCode = createInviteCode(seed || inviteSeed);
  const url = new URL(window.location.href);

  url.searchParams.set("invite", ownInviteCode);
  el.ownInviteCode.textContent = ownInviteCode;
  el.shareLink.value = url.toString();
  return ownInviteCode;
}

function updateChanceView() {
  el.chanceCount.textContent = String(getStoredNumber(CHANCE_KEY, 1));
  el.bonusCount.textContent = String(getStoredNumber(BONUS_KEY, 0));
}

function refreshInviteCodeFromUrl() {
  const invite = new URLSearchParams(window.location.search).get("invite");
  if (invite && !el.inviteCode.value.trim()) {
    el.inviteCode.value = invite;
  }
}

function inspectAccessToken() {
  window.clearTimeout(tokenTimer);
  const token = el.accessToken.value.trim();

  if (!token) {
    setTokenStatus("未填写", "");
    return;
  }

  setTokenStatus("加载中", "loading");
  tokenTimer = window.setTimeout(() => {
    setTokenStatus(token.length >= 20 ? "已识别" : "长度过短", token.length >= 20 ? "ok" : "bad");
  }, 700);
}

el.accessToken.addEventListener("input", inspectAccessToken);

el.form.addEventListener("submit", (event) => {
  event.preventDefault();
  setError("");

  let session;
  try {
    session = parseSessionJson(el.sessionJson.value);
  } catch (error) {
    setError(error instanceof Error ? error.message : "提交失败。");
    el.resultCard.hidden = true;
    return;
  }

  const email = findValue(session, ["email"]);
  const accountId = findValue(session, ["account_id", "accountId", "user_id", "sub"]);
  const planType = findValue(session, ["plan_type", "planType", "account_plan_type"]);
  const jsonAccessToken = findValue(session, ["accessToken", "access_token"]);
  const pastedAccessToken = el.accessToken.value.trim();
  const accessToken = pastedAccessToken || jsonAccessToken;
  const sessionToken = findValue(session, ["sessionToken", "session_token"]);
  const orderId = el.orderId.value.trim();
  const inviteCode = el.inviteCode.value.trim();
  const currentChanceCount = getStoredNumber(CHANCE_KEY, 1);
  const inviteReward = inviteCode ? 1 : 0;

  if (currentChanceCount + inviteReward <= 0) {
    setError("免费机会已用完，请先邀请好友获得 1 次免费升级机会。");
    el.resultCard.hidden = true;
    return;
  }

  const nextChanceCount = currentChanceCount + inviteReward - 1;
  const nextCount = getStoredNumber(STORAGE_KEY, 128) + 1;
  const nextInviteCount = inviteCode ? getStoredNumber(INVITE_KEY, 0) + 1 : getStoredNumber(INVITE_KEY, 0);
  const nextBonusCount = inviteCode ? getStoredNumber(BONUS_KEY, 0) + 1 : getStoredNumber(BONUS_KEY, 0);
  const ownInviteCode = updateInviteShare(email || orderId);

  localStorage.setItem(STORAGE_KEY, String(nextCount));
  localStorage.setItem(INVITE_KEY, String(nextInviteCount));
  localStorage.setItem(BONUS_KEY, String(nextBonusCount));
  localStorage.setItem(CHANCE_KEY, String(nextChanceCount));

  el.queueCount.textContent = String(nextCount);
  el.chanceCount.textContent = String(nextChanceCount);
  el.bonusCount.textContent = String(nextBonusCount);
  el.summary.replaceChildren(
    kv("订单号", mask(orderId)),
    kv("账号邮箱", email || "未识别"),
    kv("账号 ID", mask(accountId)),
    kv("套餐", planType || "未识别"),
    kv("access", accessToken ? "已识别" : "未识别"),
    kv("session", sessionToken ? "已识别" : "未识别"),
  );
  el.inviteMessage.textContent = inviteCode
    ? `已使用邀请码 ${inviteCode}，本次奖励 1 次并已消耗 1 次，当前剩余 ${nextChanceCount} 次。`
    : nextChanceCount > 0
      ? `已消耗 1 次免费机会，当前剩余 ${nextChanceCount} 次。分享邀请链接，好友提交后你可再获得 1 次。`
      : "本次已用完免费机会，请邀请好友提交后再获得 1 次。";
  el.resultCard.hidden = false;
  el.resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

el.copyButton.addEventListener("click", async () => {
  if (!el.shareLink.value) return;

  try {
    await navigator.clipboard.writeText(el.shareLink.value);
    el.copyButton.textContent = "已复制";
    window.setTimeout(() => {
      el.copyButton.textContent = "复制邀请链接";
    }, 1400);
  } catch {
    setError("复制失败，请手动复制邀请链接。");
  }
});

refreshInviteCodeFromUrl();
updateInviteShare();
updateChanceView();
