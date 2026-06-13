/**
 * 邀请奖励系统: DB 查询 + settleInviteReward() 结算逻辑。
 * 所有奖励结算必须在 IMMEDIATE 事务中完成。
 */
import { db, type Card, type VideoTask, currentBusinessDate, getCardByCode, markExpiredCards } from '@/lib/db';
import { hashToken } from '@/lib/risk-hash';
import { randomBytes } from 'crypto';

// ---- interfaces ----

export interface InviteLink {
  id: number;
  invite_code: string;
  inviter_card_id: number;
  status: string;
  creator_ip_hash: string | null;
  creator_device_hash: string | null;
  created_at: number;
  updated_at: number;
}

export interface InviteVisit {
  id: number;
  visit_token_hash: string;
  invite_link_id: number;
  invitee_ip_hash: string | null;
  invitee_device_hash: string | null;
  created_at: number;
  expires_at: number;
}

export interface InviteAttribution {
  id: number;
  invite_visit_id: number;
  invite_link_id: number;
  inviter_card_id: number;
  invitee_card_id: number;
  video_task_id: number;
  status: string;
  outcome: string | null;
  risk_flags: string | null;
  created_at: number;
  updated_at: number;
}

export interface InviteRedemption {
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
}

// ---- invite_links ----

export function getInviteLinkByCode(code: string): InviteLink | null {
  return (db().prepare('SELECT * FROM invite_links WHERE invite_code = ?').get(code) as InviteLink) || null;
}

export function getInviteLinkByCardId(cardId: number): InviteLink | null {
  return (db().prepare('SELECT * FROM invite_links WHERE inviter_card_id = ?').get(cardId) as InviteLink) || null;
}

export function getInviteLinkById(id: number): InviteLink | null {
  return (db().prepare('SELECT * FROM invite_links WHERE id = ?').get(id) as InviteLink) || null;
}

