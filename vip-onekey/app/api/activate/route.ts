import { NextRequest, NextResponse } from 'next/server';
import {
  getCard,
  activateCard,
  insertRevertTask,
} from '@/lib/db';
import { searchUserByEmail, updateUserGroup } from '@/lib/newapi';
import { ensureScheduler } from '@/lib/scheduler';
import { takeRateLimit, getRemoteIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TARGET_GROUP = process.env.TARGET_GROUP || 'vip1';
const DEFAULT_GROUP = process.env.DEFAULT_GROUP || 'default';
const PLAN_DAYS = Number(process.env.PLAN_DAYS || 30);
const IP_RATE_LIMIT = Number(process.env.IP_RATE_LIMIT || 5);

const CODE_REGEX = /^VIP1?-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export async function POST(req: NextRequest) {
  ensureScheduler(); // start background scheduler on first call (after Next.js boots)

  const ip = getRemoteIp(req.headers);
  if (!takeRateLimit(ip, IP_RATE_LIMIT)) {
    return NextResponse.json({ success: false, message: '请求过于频繁,请 1 分钟后再试' }, { status: 429 });
  }

  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const code = (body.code || '').trim().toUpperCase();

  if (!email || !email.includes('@')) {
    return NextResponse.json({ success: false, message: '请填写有效邮箱' }, { status: 400 });
  }
  if (!CODE_REGEX.test(code)) {
    return NextResponse.json({ success: false, message: '卡密格式错误,应为 VIP1-XXXX-XXXX-XXXX' }, { status: 400 });
  }

  const card = getCard(code);
  if (!card) {
    return NextResponse.json({ success: false, message: '卡密不存在' }, { status: 404 });
  }

  // 已激活 — 允许同一邮箱再次查询查看到期时间(不重复升级)
  if (card.status === 'activated') {
    if (card.used_email !== email) {
      return NextResponse.json(
        { success: false, message: '该卡密已被其他账号激活' },
        { status: 409 },
      );
    }
    return NextResponse.json({
      success: true,
      already_activated: true,
      data: {
        email: card.used_email,
        user_id: card.used_user_id,
        target_group: TARGET_GROUP,
        plan_days: card.plan_days,
        activated_at: card.activated_at,
        expires_at: card.expires_at,
      },
    });
  }
  if (card.status === 'expired') {
    return NextResponse.json({ success: false, message: '卡密已到期' }, { status: 410 });
  }

  // 查找 newapi user
  let user;
  try {
    user = await searchUserByEmail(email);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[activate] searchUserByEmail error:', msg);
    return NextResponse.json({ success: false, message: 'NewAPI 后端不可达' }, { status: 502 });
  }
  if (!user) {
    return NextResponse.json(
      { success: false, message: '未在 NewAPI 找到该邮箱注册的账号,请先去 api.nassaapi.xyz 注册' },
      { status: 404 },
    );
  }

  const originalGroup = user.group || DEFAULT_GROUP;
  if (originalGroup === TARGET_GROUP) {
    // 已经是目标组,无需重复升级 — 但仍消耗卡密会很坑,直接拒绝
    return NextResponse.json(
      { success: false, message: `账号已是 ${TARGET_GROUP} 组,无需重复升级` },
      { status: 409 },
    );
  }

  // 升级 group
  try {
    await updateUserGroup(user.id, TARGET_GROUP);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[activate] updateUserGroup error:', msg);
    return NextResponse.json({ success: false, message: `升级失败: ${msg}` }, { status: 502 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + card.plan_days * 86400;

  // 写入 sqlite + 计划 revert task
  activateCard(code, user.id, email, ip, expiresAt);
  insertRevertTask({
    card_code: code,
    user_id: user.id,
    email,
    original_group: originalGroup,
    target_group: TARGET_GROUP,
    scheduled_at: expiresAt,
  });

  console.log(`[activate] user ${user.id} (${email}) ${originalGroup} -> ${TARGET_GROUP} for ${card.plan_days}d via ${code}`);

  return NextResponse.json({
    success: true,
    already_activated: false,
    data: {
      email,
      user_id: user.id,
      target_group: TARGET_GROUP,
      plan_days: card.plan_days,
      activated_at: nowSec,
      expires_at: expiresAt,
    },
  });
}
