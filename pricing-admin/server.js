'use strict';

const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3102);
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS = process.env.AUTH_PASS || '';
const SESSION_COOKIE = 'pa_admin';
const LEGACY_SESSION_COOKIE = 'pricing_admin_session';
const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const NEWAPI_BASE_URL = String(process.env.NEWAPI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const NEWAPI_USER_ID = String(process.env.NEWAPI_USER_ID || '1');
const NEWAPI_ACCESS_TOKEN = process.env.NEWAPI_ACCESS_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MYSQL_HOST = process.env.MYSQL_HOST || '';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'new-api';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

const MAX_BODY_BYTES = 1024 * 1024;
const NEWAPI_TIMEOUT_MS = 12000;
const MYSQL_TIMEOUT_MS = 15000;
const SESSION_FILE = path.join(DATA_DIR, 'admin-sessions.json');

const MODEL_KEYS = [
  'ModelRatio',
  'ModelPrice',
  'CompletionRatio',
  'CacheRatio',
  'CreateCacheRatio',
  'ImageRatio',
  'AudioRatio',
  'AudioCompletionRatio',
  'billing_setting.billing_mode',
  'billing_setting.billing_expr'
];

const GROUP_KEYS = [
  'GroupRatio',
  'TopupGroupRatio',
  'GroupGroupRatio'
];

const SNAPSHOT_KEYS = [...MODEL_KEYS, ...GROUP_KEYS, 'SelfUseModeEnabled'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

let mysqlPool = null;

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(text);
}

function safeError(error) {
  let message = String(error && error.message ? error.message : error || 'unknown error');
  if (NEWAPI_ACCESS_TOKEN) {
    message = message.replaceAll(NEWAPI_ACCESS_TOKEN, '[masked-token]');
  }
  if (MYSQL_PASSWORD) {
    message = message.replaceAll(MYSQL_PASSWORD, '[masked-mysql-password]');
  }
  return message.replace(/Bearer\s+[A-Za-z0-9._=\-+/]{12,}/gi, 'Bearer [masked-token]');
}

function timingEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function validCredentials(user, pass) {
  if (!AUTH_PASS) return false;
  user = String(user || '');
  pass = String(pass || '');
  if (user.length !== AUTH_USER.length || pass.length !== AUTH_PASS.length) return false;
  return timingEqualText(user, AUTH_USER) && timingEqualText(pass, AUTH_PASS);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function sessionCookie(id) {
  let cookie = `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
  if (COOKIE_SECURE) cookie += '; Secure';
  return cookie;
}

function clearCookie(name) {
  let cookie = `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  if (COOKIE_SECURE) cookie += '; Secure';
  return cookie;
}

async function loadSessionStore() {
  try {
    const raw = await fs.readFile(SESSION_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.sessions ? parsed : { sessions: {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { sessions: {} };
    throw error;
  }
}

async function saveSessionStore(store) {
  await ensureDataDirs();
  await fs.writeFile(SESSION_FILE, JSON.stringify(store, null, 2));
}

async function createAdminSession() {
  const id = crypto.randomBytes(24).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const store = await loadSessionStore();
  store.sessions[id] = {
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS
  };
  await saveSessionStore(store);
  return sessionCookie(id);
}

async function destroyAdminSession(req) {
  const cookies = parseCookies(req);
  const id = cookies[SESSION_COOKIE];
  if (id) {
    const store = await loadSessionStore();
    delete store.sessions[id];
    await saveSessionStore(store);
  }
  return [clearCookie(SESSION_COOKIE), clearCookie(LEGACY_SESSION_COOKIE)];
}

async function validSession(req) {
  const id = parseCookies(req)[SESSION_COOKIE];
  if (!id) return false;

  const store = await loadSessionStore();
  const session = store.sessions[id];
  if (!session) return false;

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(session.expiresAt)) || Number(session.expiresAt) < now) {
    delete store.sessions[id];
    await saveSessionStore(store);
    return false;
  }

  return true;
}

function basicAuthed(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;

  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }

  const split = decoded.indexOf(':');
  if (split < 0) return false;

  return validCredentials(decoded.slice(0, split), decoded.slice(split + 1));
}

async function isAuthed(req) {
  return (await validSession(req)) || basicAuthed(req);
}

async function requireAuth(req, res) {
  if (await isAuthed(req)) return true;
  sendJson(res, 401, { ok: false, error: 'Authentication required' });
  return false;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('invalid json body');
    error.status = 400;
    throw error;
  }
}

function unwrapApiPayload(payload) {
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'success') && payload.success === false) {
    throw new Error(payload.message || 'NewAPI request failed');
  }
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data;
  }
  return payload;
}

