import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';

export type PublicServiceKey = 'gpt' | 'claude' | 'deepseek';
export type PublicServiceStatus = 'healthy' | 'degraded' | 'outage' | 'no_data';

export interface PublicStatusBucket {
  start: number;
  end: number;
  total: number;
  success: number;
  successRate: number | null;
  status: PublicServiceStatus;
}

export interface PublicStatusService {
  key: PublicServiceKey;
  name: string;
  status: PublicServiceStatus;
  statusText: string;
  successRate1h: number | null;
  successRate24h: number | null;
  tokens24h: number | null;
  rpm1h: number | null;
  tpm24h: number | null;
  typicalLatencyMs: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  consecutiveFailures: number;
  requests1h: number;
  requests24h: number;
  history: PublicStatusBucket[];
}

export interface PublicStatusResponse {
  updatedAt: number;
  refreshSeconds: number;
  window: {
    recentMinutes: number;
    dailyHours: number;
    historyHours: number;
    bucketMinutes: number;
  };
  services: PublicStatusService[];
}

interface RequestLogRow {
  ts: number;
  status: number | null;
  error: string | null;
}

interface AuditMetricRow {
  total_tokens: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  duration_ms: number | null;
}

interface NewApiServiceMetrics {
  tokens24h: number | null;
  rpm1h: number | null;
  tpm24h: number | null;
  typicalLatencyMs: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

const SERVICES: Array<{ key: PublicServiceKey; name: string }> = [
  { key: 'gpt', name: 'GPT' },
  { key: 'claude', name: 'Claude' },
  { key: 'deepseek', name: 'DeepSeek' },
];

const REFRESH_SECONDS = 30;
const RECENT_MINUTES = 60;
const DAILY_HOURS = 24;
const HISTORY_HOURS = 48;
const BUCKET_MINUTES = 30;
const HISTORY_BUCKETS = (HISTORY_HOURS * 60) / BUCKET_MINUTES;
const MAX_AUDIT_DB_BYTES = 512 * 1024 * 1024;

let newApiPool: mysql.Pool | null = null;

export function classifyPublicService(model: string | null | undefined): PublicServiceKey | null {
  if (!model) return null;
  const m = model.toLowerCase();

  if (
    m.includes('minimax') ||
    m.includes('hailuo') ||
    m.includes('abab') ||
    m.includes('video')
  ) {
    return null;
  }

  if (m.includes('deepseek')) return 'deepseek';

  if (
    m.includes('claude') ||
    m.includes('sonnet') ||
    m.includes('haiku') ||
    m.includes('opus') ||
    m.includes('anthropic')
  ) {
    return 'claude';
  }

  if (m.includes('gpt') || m.includes('openai')) return 'gpt';

  return null;
}

export function calculateSuccessRate(success: number, total: number): number | null {
  if (total <= 0) return null;
  return Number(((success / total) * 100).toFixed(2));
}

export function calculatePublicStatus(input: {
  successRate1h: number | null;
  successRate24h: number | null;
  consecutiveFailures: number;
  requests1h: number;
  requests24h: number;
}): PublicServiceStatus {
  if (input.requests1h === 0 && input.requests24h === 0) return 'no_data';

  const rate = input.successRate1h ?? input.successRate24h;
  if (input.consecutiveFailures >= 50 || (rate !== null && rate < 95)) return 'outage';
  if (
    (rate !== null && rate >= 95 && rate < 98) ||
    (input.consecutiveFailures >= 10 && input.consecutiveFailures < 50)
  ) {
    return 'degraded';
  }
  if (rate !== null && rate >= 98 && input.consecutiveFailures < 10) return 'healthy';

  return 'no_data';
}

export function statusText(status: PublicServiceStatus): string {
  if (status === 'healthy') return '服务稳定';
  if (status === 'degraded') return '轻微波动';
  if (status === 'outage') return '服务异常';
  return '暂无数据';
}

export function statusFromBucket(success: number, total: number): PublicServiceStatus {
  const rate = calculateSuccessRate(success, total);
  if (rate === null) return 'no_data';
  if (rate >= 98) return 'healthy';
  if (rate >= 95) return 'degraded';
  return 'outage';
}

export function formatTokenCount(tokens: number | null): string {
  if (tokens === null) return '—';
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
  if (tokens < 1_000_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  return `${(tokens / 1_000_000_000).toFixed(1)}B`;
}

export function formatLatencyMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function getPublicStatusSnapshot(nowMs = Date.now()): Promise<PublicStatusResponse> {
  const cardsDb = openReadonlyDb(cardsDbPath());
  const auditDb = openReadonlyDb(auditDbPath(), MAX_AUDIT_DB_BYTES);
  try {
    const newApiMetrics = await selectNewApiServiceMetrics(nowMs);
    const services = SERVICES.map((service) =>
      buildServiceSnapshot(
        service.key,
        service.name,
        cardsDb,
        auditDb,
        newApiMetrics.get(service.key) ?? null,
        nowMs,
      ),
    );

    return {
      updatedAt: nowMs,
      refreshSeconds: REFRESH_SECONDS,
      window: {
        recentMinutes: RECENT_MINUTES,
        dailyHours: DAILY_HOURS,
        historyHours: HISTORY_HOURS,
        bucketMinutes: BUCKET_MINUTES,
      },
      services,
    };
  } finally {
    cardsDb?.close();
    auditDb?.close();
  }
}

function buildServiceSnapshot(
  key: PublicServiceKey,
  name: string,
  cardsDb: Database.Database | null,
  auditDb: Database.Database | null,
  newApiMetrics: NewApiServiceMetrics | null,
  nowMs: number,
): PublicStatusService {
  const nowSec = Math.floor(nowMs / 1000);
  const since48h = nowSec - HISTORY_HOURS * 3600;
  const rows = selectRequestRows(cardsDb, key, since48h);
  const since1h = nowSec - RECENT_MINUTES * 60;
  const since24h = nowSec - DAILY_HOURS * 3600;
  const stats1h = countStats(rows.filter((row) => row.ts >= since1h));
  const stats24h = countStats(rows.filter((row) => row.ts >= since24h));
  const successRate1h = calculateSuccessRate(stats1h.success, stats1h.total);
  const successRate24h = calculateSuccessRate(stats24h.success, stats24h.total);
  const consecutiveFailures = countConsecutiveFailures(rows);
  const metrics = selectAuditMetrics(auditDb, key, since24h);
  const latencyValues = metrics
    .map((row) => row.duration_ms)
    .filter((value): value is number => typeof value === 'number' && value >= 0);
  const auditTokens24h = sumTokens(metrics);
  const tokens24h = newApiMetrics?.tokens24h ?? auditTokens24h;
  const rpm1h = calculatePerMinute(stats1h.total, RECENT_MINUTES);
  const tpm24h = tokens24h === null ? null : calculatePerMinute(tokens24h, DAILY_HOURS * 60);
  const auditTypicalLatencyMs = percentile(latencyValues, 0.5);
  const auditAvgLatencyMs =
    latencyValues.length > 0
      ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
      : null;
  const auditP95LatencyMs = percentile(latencyValues, 0.95);
  const typicalLatencyMs = newApiMetrics?.typicalLatencyMs ?? auditTypicalLatencyMs;
  const avgLatencyMs = newApiMetrics?.avgLatencyMs ?? auditAvgLatencyMs;
  const p95LatencyMs = newApiMetrics?.p95LatencyMs ?? auditP95LatencyMs;
  const status = calculatePublicStatus({
    successRate1h,
    successRate24h,
    consecutiveFailures,
    requests1h: stats1h.total,
    requests24h: stats24h.total,
  });

  return {
    key,
    name,
    status,
    statusText: statusText(status),
    successRate1h,
    successRate24h,
    tokens24h,
    rpm1h: newApiMetrics?.rpm1h ?? rpm1h,
    tpm24h: newApiMetrics?.tpm24h ?? tpm24h,
    typicalLatencyMs,
    avgLatencyMs,
    p95LatencyMs,
    consecutiveFailures,
    requests1h: stats1h.total,
    requests24h: stats24h.total,
    history: buildHistory(rows, nowMs),
  };
}

async function selectNewApiServiceMetrics(nowMs: number): Promise<Map<PublicServiceKey, NewApiServiceMetrics>> {
  const dsn = process.env.NEWAPI_SQL_DSN || process.env.SQL_DSN;
  if (!dsn) return new Map();

  const since24h = Math.floor(nowMs / 1000) - DAILY_HOURS * 3600;
  const since1h = Math.floor(nowMs / 1000) - RECENT_MINUTES * 60;

  try {
    const [rows] = await newApiDbPool(dsn).query<mysql.RowDataPacket[]>(
      `WITH base AS (
        SELECT
          CASE
            WHEN LOWER(model_name) LIKE '%deepseek%' THEN 'deepseek'
            WHEN LOWER(model_name) LIKE '%claude%'
              OR LOWER(model_name) LIKE '%sonnet%'
              OR LOWER(model_name) LIKE '%haiku%'
              OR LOWER(model_name) LIKE '%opus%'
              OR LOWER(model_name) LIKE '%anthropic%' THEN 'claude'
            WHEN LOWER(model_name) LIKE '%gpt%' OR LOWER(model_name) LIKE '%openai%' THEN 'gpt'
            ELSE NULL
          END AS service,
          created_at,
          COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0) AS tokens,
          use_time
        FROM logs
        WHERE type = 2
          AND created_at >= ?
          AND model_name IS NOT NULL
          AND LOWER(model_name) NOT LIKE '%minimax%'
          AND LOWER(model_name) NOT LIKE '%hailuo%'
          AND LOWER(model_name) NOT LIKE '%abab%'
          AND LOWER(model_name) NOT LIKE '%video%'
      ),
      filtered AS (
        SELECT * FROM base WHERE service IS NOT NULL
      ),
      agg AS (
        SELECT
          service,
          SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS requests_1h,
          SUM(tokens) AS tokens_24h,
          AVG(CASE WHEN use_time > 0 THEN use_time ELSE NULL END) AS avg_use_time
        FROM filtered
        GROUP BY service
      ),
      ranked AS (
        SELECT
          service,
          use_time,
          ROW_NUMBER() OVER (PARTITION BY service ORDER BY use_time) AS rn,
          COUNT(*) OVER (PARTITION BY service) AS cnt
        FROM filtered
        WHERE use_time > 0
      ),
      pct AS (
        SELECT
          service,
          MIN(CASE WHEN rn >= CEIL(cnt * 0.50) THEN use_time END) AS p50_use_time,
          MIN(CASE WHEN rn >= CEIL(cnt * 0.95) THEN use_time END) AS p95_use_time
        FROM ranked
        GROUP BY service
      )
      SELECT
        agg.service,
        agg.requests_1h,
        agg.tokens_24h,
        agg.avg_use_time,
        pct.p50_use_time,
        pct.p95_use_time
      FROM agg
      LEFT JOIN pct ON pct.service = agg.service`,
      [since24h, since1h],
    );

    const result = new Map<PublicServiceKey, NewApiServiceMetrics>();
    for (const row of rows) {
      const service = row.service as PublicServiceKey | null;
      if (service !== 'gpt' && service !== 'claude' && service !== 'deepseek') continue;
      const tokens24h = toNullableNumber(row.tokens_24h);
      const requests1h = toNullableNumber(row.requests_1h);
      result.set(service, {
        tokens24h,
        rpm1h: requests1h === null ? null : calculatePerMinute(requests1h, RECENT_MINUTES),
        tpm24h: tokens24h === null ? null : calculatePerMinute(tokens24h, DAILY_HOURS * 60),
        typicalLatencyMs: secondsToMs(row.p50_use_time),
        avgLatencyMs: secondsToMs(row.avg_use_time),
        p95LatencyMs: secondsToMs(row.p95_use_time),
      });
    }
    return result;
  } catch {
    return new Map();
  }
}

function selectRequestRows(
  db: Database.Database | null,
  service: PublicServiceKey,
  sinceSec: number,
): RequestLogRow[] {
  if (!db || !tableExists(db, 'request_logs')) return [];
  const columns = getTableColumns(db, 'request_logs');
  const timeField = firstExistingColumn(columns, ['ts', 'created_at', 'timestamp']);
  const modelField = firstExistingColumn(columns, ['model']);
  const statusField = firstExistingColumn(columns, [
    'status',
    'status_code',
    'response_status',
    'upstream_status',
  ]);
  const errorField = firstExistingColumn(columns, ['error']);
  if (!timeField || !modelField || !statusField) return [];

  try {
    const timeExpr = quoteIdent(timeField);
    const statusExpr = quoteIdent(statusField);
    const modelExpr = `lower(${quoteIdent(modelField)})`;
    const errorExpr = errorField ? quoteIdent(errorField) : 'NULL';
    const orderBy = columns.has('id') ? `${timeExpr} ASC, ${quoteIdent('id')} ASC` : `${timeExpr} ASC`;
    const rows = db
      .prepare(
        `SELECT ${timeExpr} AS ts_raw,
                ${statusExpr} AS status_raw,
                ${errorExpr} AS error_raw
         FROM request_logs
         WHERE ${timeExpr} >= ?
           AND ${quoteIdent(modelField)} IS NOT NULL
           AND ${statusExpr} IS NOT NULL
           AND ${statusExpr} > 0
           AND ${modelWhereClause(service, modelExpr)}
         ORDER BY ${orderBy}`,
      )
      .all(timeCutoffForField(db, 'request_logs', timeField, sinceSec)) as Array<{
        ts_raw: unknown;
        status_raw: unknown;
        error_raw: unknown;
      }>;

    return rows
      .map((row) => ({
        ts: toUnixSeconds(row.ts_raw),
        status: toNullableNumber(row.status_raw),
        error: toNullableString(row.error_raw),
      }))
      .filter((row) => row.ts >= sinceSec && row.status !== null);
  } catch {
    return [];
  }
}

function selectAuditMetrics(
  db: Database.Database | null,
  service: PublicServiceKey,
  sinceSec: number,
): AuditMetricRow[] {
  if (!db || !tableExists(db, 'conversation_logs')) return [];
  const columns = getTableColumns(db, 'conversation_logs');
  const timeField = firstExistingColumn(columns, ['ts', 'created_at', 'timestamp']);
  const modelField = firstExistingColumn(columns, ['model']);
  const totalTokensField = firstExistingColumn(columns, ['total_tokens']);
  const promptTokensField = firstExistingColumn(columns, ['prompt_tokens']);
  const completionTokensField = firstExistingColumn(columns, ['completion_tokens']);
  const durationField = firstExistingColumn(columns, ['duration_ms', 'latency_ms', 'duration']);
  if (!timeField || !modelField) return [];
  if (!totalTokensField && !promptTokensField && !completionTokensField && !durationField) return [];

  try {
    const timeExpr = quoteIdent(timeField);
    const modelExpr = `lower(${quoteIdent(modelField)})`;
    const totalTokensExpr = totalTokensField ? quoteIdent(totalTokensField) : 'NULL';
    const promptTokensExpr = promptTokensField ? quoteIdent(promptTokensField) : 'NULL';
    const completionTokensExpr = completionTokensField ? quoteIdent(completionTokensField) : 'NULL';
    const durationExpr = durationField ? quoteIdent(durationField) : 'NULL';
    const rows = db
      .prepare(
        `SELECT ${timeExpr} AS ts_raw,
                ${totalTokensExpr} AS total_tokens,
                ${promptTokensExpr} AS prompt_tokens,
                ${completionTokensExpr} AS completion_tokens,
                ${durationExpr} AS duration_ms
         FROM conversation_logs
         WHERE ${timeExpr} >= ?
           AND ${quoteIdent(modelField)} IS NOT NULL
           AND ${modelWhereClause(service, modelExpr)}
           AND (
             ${totalTokensExpr} IS NOT NULL
             OR ${promptTokensExpr} IS NOT NULL
             OR ${completionTokensExpr} IS NOT NULL
             OR ${durationExpr} IS NOT NULL
           )`,
      )
      .all(timeCutoffForField(db, 'conversation_logs', timeField, sinceSec)) as Array<
        AuditMetricRow & { ts_raw: unknown }
      >;

    return rows
      .filter((row) => toUnixSeconds(row.ts_raw) >= sinceSec)
      .map((row) => ({
        total_tokens: toNullableNumber(row.total_tokens),
        prompt_tokens: toNullableNumber(row.prompt_tokens),
        completion_tokens: toNullableNumber(row.completion_tokens),
        duration_ms: toNullableNumber(row.duration_ms),
      }));
  } catch {
    return [];
  }
}

function modelWhereClause(service: PublicServiceKey, model = 'lower(model)'): string {
  const notMiniMax = `${model} NOT LIKE '%minimax%' AND ${model} NOT LIKE '%hailuo%' AND ${model} NOT LIKE '%abab%' AND ${model} NOT LIKE '%video%'`;

  if (service === 'deepseek') {
    return `${notMiniMax} AND ${model} LIKE '%deepseek%'`;
  }
  if (service === 'claude') {
    return `${notMiniMax} AND (${model} LIKE '%claude%' OR ${model} LIKE '%sonnet%' OR ${model} LIKE '%haiku%' OR ${model} LIKE '%opus%' OR ${model} LIKE '%anthropic%')`;
  }
  return `${notMiniMax}
    AND (${model} LIKE '%gpt%' OR ${model} LIKE '%openai%')
    AND ${model} NOT LIKE '%deepseek%'
    AND ${model} NOT LIKE '%claude%'
    AND ${model} NOT LIKE '%sonnet%'
    AND ${model} NOT LIKE '%haiku%'
    AND ${model} NOT LIKE '%opus%'
    AND ${model} NOT LIKE '%anthropic%'`;
}

function countStats(rows: RequestLogRow[]): { total: number; success: number; failed: number } {
  let success = 0;
  let failed = 0;
  for (const row of rows) {
    if (isSuccessStatus(row.status, row.error)) success += 1;
    else if (isFailureStatus(row.status, row.error)) failed += 1;
  }
  return { total: success + failed, success, failed };
}

function countConsecutiveFailures(rows: RequestLogRow[]): number {
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const status = rows[i]?.status;
    const error = rows[i]?.error;
    if (isFailureStatus(status, error)) {
      count += 1;
      continue;
    }
    if (isSuccessStatus(status, error)) break;
  }
  return count;
}

function buildHistory(rows: RequestLogRow[], nowMs: number): PublicStatusBucket[] {
  const bucketMs = BUCKET_MINUTES * 60 * 1000;
  const endMs = Math.floor(nowMs / bucketMs) * bucketMs + bucketMs;
  const startMs = endMs - HISTORY_BUCKETS * bucketMs;
  const buckets = Array.from({ length: HISTORY_BUCKETS }, (_, index) => ({
    start: startMs + index * bucketMs,
    end: startMs + (index + 1) * bucketMs,
    total: 0,
    success: 0,
  }));

  for (const row of rows) {
    const tsMs = row.ts * 1000;
    const index = Math.floor((tsMs - startMs) / bucketMs);
    if (index < 0 || index >= buckets.length) continue;
    if (isSuccessStatus(row.status, row.error)) {
      buckets[index].total += 1;
      buckets[index].success += 1;
    } else if (isFailureStatus(row.status, row.error)) {
      buckets[index].total += 1;
    }
  }

  return buckets.map((bucket) => ({
    ...bucket,
    successRate: calculateSuccessRate(bucket.success, bucket.total),
    status: statusFromBucket(bucket.success, bucket.total),
  }));
}

function sumTokens(rows: AuditMetricRow[]): number | null {
  let total = 0;
  let hasAny = false;
  for (const row of rows) {
    if (typeof row.total_tokens === 'number' && row.total_tokens > 0) {
      total += row.total_tokens;
      hasAny = true;
      continue;
    }
    const prompt = typeof row.prompt_tokens === 'number' ? row.prompt_tokens : 0;
    const completion = typeof row.completion_tokens === 'number' ? row.completion_tokens : 0;
    const rowTotal = prompt + completion;
    if (rowTotal > 0) {
      total += rowTotal;
      hasAny = true;
    }
  }
  return hasAny ? total : null;
}

function calculatePerMinute(total: number, minutes: number): number | null {
  if (total <= 0 || minutes <= 0) return null;
  return Number((total / minutes).toFixed(1));
}

function secondsToMs(value: unknown): number | null {
  const seconds = toNullableNumber(value);
  if (seconds === null || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * p) - 1;
  return Math.round(sorted[Math.max(0, Math.min(sorted.length - 1, index))]);
}

function isSuccessStatus(status: number | null, error: string | null): boolean {
  return typeof status === 'number' && status >= 200 && status < 400 && !hasError(error);
}

function isFailureStatus(status: number | null, error: string | null): boolean {
  return (typeof status === 'number' && status >= 400) || hasError(error);
}

function cardsDbPath(): string {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  return process.env.DB_PATH || path.join(dataDir, 'cards.db');
}

function auditDbPath(): string {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  return path.join(dataDir, 'audit.db');
}

function openReadonlyDb(dbPath: string, maxBytes?: number): Database.Database | null {
  if (!fs.existsSync(dbPath)) return null;
  if (maxBytes !== undefined) {
    const stat = fs.statSync(dbPath);
    if (stat.size > maxBytes) return null;
  }
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function newApiDbPool(dsn: string): mysql.Pool {
  if (newApiPool) return newApiPool;
  newApiPool = mysql.createPool({
    ...parseMysqlDsn(dsn),
    waitForConnections: true,
    connectionLimit: 2,
    connectTimeout: 2000,
    namedPlaceholders: true,
    charset: 'utf8mb4',
  });
  return newApiPool;
}

function parseMysqlDsn(dsn: string): mysql.PoolOptions {
  if (dsn.startsWith('mysql://')) {
    const url = new URL(dsn);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
    };
  }

  const match = /^([^:]+):(.*)@tcp\(([^)]+)\)\/([^?]+)(?:\?(.*))?$/.exec(dsn);
  if (!match) throw new Error('Invalid MySQL DSN');
  const [, user, password, hostPort, database] = match;
  const idx = hostPort.lastIndexOf(':');
  const host = idx >= 0 ? hostPort.slice(0, idx) : hostPort;
  const port = idx >= 0 ? Number(hostPort.slice(idx + 1)) : 3306;
  return {
    host,
    port,
    user,
    password,
    database,
  };
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return Boolean(row);
}

function getTableColumns(db: Database.Database, tableName: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all() as Array<{
      name: string;
    }>;
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

function firstExistingColumn(columns: Set<string>, candidates: string[]): string | null {
  return candidates.find((candidate) => columns.has(candidate)) ?? null;
}

function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function timeCutoffForField(
  db: Database.Database,
  tableName: string,
  timeField: string,
  sinceSec: number,
): number {
  try {
    const row = db
      .prepare(`SELECT MAX(${quoteIdent(timeField)}) AS max_time FROM ${quoteIdent(tableName)}`)
      .get() as { max_time: unknown };
    const maxTime = toNullableNumber(row.max_time);
    return maxTime !== null && maxTime > 10_000_000_000 ? sinceSec * 1000 : sinceSec;
  } catch {
    return sinceSec;
  }
}

function toUnixSeconds(value: unknown): number {
  const n = toNullableNumber(value);
  if (n !== null) return n > 10_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return 0;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function hasError(error: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('failed') ||
    lower.includes('fetch failed') ||
    lower.includes('上游') ||
    lower.includes('失败') ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('504') ||
    lower.length > 0
  );
}
