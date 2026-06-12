/**
 * 客户对话审计 — AUDIT_SYSTEM_DESIGN.md Phase 1 实现
 *
 * 目标:完整记录每次客户请求的 prompt + response,支持:
 *   - 事后审计被上游封号时追查哪个客户的 prompt 触发
 *   - 关键词检测(jailbreak / prompt injection / DAN 等)
 *   - 按 sk_full_hash 聚合同一客户的多次请求
 *   - 按 request_messages_hash 聚合同一 prompt 在不同 sk-key 出现(攻击者刷多卡)
 *
 * 关键设计:
 *   - 独立 audit.db(不动 cards.db,避免影响核心业务)
 *   - audit() 返回 null 时主代理跳过审计(不 crash 主服务)
 *   - 全部 try/catch 包住,DB 异常不抛
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';

// ============================================================================
// DB 连接(独立 audit.db)
// ============================================================================

let auditDb: Database.Database | null = null;
let auditDbHealthy = false;

export function audit(): Database.Database | null {
  // env AUDIT_ENABLED=false 时彻底关闭审计写入(2026-05-12:audit.db 撑爆 2.5G 后磁盘满,
  // 老板决定暂停审计释放空间。后续若要恢复,改 env 即可)
  if (process.env.AUDIT_ENABLED === 'false') return null;
  if (auditDb) return auditDbHealthy ? auditDb : null;
  try {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const dbPath = path.join(dataDir, 'audit.db');
    auditDb = new Database(dbPath);
    auditDb.pragma('journal_mode = WAL');
    auditDb.pragma('synchronous = NORMAL');
    const existing = auditDb
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversation_logs'")
      .get();
    if (!existing) {
      initAuditSchema(auditDb);
    }
    auditDbHealthy = true;
    return auditDb;
  } catch (err) {
    // 关键:audit 初始化失败不能 crash nassa-cards 主服务
    // 只打 error,后续调用 audit() 返回 null,主流程继续跑
    console.error('[audit] init failed, audit disabled:', err);
    auditDbHealthy = false;
    return null;
  }
}

function initAuditSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_logs (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                     INTEGER NOT NULL,
      card_id                INTEGER,
      sk_prefix              TEXT NOT NULL,
      sk_full_hash           TEXT NOT NULL,
      ip                     TEXT,
      ua                     TEXT,
      endpoint               TEXT NOT NULL,
      model                  TEXT NOT NULL,
      request_messages       TEXT NOT NULL,
      request_messages_hash  TEXT,
      request_size           INTEGER,
      response_text          TEXT,
      reasoning_text         TEXT,
      response_finish_reason TEXT,
      prompt_tokens          INTEGER,
      completion_tokens      INTEGER,
      status_code            INTEGER NOT NULL,
      is_streaming           INTEGER DEFAULT 0,
      duration_ms            INTEGER,
      flagged                INTEGER DEFAULT 0,
      flag_reason            TEXT,
      review_status          INTEGER DEFAULT 0,
      review_note            TEXT,
      reviewed_at            INTEGER,
      reviewed_by            TEXT
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_ts ON conversation_logs(ts);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_card ON conversation_logs(card_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_sk_full ON conversation_logs(sk_full_hash);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_flagged ON conversation_logs(flagged) WHERE flagged = 1;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_review ON conversation_logs(review_status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_endpoint ON conversation_logs(endpoint);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_hash ON conversation_logs(request_messages_hash);`);
}

// ============================================================================
// 脱敏 / hash 工具
// ============================================================================

export function maskSkKey(sk: string): string {
  if (sk.length <= 16) return sk;
  return `${sk.slice(0, 12)}...${sk.slice(-4)}`;
}

export function hashSkKey(sk: string): string {
  return crypto.createHash('sha256').update(sk).digest('hex').slice(0, 32);
}

// ============================================================================
// 多 endpoint 请求格式 提取 prompt 文本(文档 §4.1)
// OpenAI /v1/chat/completions : messages: [{role, content: string | ContentBlock[]}]
// Anthropic /v1/messages      : messages: [{role, content: string | ContentBlock[]}]
// codex /v1/responses         : input: string | InputItem[]
// ============================================================================

export function extractPromptText(
  endpoint: string,
  body: any,
): { text: string; structured: any } {
  // codex /v1/responses
  if (endpoint.includes('/responses')) {
    const input = body?.input;
    if (typeof input === 'string') return { text: input, structured: input };
    if (Array.isArray(input)) {
      const text = input
        .map((item: any) => {
          if (typeof item === 'string') return item;
          if (item?.content) return JSON.stringify(item.content);
          return JSON.stringify(item);
        })
        .join('\n');
      return { text, structured: input };
    }
    return { text: '', structured: input ?? null };
  }

  // OpenAI / Anthropic messages
  const messages = body?.messages;
  if (!Array.isArray(messages)) return { text: '', structured: null };

  const text = messages
    .map((m: any) => {
      if (typeof m.content === 'string') return `[${m.role}] ${m.content}`;
      if (Array.isArray(m.content)) {
        // Anthropic content blocks: [{type:'text', text:...}, {type:'image', source:...}]
        const parts = m.content
          .map((c: any) => {
            if (c.type === 'text') return c.text;
            if (c.type === 'image') return '[image]';
            if (c.type === 'tool_use') return `[tool_use:${c.name}]`;
            if (c.type === 'tool_result') return `[tool_result]`;
            return JSON.stringify(c);
          })
          .join(' ');
        return `[${m.role}] ${parts}`;
      }
      return `[${m.role}] ${JSON.stringify(m.content)}`;
    })
    .join('\n');

  return { text, structured: messages };
}

/** 归一化 prompt 的 hash,用于检测"同一 prompt 在不同 sk 中出现"(多卡刷攻击) */
export function normalizePromptHash(structured: any): string {
  try {
    const norm = JSON.stringify(structured).toLowerCase().replace(/\s+/g, ' ');
    return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32);
  } catch {
    return '';
  }
}