export function createInviteLink(inviterCardId: number, ipHash: string | null, deviceHash: string | null): InviteLink {
  const now = Math.floor(Date.now() / 1000);
  const inviteCode = randomBytes(12).toString('base64url');
  db().prepare(`INSERT INTO invite_links (invite_code, inviter_card_id, creator_ip_hash, creator_device_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(inviteCode, inviterCardId, ipHash, deviceHash, now, now);
  return getInviteLinkByCode(inviteCode)!;
}

export function getInviteLinkStats(inviterCardId: number): {
  today_rewards: number;
  today_remaining: number;
  total_rewards: number;
  pending_review: number;
  successful_invites: number;
  daily_cap_rejected: number;
} {
  const bizDate = currentBusinessDate();
  const todayGrants = (db().prepare(
    `SELECT COUNT(*) as c FROM invite_reward_ledger WHERE inviter_card_id = ? AND business_date = ? AND entry_type = 'grant'`
  ).get(inviterCardId, bizDate) as { c: number }).c;
  const totalGrants = (db().prepare(
    `SELECT COUNT(*) as c FROM invite_reward_ledger WHERE inviter_card_id = ? AND entry_type = 'grant'`
  ).get(inviterCardId) as { c: number }).c;
  const pendingReview = (db().prepare(
    `SELECT COUNT(*) as c FROM invite_redemptions WHERE inviter_card_id = ? AND reward_status = 'pending_review'`
  ).get(inviterCardId) as { c: number }).c;
  const totalRedeemed = (db().prepare(
    `SELECT COUNT(*) as c FROM invite_redemptions WHERE inviter_card_id = ?`
  ).get(inviterCardId) as { c: number }).c;
  const dailyCapRejected = (db().prepare(
    `SELECT COUNT(*) as c FROM invite_redemptions WHERE inviter_card_id = ? AND reward_status = 'rejected_daily_cap'`
  ).get(inviterCardId) as { c: number }).c;

  return {
    today_rewards: todayGrants,
    today_remaining: Math.max(0, 3 - todayGrants),
    total_rewards: totalGrants,
    pending_review: pendingReview,
    successful_invites: totalRedeemed,
    daily_cap_rejected: dailyCapRejected,
  };
}

// ---- invite_visits ----

export function getVisitByTokenHash(tokenHash: string): InviteVisit | null {
  return (db().prepare('SELECT * FROM invite_visits WHERE visit_token_hash = ? AND expires_at > ?')
    .get(tokenHash, Math.floor(Date.now() / 1000)) as InviteVisit) || null;
}

export function createVisit(inviteLinkId: number, tokenHash: string, ipHash: string | null, deviceHash: string | null): void {
  const now = Math.floor(Date.now() / 1000);
  db().prepare(`INSERT INTO invite_visits (visit_token_hash, invite_link_id, invitee_ip_hash, invitee_device_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(tokenHash, inviteLinkId, ipHash, deviceHash, now, now + 86400);
}

// ---- invite_attributions ----

export function getAttributionByVideoTask(videoTaskId: number): InviteAttribution | null {
  return (db().prepare('SELECT * FROM invite_attributions WHERE video_task_id = ?').get(videoTaskId) as InviteAttribution) || null;
}

export function getPendingAttributionByVideoTask(videoTaskId: number): InviteAttribution | null {
  return (db().prepare("SELECT * FROM invite_attributions WHERE video_task_id = ? AND status = 'pending'")
    .get(videoTaskId) as InviteAttribution) || null;
}

export function insertAttribution(row: {
  invite_visit_id: number;
  invite_link_id: number;
  inviter_card_id: number;
  invitee_card_id: number;
  video_task_id: number;
  risk_flags?: string | null;
}): void {
  const now = Math.floor(Date.now() / 1000);
  db().prepare(`INSERT INTO invite_attributions (invite_visit_id, invite_link_id, inviter_card_id, invitee_card_id, video_task_id, status, risk_flags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
    .run(row.invite_visit_id, row.invite_link_id, row.inviter_card_id, row.invitee_card_id, row.video_task_id, row.risk_flags ?? null, now, now);
}

export function updateAttributionOutcome(id: number, outcome: string, status = 'settled'): void {
  db().prepare('UPDATE invite_attributions SET outcome = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(outcome, status, Math.floor(Date.now() / 1000), id);
}

// ---- invite_redemptions ----

export function getRedemptionByInviteeCard(inviteeCardId: number): InviteRedemption | null {
  return (db().prepare('SELECT * FROM invite_redemptions WHERE invitee_card_id = ?').get(inviteeCardId) as InviteRedemption) || null;
}

export function insertRedemption(row: {
  attribution_id: number;
  invite_link_id: number;
  inviter_card_id: number;
  invitee_card_id: number;
  qualifying_video_task_id: number;
  reward_status: string;
  business_date: string;
  risk_flags?: string | null;
  rejected_reason?: string | null;
}): number {
  const now = Math.floor(Date.now() / 1000);
  const grantedAt = row.reward_status === 'granted' ? now : null;
  const info = db().prepare(`INSERT INTO invite_redemptions
    (attribution_id, invite_link_id, inviter_card_id, invitee_card_id, qualifying_video_task_id, reward_status, business_date, risk_flags, rejected_reason, created_at, granted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.attribution_id, row.invite_link_id, row.inviter_card_id, row.invitee_card_id,
      row.qualifying_video_task_id, row.reward_status, row.business_date,
      row.risk_flags ?? null, row.rejected_reason ?? null, now, grantedAt, now);
  return info.lastInsertRowid as number;
}

// ---- invite_reward_ledger ----

export function countGrantsToday(inviterCardId: number, bizDate: string): number {
  const row = db().prepare(
    `SELECT COUNT(*) as c FROM invite_reward_ledger WHERE inviter_card_id = ? AND business_date = ? AND entry_type = 'grant'`
  ).get(inviterCardId, bizDate) as { c: number };
  return row?.c || 0;
}

export function insertRewardLedger(redemptionId: number, inviterCardId: number, entryType: string, delta: number, bizDate: string): void {
  const now = Math.floor(Date.now() / 1000);
  db().prepare(`INSERT INTO invite_reward_ledger (redemption_id, inviter_card_id, entry_type, delta, business_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(redemptionId, inviterCardId, entryType, delta, bizDate, now);
}

// ---- reward settlement ----

/**
 * 视频任务成功后结算邀请奖励。
 * 必须在 IMMEDIATE 事务中调用。
 */
export function settleInviteReward(videoTaskId: number): { settled: boolean; outcome?: string } {
  const now = Math.floor(Date.now() / 1000);

  // 读取视频任务
  const task = db().prepare('SELECT * FROM video_tasks WHERE id = ?').get(videoTaskId) as VideoTask | undefined;
  if (!task || task.status !== 'Success') return { settled: false };

  // 读取待处理归因
  const attr = db().prepare("SELECT * FROM invite_attributions WHERE video_task_id = ? AND status = 'pending'")
    .get(videoTaskId) as InviteAttribution | undefined;
  if (!attr) return { settled: false };

  markExpiredCards();

  // 自邀
  if (attr.inviter_card_id === attr.invitee_card_id) {
    updateAttributionOutcome(attr.id, 'rejected_self');
    return { settled: true, outcome: 'rejected_self' };
  }

  // 检查邀请人有效性
  const inviter = db().prepare('SELECT * FROM cards WHERE id = ?').get(attr.inviter_card_id) as Card | undefined;
  if (!inviter || inviter.status === 'disabled' || inviter.status === 'expired') {
    updateAttributionOutcome(attr.id, 'rejected_inviter_invalid');
    return { settled: true, outcome: 'rejected_inviter_invalid' };
  }
  if (inviter.status === 'activated' && inviter.expires_at && inviter.expires_at <= now) {
    updateAttributionOutcome(attr.id, 'rejected_inviter_invalid');
    return { settled: true, outcome: 'rejected_inviter_invalid' };
  }

  // 检查被邀请卡是否已兑现
  const existingRedemption = getRedemptionByInviteeCard(attr.invitee_card_id);
  if (existingRedemption) {
    updateAttributionOutcome(attr.id, 'rejected_duplicate');
    return { settled: true, outcome: 'rejected_duplicate' };
  }

  const bizDate = currentBusinessDate();

  // 风险信号
  const riskFlags: string[] = [];
  const visit = db().prepare('SELECT * FROM invite_visits WHERE id = ?').get(attr.invite_visit_id) as InviteVisit | undefined;
  const link = db().prepare('SELECT * FROM invite_links WHERE id = ?').get(attr.invite_link_id) as InviteLink | undefined;
  const sameIp = visit?.invitee_ip_hash && link?.creator_ip_hash && visit.invitee_ip_hash === link.creator_ip_hash;
  const sameDevice = visit?.invitee_device_hash && link?.creator_device_hash && visit.invitee_device_hash === link.creator_device_hash;
  if (sameIp) riskFlags.push('same_ip');
  if (sameDevice) riskFlags.push('same_device');
  const riskStr = riskFlags.length > 0 ? riskFlags.join(',') : null;

  // 检查每日上限
  const grantsToday = countGrantsToday(attr.inviter_card_id, bizDate);
  if (grantsToday >= 3) {
    // 不发奖,但占用被邀请卡资格
    insertRedemption({
      attribution_id: attr.id,
      invite_link_id: attr.invite_link_id,
      inviter_card_id: attr.inviter_card_id,
      invitee_card_id: attr.invitee_card_id,
      qualifying_video_task_id: videoTaskId,
      reward_status: 'rejected_daily_cap',
      business_date: bizDate,
      risk_flags: riskStr,
      rejected_reason: `当日奖励已达上限 (${grantsToday}/3)`,
    });
    updateAttributionOutcome(attr.id, 'rejected_daily_cap');
    return { settled: true, outcome: 'rejected_daily_cap' };
  }

  // 同 IP + 同设备 → pending_review
  if (sameIp && sameDevice) {
    insertRedemption({
      attribution_id: attr.id,
      invite_link_id: attr.invite_link_id,
      inviter_card_id: attr.inviter_card_id,
      invitee_card_id: attr.invitee_card_id,
      qualifying_video_task_id: videoTaskId,
      reward_status: 'pending_review',
      business_date: bizDate,
      risk_flags: riskStr,
    });
    updateAttributionOutcome(attr.id, 'pending_review');
    return { settled: true, outcome: 'pending_review' };
  }

  // 正常发奖
  const redemptionId = insertRedemption({
    attribution_id: attr.id,
    invite_link_id: attr.invite_link_id,
    inviter_card_id: attr.inviter_card_id,
    invitee_card_id: attr.invitee_card_id,
    qualifying_video_task_id: videoTaskId,
    reward_status: 'granted',
    business_date: bizDate,
    risk_flags: riskStr,
  });

  insertRewardLedger(redemptionId, attr.inviter_card_id, 'grant', 1, bizDate);
  db().prepare('UPDATE cards SET video_bonus_quota = video_bonus_quota + 1 WHERE id = ?')
    .run(attr.inviter_card_id);
  updateAttributionOutcome(attr.id, 'granted');

  return { settled: true, outcome: 'granted' };
}
