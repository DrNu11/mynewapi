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
    db().transaction(() => {
      const redemption = db().prepare(
        'SELECT * FROM invite_redemptions WHERE id = ?'
      ).get(redemptionId) as any;

      if (!redemption) throw new Error('未找到该记录');
      if (redemption.reward_status !== 'pending_review') {
        throw new Error('只能审核 pending_review 状态的记录');
      }

      // 使用原始 business_date 检查当日 grant 数
      const grantsToday = (db().prepare(
        `SELECT COUNT(*) as c FROM invite_reward_ledger
         WHERE inviter_card_id = ? AND business_date = ? AND entry_type = 'grant'`
      ).get(redemption.inviter_card_id, redemption.business_date) as { c: number }).c;

      const now = Math.floor(Date.now() / 1000);

      if (grantsToday >= 3) {
        db().prepare(
          "UPDATE invite_redemptions SET reward_status = 'rejected_daily_cap', rejected_reason = ?, updated_at = ? WHERE id = ?"
        ).run(`管理员审核时当日奖励已达上限 (${grantsToday}/3)`, now, redemptionId);
        return;
      }

      // 正常发奖
      db().prepare(
        "UPDATE invite_redemptions SET reward_status = 'granted', granted_at = ?, updated_at = ? WHERE id = ?"
      ).run(now, now, redemptionId);

      // 写 ledger
      db().prepare(
        `INSERT INTO invite_reward_ledger (redemption_id, inviter_card_id, entry_type, delta, business_date, reason, operator, created_at)
         VALUES (?, ?, 'grant', 1, ?, '管理员批准 pending_review', 'admin', ?)`
      ).run(redemptionId, redemption.inviter_card_id, redemption.business_date, now);

      // 增加 bonus_quota
      db().prepare('UPDATE cards SET video_bonus_quota = video_bonus_quota + 1 WHERE id = ?')
        .run(redemption.inviter_card_id);
    }).immediate();

    const updated = db().prepare('SELECT * FROM invite_redemptions WHERE id = ?').get(redemptionId) as any;

    return NextResponse.json({ success: true, data: updated });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 });
  }
}
