const el = {
  form: document.getElementById("sessionForm"),
  rawJson: document.getElementById("rawJson"),
  fileName: document.getElementById("fileName"),
  confirmAuthorized: document.getElementById("confirmAuthorized"),
  serviceState: document.getElementById("serviceState"),
  parseBtn: document.getElementById("parseBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  importResetBtn: document.getElementById("importResetBtn"),
  emailValue: document.getElementById("emailValue"),
  planValue: document.getElementById("planValue"),
  accountValue: document.getElementById("accountValue"),
  expiredValue: document.getElementById("expiredValue"),
  resultTitle: document.getElementById("resultTitle"),
  resultBadge: document.getElementById("resultBadge"),
  warnings: document.getElementById("warnings"),
  resultText: document.getElementById("resultText"),
};

let parsedAuth = null;
let parsedFilename = "";
let importResetEnabled = false;

const PAGE_PATH = window.location.pathname.replace(/\/$/, "");
const BASE_PATH = PAGE_PATH.endsWith("/reset-assistant") ? "/reset-assistant" : "";

function apiPath(path) {
  return `${BASE_PATH}${path}`;
}

function setBadge(text, state) {
  el.resultBadge.textContent = text;
  el.resultBadge.className = state || "";
}

function setResult(title, badge, state, payload) {
  el.resultTitle.textContent = title;
  setBadge(badge, state);
  el.resultText.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

function setBusy(isBusy) {
  el.parseBtn.disabled = isBusy;
  el.downloadBtn.disabled = isBusy || !parsedAuth;
  el.importResetBtn.disabled = isBusy || !parsedAuth || !importResetEnabled || !el.confirmAuthorized.checked;
}

function displayWarnings(warnings) {
  el.warnings.replaceChildren();
  if (!warnings || warnings.length === 0) {
    el.warnings.hidden = true;
    return;
  }

  for (const warning of warnings) {
    const item = document.createElement("div");
    item.className = "warning";
    item.textContent = warning;
    el.warnings.append(item);
  }
  el.warnings.hidden = false;
}

function updateSummary(summary) {
  el.emailValue.textContent = summary?.email || "-";
  el.planValue.textContent = summary?.plan_type || "-";
  el.accountValue.textContent = summary?.account_id || "-";
  el.expiredValue.textContent = summary?.expired || "-";
}

function requestBody() {
  return {
    raw_json: el.rawJson.value,
    filename: el.fileName.value,
  };
}

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data);
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return data;
}

async function loadStatus() {
  try {
    const response = await fetch(apiPath("/api/reset-assistant/status"), {cache: "no-store"});
    const status = await response.json();
    importResetEnabled = Boolean(status.import_reset_enabled);
    el.serviceState.textContent = importResetEnabled ? "管理已连接" : "仅解析";
  } catch {
    importResetEnabled = false;
    el.serviceState.textContent = "状态未知";
  }
  setBusy(false);
}

el.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  parsedAuth = null;
  parsedFilename = "";
  displayWarnings([]);
  updateSummary({});
  setBusy(true);
  setResult("解析中", "working", "", "正在解析 session...");

  try {
    const data = await postJSON(apiPath("/api/reset-assistant/parse"), requestBody());
    parsedAuth = data.auth_data;
    parsedFilename = data.filename;
    updateSummary(data.summary);
    displayWarnings(data.warnings);
    setResult("已生成 CPA", "ready", "ok", {
      filename: data.filename,
      summary: data.summary,
      warnings: data.warnings,
    });
  } catch (error) {
    setResult("解析失败", "error", "bad", error instanceof Error ? error.message : "解析失败");
  } finally {
    setBusy(false);
  }
});

el.confirmAuthorized.addEventListener("change", () => setBusy(false));

el.downloadBtn.addEventListener("click", () => {
  if (!parsedAuth || !parsedFilename) return;
  const blob = new Blob([`${JSON.stringify(parsedAuth, null, 2)}\n`], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = parsedFilename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
});

el.importResetBtn.addEventListener("click", async () => {
  if (!parsedAuth) return;
  setBusy(true);
  setResult("导入中", "working", "", "正在导入 CPA auth 文件...");

  try {
    const data = await postJSON(apiPath("/api/reset-assistant/import-reset"), {
      ...requestBody(),
      confirm_authorized: el.confirmAuthorized.checked,
    });
    updateSummary(data.summary);
    setResult(data.ok ? "重置完成" : "已导入", data.ok ? "ok" : "check", data.ok ? "ok" : "", data);
  } catch (error) {
    setResult("导入失败", "error", "bad", error instanceof Error ? error.message : "导入失败");
  } finally {
    setBusy(false);
  }
});

loadStatus();
