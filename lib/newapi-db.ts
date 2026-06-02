import mysql from 'mysql2/promise';

export const NEWAPI_QUOTA_PER_USD = 500000;

export interface NewApiDbToken {
  id: number;
  user_id: number;
  name: string;
  status: number;
  created_time: number;
  accessed_time?: number;
  expired_time: number;
  remain_quota?: number;
  unlimited_quota?: boolean;
  model_limits_enabled?: boolean;
  model_limits?: string;
  group?: string;
  cross_group_retry?: boolean;
  allow_ips?: string;
  used_quota?: number;
  key?: string;
  [k: string]: unknown;
}

let pool: mysql.Pool | null = null;

function parseGoMysqlDsn(dsn: string): mysql.PoolOptions {
  if (dsn.startsWith('mysql://')) {
    const u = new URL(dsn);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }

  const m = /^([^:]+):(.*)@tcp\(([^)]+)\)\/([^?]+)(?:\?(.*))?$/.exec(dsn);
  if (!m) {
    throw new Error('NEWAPI_SQL_DSN 格式错误,需为 mysql://... 或 Go MySQL DSN');
  }
  const [, user, password, hostPort, database] = m;
  const idx = hostPort.lastIndexOf(':');
  const host = idx >= 0 ? hostPort.slice(0, idx) : hostPort;
  const port = idx >= 0 ? Number(hostPort.slice(idx + 1)) : 3306;
  return { host, port, user, password, database };
}

function dbPool(): mysql.Pool {
  if (pool) return pool;
  const dsn = process.env.NEWAPI_SQL_DSN || process.env.SQL_DSN;
  if (!dsn) {
    throw new Error('Missing env: NEWAPI_SQL_DSN');
  }
  pool = mysql.createPool({
    ...parseGoMysqlDsn(dsn),
    waitForConnections: true,
    connectionLimit: 5,
    namedPlaceholders: true,
    charset: 'utf8mb4',
  });
  return pool;
}

export async function assertNewApiUserExists(userId: number): Promise<void> {
  const [rows] = await dbPool().execute<mysql.RowDataPacket[]>(
    'SELECT id FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  if (rows.length === 0) throw new Error(`NewAPI 用户不存在: ${userId}`);
}

export async function transferTokenToNewApiUser(tokenId: number, userId: number | null | undefined): Promise<void> {
  if (!userId) return;
  await assertNewApiUserExists(userId);
  const [result] = await dbPool().execute<mysql.ResultSetHeader>(
    'UPDATE tokens SET user_id = ? WHERE id = ?',
    [userId, tokenId],
  );
  if (result.affectedRows !== 1) {
    throw new Error(`NewAPI token ${tokenId} 迁移用户归属失败`);
  }
}

export async function transferTokenLogsToNewApiUser(tokenId: number, userId: number | null | undefined): Promise<number> {
  if (!userId) return 0;
  await assertNewApiUserExists(userId);
  const [result] = await dbPool().execute<mysql.ResultSetHeader>(
    'UPDATE logs SET user_id = ? WHERE token_id = ?',
    [userId, tokenId],
  );
  return result.affectedRows;
}

export async function getTokenByIdFromDb(tokenId: number): Promise<NewApiDbToken> {
  const [rows] = await dbPool().execute<mysql.RowDataPacket[]>(
    'SELECT id, user_id, name, `key`, status, created_time, accessed_time, expired_time, remain_quota, unlimited_quota, model_limits_enabled, model_limits, `group`, cross_group_retry, allow_ips, used_quota FROM tokens WHERE id = ? LIMIT 1',
    [tokenId],
  );
  if (rows.length === 0) throw new Error(`NewAPI token ${tokenId} 不存在`);
  return rows[0] as NewApiDbToken;
}

export async function updateTokenStatusInDb(tokenId: number, status: 1 | 2): Promise<void> {
  const [result] = await dbPool().execute<mysql.ResultSetHeader>(
    'UPDATE tokens SET status = ? WHERE id = ?',
    [status, tokenId],
  );
  if (result.affectedRows !== 1) throw new Error(`NewAPI token ${tokenId} 状态更新失败`);
}

export async function updateTokenExpiredTimeInDb(
  tokenId: number,
  newExpiredTime: number,
): Promise<{ before: number; after: number }> {
  const before = await getTokenByIdFromDb(tokenId);
  const [result] = await dbPool().execute<mysql.ResultSetHeader>(
    'UPDATE tokens SET expired_time = ? WHERE id = ?',
    [newExpiredTime, tokenId],
  );
  if (result.affectedRows !== 1) throw new Error(`NewAPI token ${tokenId} 到期时间更新失败`);
  const after = await getTokenByIdFromDb(tokenId);
  return { before: Number(before.expired_time), after: Number(after.expired_time) };
}

export async function addTokenQuotaInDb(
  tokenId: number,
  addQuota: number,
): Promise<{ before: number; after: number }> {
  const before = await getTokenByIdFromDb(tokenId);
  const beforeQuota = Number(before.remain_quota || 0);
  const afterQuota = beforeQuota + addQuota;
  if (afterQuota < 0) throw new Error(`额度调整后为负数 (before=${beforeQuota},add=${addQuota})`);
  const [result] = await dbPool().execute<mysql.ResultSetHeader>(
    'UPDATE tokens SET unlimited_quota = 0, remain_quota = ? WHERE id = ?',
    [afterQuota, tokenId],
  );
  if (result.affectedRows !== 1) throw new Error(`NewAPI token ${tokenId} 额度更新失败`);
  return { before: beforeQuota, after: afterQuota };
}

export async function getTokenUsageQuotaSince(tokenId: number, sinceTs: number): Promise<number> {
  const [rows] = await dbPool().execute<mysql.RowDataPacket[]>(
    `SELECT COALESCE(SUM(CASE WHEN quota > 0 THEN quota ELSE 0 END), 0) AS quota
     FROM logs
     WHERE token_id = ? AND created_at >= ?`,
    [tokenId, sinceTs],
  );
  return Number(rows[0]?.quota || 0);
}
