/**
 * /api/admin/audit/:id — 单条审计详情(GET) + review 标记(POST)
 *
 * GET 返回完整 request_messages + response_text + reasoning_text
 * POST body: { review_status: 0|1|2|3, review_note?: string }
 *   0 = 未审 / 1 = 审过无问题 / 2 = 确认滥用 / 3 = 已 ban
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { audit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!await isAdminAuthenticated()) return unauthorized();

  const db = audit();
  if (!db) {
    return NextResponse.json(
      { success: false, message: 'audit DB 未初始化' },
      { status: 503 }
    );
  }

  const { id: idParam } = await ctx.params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, message: '无效 id' }, { status: 400 });
  }

  const row = db
    .prepare('SELECT * FROM conversation_logs WHERE id = ?')
    .get(id);
  if (!row) {
    return NextResponse.json({ success: false, message: '记录不存在' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: row });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!await isAdminAuthenticated()) return unauthorized();

  const db = audit();
  if (!db) {
    return NextResponse.json(
      { success: false, message: 'audit DB 未初始化' },
      { status: 503 }
    );
  }

  const { id: idParam } = await ctx.params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, message: '无效 id' }, { status: 400 });
  }

  let body: { review_status?: number; review_note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const status = body.review_status;
  if (status === undefined || ![0, 1, 2, 3].includes(status)) {
    return NextResponse.json(
      { success: false, message: 'review_status 须为 0/1/2/3' },
      { status: 400 }
    );
  }

  db.prepare(
    `UPDATE conversation_logs
     SET review_status = ?, review_note = ?, reviewed_at = ?, reviewed_by = ?
     WHERE id = ?`
  ).run(status, body.review_note ?? null, Math.floor(Date.now() / 1000), 'admin', id);

  return NextResponse.json({ success: true });
}
