import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { db, getVideoQuotaUsedBySource } from '@/lib/db';

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
      if (redemption.reward_status !== 'granted') {
        throw new Error('只能撤销已发放的奖励');
      }

      // 查找 grant ledger
      const grant = db().prepare(
        "SELECT * FROM invite_reward_ledger WHERE redemption_id = ? AND entry_type = 'grant'"
      ).get(redemptionId) as any;

      if (!grant) throw new Error('未找到对应的发放记录');

      // 检查是否已有 reverse ledger
      const existingReverse = db().prepare(
        "SELECT * FROM invite_reward_ledger WHERE related_ledger_id = ? AND entry_type = 'reverse'"
      ).get(grant.id);

      if (existingReverse) throw new Error('该奖励已被撤销');

      // 检查奖励是否已被消费: video_bonus_quota - 1 >= bonusUsed
      const card = db().prepare('SELECT * FROM cards WHERE id = ?').get(redemption.inviter_card_id) as any;
      const bonusUsed = getVideoQuotaUsedBySource(card.id, 'invite_bonus');

      if (card.video_bonus_quota - 1 < bonusUsed) {
        throw new Error('该奖励已被消费，无法撤销');
      }

      const now = Math.floor(Date.now() / 1000);

      // 写 reverse ledger
      db().prepare(
        `INSERT INTO invite_reward_ledger (redemption_id, inviter_card_id, entry_type, delta, business_date, related_ledger_id, reason, operator, created_at)
         VALUES (?, ?, 'reverse', -1, ?, ?, '管理员撤销奖励', 'admin', ?)`
      ).run(redemptionId, redemption.inviter_card_id, redemption.business_date, grant.id, now);

      // 扣减 bonus_quota
      db().prepare('UPDATE cards SET video_bonus_quota = video_bonus_quota - 1 WHERE id = ?')
        .run(redemption.inviter_card_id);

      // 更新 redemption 状态
      db().prepare(
        "UPDATE invite_redemptions SET reward_status = 'reversed', updated_at = ? WHERE id = ?"
      ).run(now, redemptionId);
    }).immediate();

    const updated = db().prepare('SELECT * FROM invite_redemptions WHERE id = ?').get(redemptionId);

    return NextResponse.json({ success: true, data: updated });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 });
  }
}
