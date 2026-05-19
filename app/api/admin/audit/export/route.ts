/**
 * /api/admin/audit/export?type=conversations|requests|expired_cards
 *
 * 一键导出 3 种数据,浏览器自动下载:
 *   - conversations: 全部审计对话(audit.db.conversation_logs),JSONL
 *   - requests:     全部限速观测日志(cards.db.request_logs),JSONL
 *   - expired_cards: 已过期/到期的卡密快照,JSON
 *
 * 用 Content-Disposition: attachment 触发浏览器下载。
 * 大文件用 ReadableStream 流式输出,避免内存压力。
 */
import { NextRequest } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { db as cardsDb } from '@/lib/db';
import { audit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return new Response(JSON.stringify({ success: false, message: '未登录' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

function tsTag(): string {
  return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthenticated()) return unauthorized();

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'conversations';

  if (type === 'conversations') {
    return exportConversations();
  }
  if (type === 'requests') {
    return exportRequests();
  }
  if (type === 'expired_cards') {
    return exportExpiredCards();
  }
  return new Response(
    JSON.stringify({ success: false, message: '无效 type,需为 conversations / requests / expired_cards' }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );
}

/** 流式导出 audit conversation_logs 为 JSONL(每行一条记录) */
function exportConversations(): Response {
  const auditDb = audit();
  if (!auditDb) {
    return new Response(JSON.stringify({ success: false, message: 'audit DB 未初始化' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  const filename = `audit-conversations-${tsTag()}.jsonl`;

  // 用游标 iterate,避免一次加载到内存
  const stmt = auditDb.prepare('SELECT * FROM conversation_logs ORDER BY id ASC');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      try {
        for (const row of stmt.iterate()) {
          controller.enqueue(enc.encode(JSON.stringify(row) + '\n'));
        }
        controller.close();
      } catch (err) {
        console.error('[audit-export conversations] failed:', err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

/** 流式导出 cards.request_logs 为 JSONL */
function exportRequests(): Response {
  const filename = `request-logs-${tsTag()}.jsonl`;
  const stmt = cardsDb().prepare('SELECT * FROM request_logs ORDER BY id ASC');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      try {
        for (const row of stmt.iterate()) {
          controller.enqueue(enc.encode(JSON.stringify(row) + '\n'));
        }
        controller.close();
      } catch (err) {
        console.error('[audit-export requests] failed:', err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

/** 导出已过期/到期的卡密快照(JSON,数据量小不需要流) */
function exportExpiredCards(): Response {
  const rows = cardsDb()
    .prepare(
      `SELECT * FROM cards
       WHERE status = 'expired'
          OR (expires_at IS NOT NULL AND expires_at <= strftime('%s','now'))
       ORDER BY expires_at DESC, id DESC`,
    )
    .all();

  const filename = `expired-cards-${tsTag()}.json`;
  const body = JSON.stringify(
    {
      exported_at: Math.floor(Date.now() / 1000),
      total: rows.length,
      cards: rows,
    },
    null,
    2,
  );

  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