// ============================================================================
// 关键词可疑检测
// ============================================================================

const SUSPICIOUS_KEYWORDS = [
  'ignore previous instructions',
  'ignore the above',
  'forget your instructions',
  'forget the above',
  'system prompt',
  'developer mode',
  'DAN mode',
  'jailbreak',
  'jail break',
  'do anything now',
  '越狱',
  '逆向',
  '绕过限制',
  '忽略上述指令',
  '忽略以上指令',
  '忽略之前',
  '把自己当成',
  '扮演 root',
  'sudo mode',
  '无视 system',
];

export function detectSuspicious(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const kw of SUSPICIOUS_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) hits.push(kw);
  }
  return hits;
}

// ============================================================================
// 写入 API(全部 try/catch,失败不抛)
// ============================================================================

export interface AuditEntry {
  card_id: number | null;
  sk_key: string;
  ip: string | null;
  ua: string | null;
  endpoint: string;
  model: string;
  request_messages: any;
  request_messages_hash?: string;
  request_size: number;
  is_streaming: boolean;
  status_code: number;
}

export interface AuditUpdate {
  response_text?: string;
  reasoning_text?: string;
  response_finish_reason?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  duration_ms?: number;
  status_code?: number;
  flagged?: number;
  flag_reason?: string;
}

