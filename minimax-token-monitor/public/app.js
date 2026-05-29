const $ = selector => document.querySelector(selector);

const nodes = {
  statusText: $("#statusText"),
  rawOutput: $("#rawOutput"),
  refreshBtn: $("#refreshBtn"),
  settingsBtn: $("#settingsBtn"),
  closeSettingsBtn: $("#closeSettingsBtn"),
  settingsPanel: $("#settingsPanel"),
  cookieInput: $("#cookieInput"),
  bookmarkletText: $("#bookmarkletText"),
  saveCookieBtn: $("#saveCookieBtn"),
  configText: $("#configText")
};

nodes.bookmarkletText.value = "javascript:(()=>{const s=document.createElement('script');s.src='http://127.0.0.1:8787/minimax-collector.js?v='+Date.now();document.body.appendChild(s)})()";

function fmtNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : "--";
}

function barColor(percent) {
  if (percent >= 95) return "#cb2634";
  if (percent >= 85) return "#f53f3f";
  if (percent >= 75) return "#f77234";
  if (percent >= 60) return "#ff9a2e";
  if (percent >= 45) return "#facd14";
  if (percent >= 30) return "#9fdb1d";
  return "#18a058";
}

function renderQuota(prefix, quota) {
  const empty = !quota || !quota.total;
  const percent = empty ? 0 : Math.max(0, Math.min(100, quota.percent));
  $(`#${prefix}Percent`).textContent = empty ? "--%" : `${percent}%`;
  $(`#${prefix}Bar`).style.width = `${percent}%`;
  $(`#${prefix}Bar`).style.backgroundColor = barColor(percent);
  $(`#${prefix}Usage`).textContent = empty ? "-- / --" : `${fmtNumber(quota.used)} / ${fmtNumber(quota.total)}`;
  $(`#${prefix}Remaining`).textContent = empty ? "--" : fmtNumber(quota.remaining);
  $(`#${prefix}Range`).textContent = quota?.timeRange || "--";
  $(`#${prefix}Reset`).textContent = quota?.remainsTimeText || "--";
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const data = await response.json();
  nodes.configText.textContent = data.configured ? `已保存：${data.cookiePreview}` : "未配置 Cookie";
}

async function refresh() {
  nodes.statusText.textContent = "刷新中...";
  const response = await fetch("/api/status");
  const data = await response.json();
  nodes.rawOutput.textContent = JSON.stringify(data, null, 2);

  if (!data.ok) {
    renderQuota("fiveHour", null);
    renderQuota("weekly", null);
    nodes.statusText.textContent = data.configured
      ? `拉取失败：${data.error}`
      : "未配置 Cookie，打开设置后粘贴 MiniMax 登录态";
    return;
  }

  const item = data.textGeneration;
  renderQuota("fiveHour", item?.fiveHour);
  renderQuota("weekly", item?.weekly);
  nodes.statusText.textContent = item
    ? `模式：${data.mode === "browser-push" ? "页面实时推送" : "本地 Cookie 拉取"}，最后刷新：${new Date(data.fetchedAt).toLocaleString()}`
    : "接口返回成功，但没有找到文本生成配额";
}

nodes.refreshBtn.addEventListener("click", refresh);
nodes.settingsBtn.addEventListener("click", () => nodes.settingsPanel.classList.remove("hidden"));
nodes.closeSettingsBtn.addEventListener("click", () => nodes.settingsPanel.classList.add("hidden"));
nodes.saveCookieBtn.addEventListener("click", async () => {
  nodes.configText.textContent = "保存中...";
  await fetch("/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cookie: nodes.cookieInput.value })
  });
  nodes.cookieInput.value = "";
  await loadConfig();
  await refresh();
});

async function init() {
  await loadConfig();
  await refresh();
  setInterval(refresh, 30_000);
}

init().catch(error => {
  nodes.statusText.textContent = `初始化失败：${error.message}`;
  nodes.rawOutput.textContent = JSON.stringify({ ok: false, error: error.message }, null, 2);
});