async function newapiRequest(method, pathname, body) {
  if (!NEWAPI_ACCESS_TOKEN) {
    throw new Error('NEWAPI_ACCESS_TOKEN is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEWAPI_TIMEOUT_MS);

  try {
    const response = await fetch(`${NEWAPI_BASE_URL}${pathname}`, {
      method,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NEWAPI_ACCESS_TOKEN}`,
        'New-Api-User': NEWAPI_USER_ID
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    let payload = text;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const message = payload && typeof payload === 'object' ? payload.message || JSON.stringify(payload) : String(payload || response.statusText);
      throw new Error(`NewAPI ${method} ${pathname} failed: ${response.status} ${message}`);
    }

    return unwrapApiPayload(payload);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOptionRows(data) {
  if (Array.isArray(data)) {
    return data.map((row) => ({
      key: String(row.key || row.name || ''),
      value: row.value === undefined || row.value === null ? '' : String(row.value)
    })).filter((row) => row.key);
  }

  if (data && typeof data === 'object') {
    return Object.entries(data).map(([key, value]) => ({
      key,
      value: value === undefined || value === null ? '' : String(value)
    }));
  }

  return [];
}

async function fetchOptionMap() {
  const rows = normalizeOptionRows(await newapiRequest('GET', '/api/option/'));
  const optionMap = {};
  for (const row of rows) {
    optionMap[row.key] = row.value;
  }
  return optionMap;
}

function parseJsonMap(raw) {
  if (raw === undefined || raw === null || raw === '') return {};
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return { ...parsed };
  } catch {
    return {};
  }
}

function mysqlConfigured() {
  return Boolean(MYSQL_HOST && MYSQL_USER && MYSQL_DATABASE);
}

async function getMysqlPool() {
  if (!mysqlConfigured()) {
    throw new Error('MySQL is not configured for hard model disable');
  }

  if (mysqlPool) return mysqlPool;

  const mysql = require('mysql2/promise');
  mysqlPool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 4,
    namedPlaceholders: false,
    enableKeepAlive: true
  });
  return mysqlPool;
}

async function mysqlRows(query, params = []) {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(query, params);
  return rows;
}

function splitModels(models) {
  return String(models || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasModel(models, model) {
  return splitModels(models).includes(model);
}

async function fetchChannelsByModel(model) {
  const rows = await mysqlRows(`
    SELECT
      id,
      COALESCE(name, '') AS name,
      COALESCE(status, 0) AS status,
      COALESCE(models, '') AS models,
      COALESCE(\`group\`, '') AS \`group\`,
      COALESCE(type, 0) AS type,
      COALESCE(tag, '') AS tag
    FROM channels
    WHERE models LIKE ?
  `, [`%${model}%`]);
  return rows
    .filter((row) => hasModel(row.models, model))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

async function fetchChannelsByIds(ids) {
  const cleanIds = [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!cleanIds.length) return [];
  const placeholders = cleanIds.map(() => '?').join(',');
  return mysqlRows(`
    SELECT
      id,
      COALESCE(name, '') AS name,
      COALESCE(status, 0) AS status,
      COALESCE(models, '') AS models,
      COALESCE(\`group\`, '') AS \`group\`,
      COALESCE(type, 0) AS type,
      COALESCE(tag, '') AS tag
    FROM channels
    WHERE id IN (${placeholders})
  `, cleanIds);
}

async function updateChannelsForDisabledModel(model, channels) {
  if (!channels.length) return [];
  const changed = [];
  const pool = await getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    for (const channel of channels) {
      const beforeModels = splitModels(channel.models);
      const afterModels = beforeModels.filter((item) => item !== model);
      if (afterModels.length === beforeModels.length) continue;

      const nextModels = afterModels.join(',');
      const nextStatus = afterModels.length === 0 ? 2 : Number(channel.status || 1);
      await connection.query('UPDATE channels SET models = ?, status = ? WHERE id = ?', [
        nextModels,
        nextStatus,
        Number(channel.id)
      ]);
      changed.push({
        id: Number(channel.id),
        name: channel.name || '',
        beforeModels,
        afterModels,
        beforeStatus: Number(channel.status || 0),
        afterStatus: nextStatus
      });
    }

    await connection.query('DELETE FROM abilities WHERE model = ?', [model]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return changed;
}

async function restoreChannels(channels) {
  const rows = (channels || []).filter((channel) => Number.isInteger(Number(channel.id)));
  if (!rows.length) return [];

  const pool = await getMysqlPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const channel of rows) {
      await connection.query('UPDATE channels SET models = ?, status = ? WHERE id = ?', [
        channel.models || '',
        Number(channel.status || 2),
        Number(channel.id)
      ]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return rows.map((row) => Number(row.id));
}

async function enableModelInChannels(model, backupChannels) {
  const rows = (backupChannels || []).filter((channel) => Number.isInteger(Number(channel.id)) && hasModel(channel.models, model));
  if (!rows.length) return [];

  const currentRows = await fetchChannelsByIds(rows.map((row) => row.id));
  const currentById = new Map(currentRows.map((row) => [Number(row.id), row]));
  const pool = await getMysqlPool();
  const connection = await pool.getConnection();
  const changed = [];

  try {
    await connection.beginTransaction();
    for (const backup of rows) {
      const current = currentById.get(Number(backup.id));
      if (!current) continue;

      const currentModels = splitModels(current.models);
      if (currentModels.includes(model)) continue;

      const backupModels = splitModels(backup.models);
      const nextModels = [];
      for (const item of backupModels) {
        if ((item === model || currentModels.includes(item)) && !nextModels.includes(item)) {
          nextModels.push(item);
        }
      }
      for (const item of currentModels) {
        if (!nextModels.includes(item)) nextModels.push(item);
      }

      let nextStatus = Number(current.status || 0);
      if (currentModels.length === 0 && Number(backup.status || 0) > 0) {
        nextStatus = Number(backup.status);
      }

      await connection.query('UPDATE channels SET models = ?, status = ? WHERE id = ?', [
        nextModels.join(','),
        nextStatus,
        Number(backup.id)
      ]);
      changed.push({
        id: Number(backup.id),
        name: backup.name || current.name || '',
        beforeModels: currentModels,
        afterModels: nextModels,
        beforeStatus: Number(current.status || 0),
        afterStatus: nextStatus
      });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return changed;
}

function parseBoolean(raw) {
  if (typeof raw === 'boolean') return raw;
  return ['true', '1', 'yes', 'on'].includes(String(raw || '').toLowerCase());
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireNumber(value, label) {
  const parsed = numberOrNull(value);
  if (parsed === null || parsed < 0) {
    const error = new Error(`${label} must be a non-negative number`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function requireName(value, label) {
  const name = String(value || '').trim();
  if (!name || name.length > 255 || /[\r\n]/.test(name)) {
    const error = new Error(`${label} is invalid`);
    error.status = 400;
    throw error;
  }
  return name;
}

function sortedKeys(map) {
  return Object.keys(map || {}).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

async function fetchEnabledModels() {
  try {
    const data = await newapiRequest('GET', '/api/channel/models_enabled');
    if (Array.isArray(data)) return data.map(String).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (data && Array.isArray(data.models)) return data.models.map(String).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch {
    return [];
  }
  return [];
}

function groupListFromValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function pickValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return null;
}

function normalizePricingRow(row) {
  if (!row || typeof row !== 'object') return null;
  const model = String(pickValue(row, ['model_name', 'modelName', 'model', 'name']) || '').trim();
  if (!model) return null;

  const groups = [
    ...groupListFromValue(row.enable_group),
    ...groupListFromValue(row.enable_groups),
    ...groupListFromValue(row.groups)
  ];

  return {
    model,
    modelRatio: pickValue(row, ['model_ratio', 'modelRatio', 'ratio']),
    modelPrice: pickValue(row, ['model_price', 'modelPrice', 'price']),
    completionRatio: pickValue(row, ['completion_ratio', 'completionRatio']),
    cacheRatio: pickValue(row, ['cache_ratio', 'cacheRatio']),
    createCacheRatio: pickValue(row, ['create_cache_ratio', 'createCacheRatio']),
    imageRatio: pickValue(row, ['image_ratio', 'imageRatio']),
    audioRatio: pickValue(row, ['audio_ratio', 'audioRatio']),
    audioCompletionRatio: pickValue(row, ['audio_completion_ratio', 'audioCompletionRatio']),
    billingMode: pickValue(row, ['billing_mode', 'billingMode']),
    billingExpr: pickValue(row, ['billing_expr', 'billingExpr']),
    quotaType: pickValue(row, ['quota_type', 'quotaType']),
    vendorId: pickValue(row, ['vendor_id', 'vendorId']),
    ownerBy: pickValue(row, ['owner_by', 'ownerBy']),
    groups: [...new Set(groups)].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    endpointTypes: [
      ...groupListFromValue(row.supported_endpoint_type),
      ...groupListFromValue(row.supported_endpoint_types),
      ...groupListFromValue(row.endpoints)
    ]
  };
}

function derivePricingIndex(rows) {
  const index = {
    byModel: {},
    byLowerModel: {},
    rows: []
  };
  if (!Array.isArray(rows)) return index;

  for (const row of rows) {
    const normalized = normalizePricingRow(row);
    if (!normalized) continue;
    index.rows.push(normalized);
    index.byModel[normalized.model] = normalized;
    const lower = normalized.model.toLowerCase();
    if (!index.byLowerModel[lower]) index.byLowerModel[lower] = normalized;
  }
  return index;
}

async function fetchPricingIndex() {
  try {
    return derivePricingIndex(await newapiRequest('GET', '/api/pricing'));
  } catch {
    return derivePricingIndex([]);
  }
}

function livePricingForModel(model, pricingIndex) {
  return pricingIndex.byModel[model] || pricingIndex.byLowerModel[String(model).toLowerCase()] || null;
}

function modelStatus(model, maps, pricingIndex) {
  if (Object.prototype.hasOwnProperty.call(maps.ModelPrice, model)) return 'fixed';
  if (Object.prototype.hasOwnProperty.call(maps.ModelRatio, model)) return 'ratio';
  if (Object.prototype.hasOwnProperty.call(maps['billing_setting.billing_expr'], model)) return 'expression';
  if (Object.prototype.hasOwnProperty.call(maps['billing_setting.billing_mode'], model)) return 'custom';
  if (livePricingForModel(model, pricingIndex)) return 'live';
  return 'unpriced';
}

function valueFromConfigOrLive(configValue, liveValue) {
  return configValue ?? liveValue ?? null;
}

function numericValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUsd(value) {
  const parsed = numericValue(value);
  if (parsed === null) return null;
  const fixed = Math.abs(parsed) >= 1 ? parsed.toFixed(4) : parsed.toFixed(6);
  return `$${fixed.replace(/\.?0+$/, '')}`;
}

function tokenPriceParts(livePricing, group, groupRatioMap) {
  const groupRatio = numericValue(groupRatioMap[group]) ?? 1;
  const quotaType = numericValue(livePricing.quotaType) ?? 0;
  const modelRatio = numericValue(livePricing.modelRatio) ?? 0;
  const modelPrice = numericValue(livePricing.modelPrice) ?? 0;
  const completionRatio = numericValue(livePricing.completionRatio) ?? 1;
  const cacheRatio = numericValue(livePricing.cacheRatio);
  const createCacheRatio = numericValue(livePricing.createCacheRatio);
  const imageRatio = numericValue(livePricing.imageRatio);
  const audioRatio = numericValue(livePricing.audioRatio);
  const audioCompletionRatio = numericValue(livePricing.audioCompletionRatio);

  if (quotaType === 1) {
    return {
      group,
      groupRatio,
      quotaType,
      fixed: formatUsd(modelPrice * groupRatio)
    };
  }

  const input = modelRatio * 2 * groupRatio;
  const audioInput = audioRatio === null ? null : input * audioRatio;
  return {
    group,
    groupRatio,
    quotaType,
    input: formatUsd(input),
    output: formatUsd(input * completionRatio),
    cache: cacheRatio === null ? null : formatUsd(input * cacheRatio),
    createCache: createCacheRatio === null ? null : formatUsd(input * createCacheRatio),
    image: imageRatio === null ? null : formatUsd(input * imageRatio),
    audioInput: audioInput === null ? null : formatUsd(audioInput),
    audioOutput: audioInput === null || audioCompletionRatio === null ? null : formatUsd(audioInput * audioCompletionRatio)
  };
}

function displayPricingForModel(livePricing, groupRatioMap) {
  if (!livePricing) return null;
  if (livePricing.billingMode === 'tiered_expr' && livePricing.billingExpr) {
    return {
      mode: 'dynamic',
      groups: [],
      primary: null
    };
  }

  const groups = livePricing.groups && livePricing.groups.length ? livePricing.groups : ['default'];
  const prices = groups.map((group) => tokenPriceParts(livePricing, group, groupRatioMap));
  const primary = prices.reduce((best, item) => {
    if (!best) return item;
    return item.groupRatio < best.groupRatio ? item : best;
  }, null);

  return {
    mode: (numericValue(livePricing.quotaType) ?? 0) === 1 ? 'request' : 'token',
    primary,
    groups: prices
  };
}

function effectivePricingForModel(model, maps, livePricing) {
  if (!livePricing) return null;
  const hasFixedPrice = Object.prototype.hasOwnProperty.call(maps.ModelPrice, model);
  return {
    ...livePricing,
    quotaType: hasFixedPrice ? 1 : livePricing.quotaType,
    modelRatio: maps.ModelRatio[model] ?? livePricing.modelRatio,
    modelPrice: hasFixedPrice ? maps.ModelPrice[model] : livePricing.modelPrice,
    completionRatio: maps.CompletionRatio[model] ?? livePricing.completionRatio,
    cacheRatio: maps.CacheRatio[model] ?? livePricing.cacheRatio,
    createCacheRatio: maps.CreateCacheRatio[model] ?? livePricing.createCacheRatio,
    imageRatio: maps.ImageRatio[model] ?? livePricing.imageRatio,
    audioRatio: maps.AudioRatio[model] ?? livePricing.audioRatio,
    audioCompletionRatio: maps.AudioCompletionRatio[model] ?? livePricing.audioCompletionRatio,
    billingMode: maps['billing_setting.billing_mode'][model] ?? livePricing.billingMode,
    billingExpr: maps['billing_setting.billing_expr'][model] ?? livePricing.billingExpr
  };
}

function buildModels(enabledModels, maps, pricingIndex) {
  const names = new Set(enabledModels);
  for (const key of MODEL_KEYS) {
    for (const model of Object.keys(maps[key] || {})) names.add(model);
  }
  for (const model of Object.keys(pricingIndex.byModel || {})) names.add(model);

  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN')).map((model) => {
    const livePricing = livePricingForModel(model, pricingIndex);
    const effectivePricing = effectivePricingForModel(model, maps, livePricing);
    const status = modelStatus(model, maps, pricingIndex);
    const displayPricing = displayPricingForModel(effectivePricing, maps.GroupRatio || {});
    const liveFixedPrice = (numericValue(effectivePricing?.quotaType) ?? 0) === 1 ? effectivePricing?.modelPrice : null;
    return {
      model,
      enabled: enabledModels.includes(model),
      status,
      ratio: valueFromConfigOrLive(maps.ModelRatio[model], effectivePricing?.modelRatio),
      price: valueFromConfigOrLive(maps.ModelPrice[model], liveFixedPrice),
      completionRatio: valueFromConfigOrLive(maps.CompletionRatio[model], effectivePricing?.completionRatio),
      cacheRatio: valueFromConfigOrLive(maps.CacheRatio[model], effectivePricing?.cacheRatio),
      createCacheRatio: valueFromConfigOrLive(maps.CreateCacheRatio[model], effectivePricing?.createCacheRatio),
      imageRatio: valueFromConfigOrLive(maps.ImageRatio[model], effectivePricing?.imageRatio),
      audioRatio: valueFromConfigOrLive(maps.AudioRatio[model], effectivePricing?.audioRatio),
      audioCompletionRatio: valueFromConfigOrLive(maps.AudioCompletionRatio[model], effectivePricing?.audioCompletionRatio),
      billingMode: valueFromConfigOrLive(maps['billing_setting.billing_mode'][model], effectivePricing?.billingMode),
      billingExpr: valueFromConfigOrLive(maps['billing_setting.billing_expr'][model], effectivePricing?.billingExpr),
      configured: {
        ratio: maps.ModelRatio[model] ?? null,
        price: maps.ModelPrice[model] ?? null,
        completionRatio: maps.CompletionRatio[model] ?? null,
        cacheRatio: maps.CacheRatio[model] ?? null,
        createCacheRatio: maps.CreateCacheRatio[model] ?? null,
        imageRatio: maps.ImageRatio[model] ?? null,
        audioRatio: maps.AudioRatio[model] ?? null,
        audioCompletionRatio: maps.AudioCompletionRatio[model] ?? null,
        billingMode: maps['billing_setting.billing_mode'][model] ?? null,
        billingExpr: maps['billing_setting.billing_expr'][model] ?? null
      },
      livePricing: livePricing ? {
        ...livePricing,
        matchedByCaseFold: livePricing.model !== model
      } : null,
      effectivePricing,
      displayPricing,
      groups: effectivePricing?.groups || []
    };
  });
}

function buildGroups(maps) {
  const names = new Set();
  for (const key of GROUP_KEYS) {
    for (const group of Object.keys(maps[key] || {})) names.add(group);
  }

  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN')).map((group) => ({
    group,
    ratio: maps.GroupRatio[group] ?? null,
    topupRatio: maps.TopupGroupRatio[group] ?? null,
    groupGroupRatio: maps.GroupGroupRatio[group] ?? null
  }));
}

async function ensureDataDirs() {
  await fs.mkdir(path.join(DATA_DIR, 'backups'), { recursive: true });
}

function stamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function actionSlug(action) {
  return String(action || 'change').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'change';
}

async function createBackup(action, optionMap, extra = {}) {
  await ensureDataDirs();
  const id = `${stamp()}-${actionSlug(action)}-${crypto.randomBytes(3).toString('hex')}.json`;
  const file = path.join(DATA_DIR, 'backups', id);
  const snapshot = {};
  for (const key of SNAPSHOT_KEYS) {
    snapshot[key] = optionMap[key] === undefined ? '' : optionMap[key];
  }
  await fs.writeFile(file, JSON.stringify({
    id,
    action,
    createdAt: new Date().toISOString(),
    newapiBaseUrl: NEWAPI_BASE_URL,
    options: snapshot,
    ...extra
  }, null, 2));
  return id;
}

async function appendAudit(entry) {
  await ensureDataDirs();
  await fs.appendFile(path.join(DATA_DIR, 'audit.jsonl'), `${JSON.stringify({
    at: new Date().toISOString(),
    ...entry
  })}\n`);
}

async function listBackups() {
  await ensureDataDirs();
  const names = await fs.readdir(path.join(DATA_DIR, 'backups'));
  const backups = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort().reverse().slice(0, 80)) {
    try {
      const raw = await fs.readFile(path.join(DATA_DIR, 'backups', name), 'utf8');
      const parsed = JSON.parse(raw);
      backups.push({
        id: name,
        operation: parsed.operation || '',
        model: parsed.model || '',
        action: parsed.action || '',
        createdAt: parsed.createdAt || '',
        keys: parsed.options ? Object.keys(parsed.options).length : 0,
        channels: Array.isArray(parsed.channels) ? parsed.channels.length : 0
      });
    } catch {
      backups.push({ id: name, operation: '', model: '', action: 'unreadable', createdAt: '', keys: 0, channels: 0 });
    }
  }
  return backups;
}

async function loadState() {
  const [optionMap, enabledModels, pricingIndex, backups] = await Promise.all([
    fetchOptionMap(),
    fetchEnabledModels(),
    fetchPricingIndex(),
    listBackups()
  ]);

  const maps = {};
  for (const key of [...MODEL_KEYS, ...GROUP_KEYS]) {
    maps[key] = parseJsonMap(optionMap[key]);
  }

  const models = buildModels(enabledModels, maps, pricingIndex);
  const groups = buildGroups(maps);
  const unpriced = models.filter((row) => row.enabled && row.status === 'unpriced');
  const deletedHistory = backups.filter((row) => row.operation === 'disable_model' && row.model);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    newapiBaseUrl: NEWAPI_BASE_URL,
    mysqlConfigured: mysqlConfigured(),
    selfUseModeEnabled: parseBoolean(optionMap.SelfUseModeEnabled),
    stats: {
      enabledModels: enabledModels.length,
      configuredModels: models.filter((row) => row.status !== 'unpriced').length,
      unpricedModels: unpriced.length,
      groups: groups.length,
      backups: backups.length
    },
    models,
    unpriced,
    groups,
    deletedHistory,
    realtimePricing: {
      models: pricingIndex.rows.length
    },
    maps,
    backups
  };
}

async function updateOption(key, value) {
  const result = await newapiRequest('PUT', '/api/option/', {
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value)
  });
  return result;
}

async function writeOptions(action, optionMap, changed, extra = {}) {
  const backupId = await createBackup(action, optionMap, extra);
  const changedKeys = Object.keys(changed);

  for (const key of changedKeys) {
    await updateOption(key, changed[key]);
  }

  await appendAudit({
    action,
    backupId,
    changedKeys
  });

  return backupId;
}

async function fixChannelAbilities() {
  return newapiRequest('POST', '/api/channel/fix', {});
}

function cleanModelMaps(optionMap, model) {
  const maps = {};
  for (const key of MODEL_KEYS) maps[key] = parseJsonMap(optionMap[key]);
  for (const key of MODEL_KEYS) delete maps[key][model];

  const changed = {};
  for (const key of MODEL_KEYS) changed[key] = JSON.stringify(maps[key]);
  return changed;
}

function restoreModelMaps(currentOptionMap, backupOptions, model) {
  const changed = {};
  for (const key of MODEL_KEYS) {
    const current = parseJsonMap(currentOptionMap[key]);
    const backup = parseJsonMap(backupOptions ? backupOptions[key] : undefined);
    if (Object.prototype.hasOwnProperty.call(backup, model)) {
      current[model] = backup[model];
    } else {
      delete current[model];
    }
    changed[key] = JSON.stringify(current);
  }
  return changed;
}

function validateBackupId(backupId) {
  const id = requireName(backupId, 'backupId');
  if (!/^[A-Za-z0-9._-]+\.json$/.test(id)) {
    const error = new Error('backupId is invalid');
    error.status = 400;
    throw error;
  }
  return id;
}

async function loadBackup(backupId) {
  const id = validateBackupId(backupId);
  const raw = await fs.readFile(path.join(DATA_DIR, 'backups', id), 'utf8');
  const backup = JSON.parse(raw);
  backup.id = backup.id || id;
  return backup;
}

async function findLatestDisableBackup(model) {
  await ensureDataDirs();
  const names = (await fs.readdir(path.join(DATA_DIR, 'backups')))
    .filter((item) => item.endsWith('.json'))
    .sort()
    .reverse();

  for (const name of names) {
    try {
      const backup = await loadBackup(name);
      if (backup.operation === 'disable_model' && backup.model === model && Array.isArray(backup.channels)) {
        return backup;
      }
    } catch {
      // Ignore unreadable backup files while looking for a usable history entry.
    }
  }
  return null;
}

function setOptionalMapNumber(maps, key, model, value) {
  if (value === undefined) return;
  const parsed = numberOrNull(value);
  if (parsed === null) {
    delete maps[key][model];
    return;
  }
  if (parsed < 0) {
    const error = new Error(`${key} must be a non-negative number`);
    error.status = 400;
    throw error;
  }
  maps[key][model] = parsed;
}

function setOptionalMapString(maps, key, model, value) {
  if (value === undefined) return;
  const text = String(value || '').trim();
  if (!text) {
    delete maps[key][model];
    return;
  }
  maps[key][model] = text;
}

async function upsertModel(body) {
  const model = requireName(body.model, 'model');
  const pricingType = String(body.pricingType || body.type || 'ratio');
  const value = requireNumber(body.value, 'price value');
  const optionMap = await fetchOptionMap();
  const maps = {};
  for (const key of MODEL_KEYS) maps[key] = parseJsonMap(optionMap[key]);

  if (pricingType === 'fixed') {
    maps.ModelPrice[model] = value;
    delete maps.ModelRatio[model];
    delete maps['billing_setting.billing_mode'][model];
    delete maps['billing_setting.billing_expr'][model];
  } else if (pricingType === 'ratio') {
    maps.ModelRatio[model] = value;
    delete maps.ModelPrice[model];
    delete maps['billing_setting.billing_mode'][model];
    delete maps['billing_setting.billing_expr'][model];
  } else {
    const error = new Error('pricingType must be ratio or fixed');
    error.status = 400;
    throw error;
  }

  setOptionalMapNumber(maps, 'CompletionRatio', model, body.completionRatio);
  setOptionalMapNumber(maps, 'CacheRatio', model, body.cacheRatio);
  setOptionalMapNumber(maps, 'CreateCacheRatio', model, body.createCacheRatio);
  setOptionalMapNumber(maps, 'ImageRatio', model, body.imageRatio);
  setOptionalMapNumber(maps, 'AudioRatio', model, body.audioRatio);
  setOptionalMapNumber(maps, 'AudioCompletionRatio', model, body.audioCompletionRatio);
  setOptionalMapString(maps, 'billing_setting.billing_mode', model, body.billingMode);
  setOptionalMapString(maps, 'billing_setting.billing_expr', model, body.billingExpr);

  const changed = {};
  for (const key of MODEL_KEYS) {
    changed[key] = JSON.stringify(maps[key]);
  }

  const backupId = await writeOptions(`model-${pricingType}-${model}`, optionMap, changed);
  return { backupId, state: await loadState() };
}

async function deleteModel(body) {
  const model = requireName(body.model, 'model');
  const optionMap = await fetchOptionMap();
  const changed = cleanModelMaps(optionMap, model);
  const backupId = await writeOptions(`model-price-delete-${model}`, optionMap, changed);
  return { backupId, state: await loadState() };
}

async function modelBindings(model) {
  const name = requireName(model, 'model');
  const channels = await fetchChannelsByModel(name);
  return {
    model: name,
    count: channels.length,
    channels: channels.map((channel) => ({
      id: Number(channel.id),
      name: channel.name || '',
      status: Number(channel.status || 0),
      group: channel.group || '',
      type: Number(channel.type || 0),
      tag: channel.tag || '',
      modelCount: splitModels(channel.models).length
    }))
  };
}

async function disableModel(body) {
  const model = requireName(body.model, 'model');
  const [optionMap, channelsBefore] = await Promise.all([
    fetchOptionMap(),
    fetchChannelsByModel(model)
  ]);

  const changedOptions = cleanModelMaps(optionMap, model);
  const backupChannels = channelsBefore.map((channel) => ({
    id: Number(channel.id),
    name: channel.name || '',
    status: Number(channel.status || 0),
    models: channel.models || '',
    group: channel.group || '',
    type: Number(channel.type || 0),
    tag: channel.tag || ''
  }));

  const backupId = await createBackup(`model-disable-${model}`, optionMap, {
    operation: 'disable_model',
    model,
    channels: backupChannels
  });

  const channelChanges = await updateChannelsForDisabledModel(model, channelsBefore);
  for (const [key, value] of Object.entries(changedOptions)) {
    await updateOption(key, value);
  }
  const fixResult = await fixChannelAbilities();

  await appendAudit({
    action: 'model-disable',
    model,
    backupId,
    changedKeys: Object.keys(changedOptions),
    affectedChannels: channelChanges.map((channel) => channel.id),
    fixResult
  });

  return {
    backupId,
    affectedChannels: channelChanges,
    fixResult,
    state: await loadState()
  };
}

async function enableModel(body) {
  const model = requireName(body.model, 'model');
  const backup = body.backupId ? await loadBackup(body.backupId) : await findLatestDisableBackup(model);
  if (!backup || backup.operation !== 'disable_model' || backup.model !== model || !Array.isArray(backup.channels)) {
    const error = new Error(`No delete history found for model ${model}`);
    error.status = 404;
    throw error;
  }

  const [currentOptions, currentChannels] = await Promise.all([
    fetchOptionMap(),
    fetchChannelsByIds(backup.channels.map((channel) => channel.id))
  ]);
  const safetyBackupId = await createBackup(`before-enable-${model}`, currentOptions, {
    operation: 'before_enable_model',
    model,
    channels: currentChannels
  });

  const changedOptions = restoreModelMaps(currentOptions, backup.options, model);
  const channelChanges = await enableModelInChannels(model, backup.channels);
  for (const [key, value] of Object.entries(changedOptions)) {
    await updateOption(key, value);
  }
  const fixResult = await fixChannelAbilities();

  await appendAudit({
    action: 'model-enable',
    model,
    backupId: safetyBackupId,
    restoredFrom: backup.id,
    changedKeys: Object.keys(changedOptions),
    affectedChannels: channelChanges.map((channel) => channel.id),
    fixResult
  });

  return {
    backupId: safetyBackupId,
    restoredFrom: backup.id,
    affectedChannels: channelChanges,
    fixResult,
    state: await loadState()
  };
}

async function upsertGroup(body) {
  const group = requireName(body.group, 'group');
  const ratio = requireNumber(body.ratio, 'group ratio');
  const optionMap = await fetchOptionMap();
  const groupRatio = parseJsonMap(optionMap.GroupRatio);
  groupRatio[group] = ratio;

  const backupId = await writeOptions(`group-ratio-${group}`, optionMap, {
    GroupRatio: JSON.stringify(groupRatio)
  });
  return { backupId, state: await loadState() };
}

async function deleteGroup(body) {
  const group = requireName(body.group, 'group');
  const optionMap = await fetchOptionMap();
  const groupRatio = parseJsonMap(optionMap.GroupRatio);
  delete groupRatio[group];

  const backupId = await writeOptions(`group-delete-${group}`, optionMap, {
    GroupRatio: JSON.stringify(groupRatio)
  });
  return { backupId, state: await loadState() };
}

async function rollbackBackup(body) {
  const backupId = validateBackupId(body.backupId);
  const backup = await loadBackup(backupId);
  if (!backup.options || typeof backup.options !== 'object') {
    const error = new Error('backup file has no options');
    error.status = 400;
    throw error;
  }

  const current = await fetchOptionMap();
  let currentChannels = [];
  if (Array.isArray(backup.channels) && backup.channels.length) {
    currentChannels = await fetchChannelsByIds(backup.channels.map((channel) => channel.id));
  }
  const safetyBackupId = await createBackup(`before-rollback-${backupId}`, current, {
    channels: currentChannels
  });
  const changed = {};
  for (const key of SNAPSHOT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(backup.options, key)) {
      changed[key] = backup.options[key];
    }
  }

  for (const [key, value] of Object.entries(changed)) {
    await updateOption(key, value);
  }

  let restoredChannels = [];
  let fixResult = null;
  if (Array.isArray(backup.channels) && backup.channels.length) {
    restoredChannels = await restoreChannels(backup.channels);
    fixResult = await fixChannelAbilities();
  }

  await appendAudit({
    action: 'rollback',
    backupId: safetyBackupId,
    restoredFrom: backupId,
    changedKeys: Object.keys(changed),
    restoredChannels,
    fixResult
  });

  return { backupId: safetyBackupId, restoredFrom: backupId, restoredChannels, fixResult, state: await loadState() };
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/session') {
    const authenticated = await isAuthed(req);
    sendJson(res, 200, {
      ok: true,
      success: true,
      authenticated,
      user: authenticated ? AUTH_USER : ''
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const body = await readBody(req);
    if (!validCredentials(body.username, body.password)) {
      sendJson(res, 401, { ok: false, success: false, error: '用户名或密码错误', message: '用户名或密码错误' });
      return;
    }
    sendJson(res, 200, { ok: true, success: true, user: AUTH_USER }, {
      'Set-Cookie': await createAdminSession()
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    sendJson(res, 200, { ok: true, success: true }, {
      'Set-Cookie': await destroyAdminSession(req)
    });
    return;
  }

  if (!(await requireAuth(req, res))) return;

  if (req.method === 'GET' && url.pathname === '/api/state') {
    sendJson(res, 200, await loadState());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      newapiBaseUrl: NEWAPI_BASE_URL,
      authConfigured: Boolean(AUTH_PASS),
      newapiTokenConfigured: Boolean(NEWAPI_ACCESS_TOKEN),
      mysqlConfigured: mysqlConfigured()
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/models/bindings') {
    sendJson(res, 200, { ok: true, ...(await modelBindings(url.searchParams.get('model'))) });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  const body = await readBody(req);
  if (url.pathname === '/api/models/upsert') {
    sendJson(res, 200, { ok: true, ...(await upsertModel(body)) });
    return;
  }
  if (url.pathname === '/api/models/delete') {
    sendJson(res, 200, { ok: true, ...(await deleteModel(body)) });
    return;
  }
  if (url.pathname === '/api/models/disable') {
    sendJson(res, 200, { ok: true, ...(await disableModel(body)) });
    return;
  }
  if (url.pathname === '/api/models/enable') {
    sendJson(res, 200, { ok: true, ...(await enableModel(body)) });
    return;
  }
  if (url.pathname === '/api/groups/upsert') {
    sendJson(res, 200, { ok: true, ...(await upsertGroup(body)) });
    return;
  }
  if (url.pathname === '/api/groups/delete') {
    sendJson(res, 200, { ok: true, ...(await deleteGroup(body)) });
    return;
  }
  if (url.pathname === '/api/backups/rollback') {
    sendJson(res, 200, { ok: true, ...(await rollbackBackup(body)) });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
}

function safeStaticPath(pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, normalized);
  if (!file.startsWith(PUBLIC_DIR)) return null;
  return file;
}

async function serveStatic(req, res, url) {
  const file = safeStaticPath(url.pathname);
  if (!file) {
    sendText(res, 404, 'Not found');
    return;
  }

  try {
    const data = await fs.readFile(file);
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    sendText(res, 200, data, type);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendText(res, 404, 'Not found');
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed');
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    const status = error.status && Number.isInteger(error.status) ? error.status : 500;
    sendJson(res, status, { ok: false, error: safeError(error) });
  }
});

ensureDataDirs().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`pricing-admin listening on http://${HOST}:${PORT}`);
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
