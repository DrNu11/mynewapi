import { NextRequest, NextResponse } from 'next/server';

import { isAdminAuthenticated } from '@/lib/auth';
import {
  allowedSurgeModels,
  getModelMultiplierGroups,
  setModelMultipliers,
} from '@/lib/model-multipliers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
}

export async function GET() {
  if (!isAdminAuthenticated()) return unauthorized();
  try {
    const groups = await getModelMultiplierGroups();
    return NextResponse.json({ success: true, data: { groups } });
  } catch (error) {
    console.error('[admin/model-multipliers] load failed:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '读取倍率失败' },
      { status: 502 },
    );
  }
}

export async function PUT(req: NextRequest) {
  if (!isAdminAuthenticated()) return unauthorized();
  let body: { models?: unknown; multiplier?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const models = Array.isArray(body.models)
    ? body.models.filter((model): model is string => typeof model === 'string')
    : [];
  const allowed = new Set(allowedSurgeModels());
  if (models.length === 0 || models.some((model) => !allowed.has(model))) {
    return NextResponse.json({ success: false, message: '模型列表无效' }, { status: 400 });
  }

  try {
    await setModelMultipliers(models, body.multiplier);
    const groups = await getModelMultiplierGroups();
    return NextResponse.json({ success: true, data: { groups } });
  } catch (error) {
    console.error('[admin/model-multipliers] update failed:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : '保存倍率失败' },
      { status: 400 },
    );
  }
}
