import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const configPath = path.join(__dirname, ".minimax-token-monitor.json");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const minimaxOrigin = "https://platform.minimaxi.com";
let latestPush = null;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

async function readConfig() {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return {};
  }
}

async function writeConfig(config) {
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": minimaxOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseCookieInput(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  const headerMatch = text.match(/(?:^|\n|\r)\s*(?:-H\s+['"]?)?cookie\s*:\s*([^'"\r\n]+)/i);
  if (headerMatch) return headerMatch[1].trim();
  return text.replace(/^cookie:\s*/i, "").trim();
}

async function minimaxGet(pathname, config) {
  if (!config.cookie) {
    const error = new Error("MiniMax cookie is not configured");
    error.code = "NO_COOKIE";
    throw error;
  }

  const url = new URL(pathname, minimaxOrigin);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      cookie: config.cookie,
      referer: `${minimaxOrigin}/user-center/payment/token-plan`,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
    },
    redirect: "manual"
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 1200) };
  }

  if (!response.ok) {
    const error = new Error(`MiniMax HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function formatTimeRange(start, end, weekly = false) {
  if (!start || !end) return "";
  const opts = weekly
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }
    : { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" };
  const a = new Intl.DateTimeFormat("zh-CN", opts).format(new Date(start));
  const b = new Intl.DateTimeFormat("zh-CN", opts).format(new Date(end));
  return weekly ? `${a} - ${b}(UTC+8)` : `${a}-${b}(UTC+8)`;
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ""}后重置`;
  return `${minutes} 分钟后重置`;
}

function normalizeQuota(row, mode) {
  const isWeekly = mode === "weekly";
  const total = Number(isWeekly ? row.current_weekly_total_count : row.current_interval_total_count) || 0;
  const remaining = Number(isWeekly ? row.current_weekly_usage_count : row.current_interval_usage_count) || 0;
  const used = Math.max(0, total - remaining);
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  return {
    total,
    remaining,
    used,
    percent,
    timeRange: formatTimeRange(
      isWeekly ? row.weekly_start_time : row.start_time,
      isWeekly ? row.weekly_end_time : row.end_time,
      isWeekly
    ),
    remainsTimeText: formatRemaining(isWeekly ? row.weekly_remains_time : row.remains_time)
  };
}

function pickTextGeneration(remains) {
  const categories = Array.isArray(remains?.category_remains) ? remains.category_remains : [];
  const models = Array.isArray(remains?.model_remains) ? remains.model_remains : [];
  const category = categories.find(item => item.category === "text_generation" || item.display_name === "文本生成");
  const model = models.find(item => item.model_name === "MiniMax-M*");
  const row = category || model || null;
  if (!row) return null;

  return {
    source: category ? "category_remains" : "model_remains",
    title: category?.display_name || "文本生成",
    rawName: category?.category || model?.model_name || "",
    fiveHour: normalizeQuota(row, "fiveHour"),
    weekly: Number(row.current_weekly_total_count || 0) > 0 ? normalizeQuota(row, "weekly") : null,
    raw: row
  };
}

async function handleStatus(req, res) {
  const config = await readConfig();
  if (latestPush && Date.now() - latestPush.receivedAt < 120_000) {
    sendJson(res, 200, {
      ok: true,
      configured: Boolean(config.cookie),
      mode: "browser-push",
      fetchedAt: latestPush.fetchedAt,
      receivedAt: new Date(latestPush.receivedAt).toISOString(),
      textGeneration: latestPush.textGeneration,
      rawBaseResp: latestPush.rawBaseResp || null,
      summary: latestPush.summary || null
    });
    return;
  }

  try {
    const [remains, summary] = await Promise.all([
      minimaxGet("/v1/api/openplatform/coding_plan/remains", config),
      minimaxGet("/backend/account/token_plan/usage_summary", config).catch(error => ({ error: error.message }))
    ]);
    const textGeneration = pickTextGeneration(remains);
    sendJson(res, 200, {
      ok: true,
      configured: Boolean(config.cookie),
      mode: "server-cookie",
      fetchedAt: new Date().toISOString(),
      textGeneration,
      rawBaseResp: remains?.base_resp || null,
      summary
    });
  } catch (error) {
    sendJson(res, error.code === "NO_COOKIE" ? 428 : 502, {
      ok: false,
      configured: Boolean(config.cookie),
      error: error.message,
      detail: error.data || null
    });
  }
}

async function handlePush(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  const body = JSON.parse(await readBody(req) || "{}");
  if (!body.textGeneration) {
    sendJson(res, 400, { ok: false, error: "missing textGeneration" });
    return;
  }

  latestPush = {
    fetchedAt: body.fetchedAt || new Date().toISOString(),
    receivedAt: Date.now(),
    textGeneration: body.textGeneration,
    rawBaseResp: body.rawBaseResp || null,
    summary: body.summary || null
  };
  sendJson(res, 200, { ok: true, receivedAt: new Date(latestPush.receivedAt).toISOString() });
}

async function handleConfig(req, res) {
  if (req.method === "GET") {
    const config = await readConfig();
    sendJson(res, 200, {
      configured: Boolean(config.cookie),
      cookiePreview: config.cookie ? `${config.cookie.slice(0, 18)}...${config.cookie.slice(-8)}` : ""
    });
    return;
  }

  if (req.method === "POST") {
    const body = JSON.parse(await readBody(req) || "{}");
    const cookie = parseCookieInput(body.cookie);
    await writeConfig({ cookie, updatedAt: new Date().toISOString() });
    sendJson(res, 200, { ok: true, configured: Boolean(cookie) });
    return;
  }

  res.writeHead(405).end();
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(filePath)) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") return sendJson(res, 204, {});
    if (url.pathname === "/api/status") return await handleStatus(req, res);
    if (url.pathname === "/api/push") return await handlePush(req, res);
    if (url.pathname === "/api/config") return await handleConfig(req, res);
    return serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`MiniMax Token Plan monitor: http://${host}:${port}`);
});