/** 请求到达时插入,返回 audit_id 供响应阶段 update */
export function insertAuditEntry(entry: AuditEntry): number | null {
  const db = audit();
  if (!db) return null;
  try {
    // 截断 request_messages 避免巨型请求撑爆 db(>200KB)
    // 智能截断:对于 JSON 数组在最后一个完整元素 `},` 之后切,保持合法 JSON;
    // 否则按字节切并加 [TRUNCATED] 标记(viewer 端有 recovery 函数处理)
    const reqText = safeStringify(entry.request_messages);
    const reqTextTruncated =
      reqText.length > 200_000
        ? smartTruncateJson(reqText, 200_000)
        : reqText;
    const stmt = db.prepare(`
      INSERT INTO conversation_logs
        (ts, card_id, sk_prefix, sk_full_hash, ip, ua, endpoint, model,
         request_messages, request_messages_hash, request_size,
         is_streaming, status_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      Math.floor(Date.now() / 1000),
      entry.card_id,
      maskSkKey(entry.sk_key),
      hashSkKey(entry.sk_key),
      entry.ip,
      entry.ua,
      entry.endpoint,
      entry.model,
      reqTextTruncated,
      entry.request_messages_hash ?? null,
      entry.request_size,
      entry.is_streaming ? 1 : 0,
      entry.status_code,
    );
    return info.lastInsertRowid as number;
  } catch (err) {
    console.error('[audit] insertAuditEntry failed:', err);
    return null;
  }
}

/** 响应结束时 update 填充 response + flagged */
export function updateAuditEntry(id: number, update: AuditUpdate): void {
  const db = audit();
  if (!db) return;
  try {
    const fields: string[] = [];
    const values: any[] = [];
    for (const [k, v] of Object.entries(update)) {
      fields.push(`${k} = ?`);
      // response_text / reasoning_text 截断到 200KB
      if ((k === 'response_text' || k === 'reasoning_text') && typeof v === 'string' && v.length > 200_000) {
        values.push(v.slice(0, 200_000) + `...[TRUNCATED ${v.length} bytes]`);
      } else {
        values.push(v);
      }
    }
    if (!fields.length) return;
    values.push(id);
    db.prepare(`UPDATE conversation_logs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  } catch (err) {
    console.error('[audit] updateAuditEntry failed:', err);
  }
}

// ============================================================================
// 清理(按天数)
// ============================================================================

export function pruneOldAudit(daysToKeep = 90): number {
  const db = audit();
  if (!db) return 0;
  try {
    const cutoff = Math.floor(Date.now() / 1000) - daysToKeep * 86400;
    const r = db.prepare('DELETE FROM conversation_logs WHERE ts < ?').run(cutoff);
    return r.changes as number;
  } catch (err) {
    console.error('[audit] pruneOldAudit failed:', err);
    return 0;
  }
}

// ============================================================================
// 工具
// ============================================================================

function safeStringify(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * 智能截断超长 JSON 数组,保持合法 JSON 格式。
 * 思路:
 *   1. 如果不是 JSON array,粗暴切 + [TRUNCATED] 标记
 *   2. 如果是 array(以 `[` 开头),扫描追踪 depth,在最后一个 depth=1 的 `}` 处切并 close 数组
 *   3. 切不出来就 fallback 到粗暴切
 */
function smartTruncateJson(s: string, maxBytes: number): string {
  if (s.length <= maxBytes) return s;
  if (!s.startsWith('[')) {
    return s.slice(0, maxBytes) + `...[TRUNCATED ${s.length} bytes]`;
  }

  // 在 maxBytes 范围内找最后一个 depth=1 的 `}` 位置
  const limit = Math.min(s.length, maxBytes);
  let depth = 0;
  let inStr = false;
  let escape = false;
  let lastSafeIdx = -1;

  for (let i = 0; i < limit; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '[' || c === '{') {
      depth++;
    } else if (c === ']' || c === '}') {
      depth--;
      if (depth === 1 && c === '}') {
        lastSafeIdx = i;
      }
    }
  }

  if (lastSafeIdx > 0) {
    return s.slice(0, lastSafeIdx + 1) + `]/*TRUNCATED ${s.length - lastSafeIdx - 1} bytes*/`;
  }

  // fallback:粗暴切
  return s.slice(0, maxBytes) + `...[TRUNCATED ${s.length} bytes]`;
}
