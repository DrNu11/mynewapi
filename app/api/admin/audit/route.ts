/**
 * /api/admin/audit — 审计日志列表(分页 + 过滤)
 *
 * 查询参数:
 *   - flagged: '1' 仅看可疑 / 不传看全部
 *   - sk_hash: sk_full_hash 精确匹配(看同一客户所有请求)
 *   - endpoint: '/chat/completions' / '/responses' / '/messages'
 *   - from / to: unix sec 时间范围
 *   - search: request_messages / response_text 模糊匹配
 *   - limit / offset: 分页
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { audit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthenticated()) return unauthorized();

  const db = audit();
  if (!db) {
    return NextResponse.json(
      { success: false, message: 'audit DB 未初始化' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
  const flagged = searchParams.get('flagged') === '1';
  const skHash = searchParams.get('sk_hash') || '';
  const endpoint = searchParams.get('endpoint') || '';
  const from = parseInt(searchParams.get('from') || '0', 10);
  const to = parseInt(searchParams.get('to') || '0', 10);
  const search = searchParams.get('search') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const conditions: string[] = [];
  const params: any[] = [];

  if (flagged) conditions.push('flagged = 1');
  if (skHash) {
    conditions.push('sk_full_hash = ?');
    params.push(skHash);
  }
  if (endpoint) {
    conditions.push('endpoint = ?');
    params.push(endpoint);
  }
  if (from > 0) {
    conditions.push('ts >= ?');
    params.push(from);
  }
  if (to > 0) {
    conditions.push('ts <= ?');
    params.push(to);
  }
  if (search) {
    conditions.push('(request_messages LIKE ? OR response_text LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM conversation_logs ${where}`).get(...params) as {
      c: number;
    }
  ).c;

  const rows = db
    .prepare(
      `SELECT id, ts, sk_prefix, sk_full_hash, ip, ua, endpoint, model,
        request_size, status_code, is_streaming, duration_ms,
        prompt_tokens, completion_tokens,
        flagged, flag_reason, review_status, review_note
       FROM conversation_logs
       ${where}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  // 概览统计
  const stats = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN flagged = 1 THEN 1 ELSE 0 END) AS flagged_total,
        SUM(CASE WHEN review_status = 0 THEN 1 ELSE 0 END) AS unreviewed,
        SUM(CASE WHEN review_status = 2 THEN 1 ELSE 0 END) AS confirmed_abuse,
        SUM(CASE WHEN ts > strftime('%s','now') - 86400 THEN 1 ELSE 0 END) AS last_24h
      FROM conversation_logs`
    )
    .get();

  return NextResponse.json({
    success: true,
    data: { rows, total, limit, offset, stats },
  });
}
