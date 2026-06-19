import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RedemptionRow {
  id: number;
  attribution_id: number;
  invite_link_id: number;
  inviter_card_id: number;
  invitee_card_id: number;
  qualifying_video_task_id: number;
  reward_status: string;
  business_date: string;
  risk_flags: string | null;
  rejected_reason: string | null;
  created_at: number;
  granted_at: number | null;
  updated_at: number;
  inviter_code: string;
  inviter_status: string;
  inviter_video_bonus_quota: number;
  invitee_code: string;
  invitee_status: string;
  invite_code: string;
  video_task_id: string;
  video_status: string;
  attr_outcome: string | null;
  invitee_ip_hash: string | null;
  invitee_device_hash: string | null;
  creator_ip_hash: string | null;
  creator_device_hash: string | null;
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || 'pending_review';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  const rows = db().prepare(`
    SELECT
      r.id,
      r.attribution_id,
      r.invite_link_id,
      r.inviter_card_id,
      r.invitee_card_id,
      r.qualifying_video_task_id,
      r.reward_status,
      r.business_date,
      r.risk_flags,
      r.rejected_reason,
      r.created_at,
      r.granted_at,
      r.updated_at,
      inviter.code AS inviter_code,
      inviter.status AS inviter_status,
      inviter.video_bonus_quota AS inviter_video_bonus_quota,
      invitee.code AS invitee_code,
      invitee.status AS invitee_status,
      il.invite_code,
      vt.task_id AS video_task_id,
      vt.status AS video_status,
      a.outcome AS attr_outcome,
      v.invitee_ip_hash,
      v.invitee_device_hash,
      il2.creator_ip_hash,
      il2.creator_device_hash
    FROM invite_redemptions r
    JOIN cards inviter ON inviter.id = r.inviter_card_id
    JOIN cards invitee ON invitee.id = r.invitee_card_id
    JOIN invite_links il ON il.id = r.invite_link_id
    JOIN video_tasks vt ON vt.id = r.qualifying_video_task_id
    JOIN invite_attributions a ON a.id = r.attribution_id
    LEFT JOIN invite_visits v ON v.id = a.invite_visit_id
    LEFT JOIN invite_links il2 ON il2.id = a.invite_link_id
    WHERE r.reward_status = ?
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(status, limit) as RedemptionRow[];

  return NextResponse.json({ success: true, data: rows });
}
