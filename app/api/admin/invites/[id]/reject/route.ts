import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  const redemptionId = parseInt(params.id, 10);
  if (!Number.isInteger(redemptionId) || redemptionId <= 0) {
    return NextResponse.json({ success: false, message: '无效的 ID' }, { status: 400 });
  }

  try {
    const now = Math.floor(Date.now() / 1000);

    const result = db().prepare(
      `UPDATE invite_redemptions
       SET reward_status = 'rejected_risk',
           rejected_reason = '管理员人工拒绝',
           updated_at = ?
       WHERE id = ? AND reward_status = 'pending_review'`
    ).run(now, redemptionId);

    if (result.changes === 0) {
      return NextResponse.json({ success: false, message: '未找到该记录或状态不是 pending_review' }, { status: 404 });
    }

    const updated = db().prepare('SELECT * FROM invite_redemptions WHERE id = ?').get(redemptionId);

    return NextResponse.json({ success: true, data: updated });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 });
  }
}
