import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  getCardByTokenKey,
  insertPptTask,
  markExpiredCards,
  updatePptTask,
} from '@/lib/db';
import { clientIp } from '@/lib/client-ip';
import { apiKeyFromRequest, validateSkKey } from '@/lib/ppt/api';
import {
  PPT_DEFAULT_SLIDES,
  PPT_MAX_SLIDES,
  PPT_MIN_SLIDES,
  PPT_REQUEST_BASE_URL,
} from '@/lib/ppt/constants';
import { buildPptx } from '@/lib/ppt/generator';
import { assertActivePptCard, assertPptQuotaAvailable, getPptQuotaSnapshot, PptAccessError } from '@/lib/ppt/quota';
import { PPT_SCENARIOS, PPT_STYLES, PPT_TEMPLATES, type PptCreateInput } from '@/lib/ppt/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TITLE_LEN = 90;
const MAX_INPUT_LEN = 16000;

function deny(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

function trimText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeChoice(value: string, allowed: readonly string[], fallback: string): string {
  return allowed.includes(value) ? value : fallback;
}

function normalizeTemplate(value: string): string {
  return PPT_TEMPLATES.some((t) => t.id === value) ? value : PPT_TEMPLATES[0].id;
}

export async function POST(req: NextRequest) {
  let body: Partial<PptCreateInput> & Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return deny('请求格式错误');
  }

  const apiKey = apiKeyFromRequest(req, body);
  const keyError = validateSkKey(apiKey);
  if (keyError) return deny(keyError);

  const title = trimText(body.title, MAX_TITLE_LEN);
  const inputText = trimText(body.inputText, MAX_INPUT_LEN);
  const scenario = normalizeChoice(trimText(body.scenario, 40), PPT_SCENARIOS, PPT_SCENARIOS[0]);
  const style = normalizeChoice(trimText(body.style, 40), PPT_STYLES, PPT_STYLES[0]);
  const templateId = normalizeTemplate(trimText(body.templateId, 40));
  const slideCountRaw = Number(body.slideCount || PPT_DEFAULT_SLIDES);
  const slideCount = Number.isInteger(slideCountRaw)
    ? Math.min(PPT_MAX_SLIDES, Math.max(PPT_MIN_SLIDES, slideCountRaw))
    : PPT_DEFAULT_SLIDES;

  if (!title) return deny('请输入 PPT 标题');
  if (!inputText) return deny('请输入 PPT 内容');
  if (inputText.length < 8) return deny('内容太短,请补充更多信息');

  const ip = clientIp(req);
  if (!checkRateLimit(`ppt-create:ip:${ip}`, 8, 60)) {
    return deny('请求太频繁,请稍后再试', 429);
  }
  if (!checkRateLimit(`ppt-create:key:${apiKey.slice(0, 32)}`, 4, 60)) {
    return deny('请求太频繁,请稍后再试', 429);
  }

  markExpiredCards();
  const card = getCardByTokenKey(apiKey);
  if (!card) return deny('未找到该 API Key', 404);

  try {
    assertActivePptCard(card);
    assertPptQuotaAvailable(card);
  } catch (e: any) {
    if (e instanceof PptAccessError) return deny(e.message, e.status);
    return deny(e?.message || 'PPT 生成不可用', 403);
  }

  const taskId = `ppt_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  insertPptTask({
    task_id: taskId,
    card_id: card.id,
    sk_key: apiKey,
    title,
    scenario,
    style,
    slide_count: slideCount,
    template_id: templateId,
    input_text: inputText,
    status: 'generating',
    pptx_path: null,
    error_message: null,
    quota_charged: 0,
  });

  try {
    const built = await buildPptx({
      taskId,
      title,
      scenario,
      style,
      slideCount,
      templateId,
      inputText,
    });
    const task = updatePptTask(taskId, {
      status: 'success',
      pptx_path: built.filePath,
      error_message: null,
      quota_charged: 1,
    });
    const quota = getPptQuotaSnapshot(card);

    return NextResponse.json({
      success: true,
      data: {
        requestBaseUrl: PPT_REQUEST_BASE_URL,
        taskId,
        status: task?.status || 'success',
        downloadUrl: `/api/ppt/download?taskId=${encodeURIComponent(taskId)}`,
        quota: {
          total: quota.total,
          used: quota.used,
          remaining: quota.remaining,
          unlimited: quota.unlimited,
        },
      },
    });
  } catch (e: any) {
    const message = e?.message || 'PPT 生成失败';
    updatePptTask(taskId, {
      status: 'failed',
      error_message: message,
      quota_charged: 0,
    });
    return deny(message, 500);
  }
}

