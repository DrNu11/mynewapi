/**
 * /v1/* OpenAI 兼容代理路由
 *
 * 客户用 https://card.nassaapi.xyz/v1/* 调用,流程:
 *   1. 解析 Bearer sk-key
 *   2. 查 sqlite cards 表确认是卡密激活的 sk(老客户的 sk 不在,会被拒绝走 api.nassaapi.xyz)
 *   3. 校验状态/过期/RPH
 *   4. 透传到本机 NewAPI docker (127.0.0.1:3000),保留流式 SSE
 *   5. 记录到 request_logs 用于限速 + admin 观测
 */

import { NextRequest } from 'next/server';
import {
  getCardByTokenKey,
  countCurrentHourRequests,
  recordRequest,
} from '@/lib/db';
import { isCategory, legacyModels, modelsForCategory } from '@/lib/categories';
import {
  insertAuditEntry,
  updateAuditEntry,
  detectSuspicious,
  extractPromptText,
  normalizePromptHash,
} from '@/lib/audit';
import { normalizeMessages, normalizeResponsesInput } from '@/lib/normalize-messages';
import { makeThinkStripTransform } from '@/lib/strip-think';
// side-effect import:启动后台清理 cron(每 6h 跑 markExpiredCards / pruneOldRequests / pruneOldAudit)
import '@/lib/cleanup-bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 不预渲染,所有请求都到 handler
export const fetchCache = 'force-no-store';

// 优先用专门的内部地址,否则复用 NEWAPI_BASE_URL(目前公网走 https://api.nassaapi.xyz)
const NEWAPI_UPSTREAM = (
  process.env.NEWAPI_INTERNAL_URL ||
  process.env.NEWAPI_BASE_URL ||
  'https://api.nassaapi.xyz'
).replace(/\/$/, '');

/**
 * 错误响应工具 — 模仿上游 NewAPI 的 401/403 响应格式,
 * 让客户端工具(如 CC Switch)用同样的指纹识别,避免它走 fallback 路径
 * 把 base_url 错位写到 [tui].model_availability_nux 等错位位置。
 *
 * 关键:
 *   - 错误体格式: { error: { code: "", message, type: "new_api_error" } }(跟 NewAPI 一致)
 *   - 响应头: x-new-api-version, x-oneapi-request-id(NewAPI 指纹)
 */
function newapiRequestId(): string {
  // 模仿 NewAPI 的 request id: 时间戳(YYYYMMDDHHmmss) + 微秒 + 随机
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ymd =
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds());
  const us = pad(d.getUTCMilliseconds(), 3) + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const tail = Math.random().toString(36).slice(2, 12);
  return `${ymd}${us}${tail}`;
}

function jsonError(status: number, message: string, type = 'new_api_error') {
  const reqId = newapiRequestId();
  return new Response(
    JSON.stringify({
      error: {
        code: '',
        message: `${message} (request id: ${reqId})`,
        type,
      },
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // NewAPI 指纹 header — CC Switch 等工具用来识别"NewAPI 兼容服务"
        'x-new-api-version': 'hide-model-20260504',
        'x-oneapi-request-id': reqId,
      },
    }
  );
}

/**
 * Audit 累积器 — 边透传 chunk 边解析响应内容。
 * 同时支持流式(SSE)和非流式(单个 JSON chunk)。
 * 流结束后 flush 阶段 updateAuditEntry 写入 response_text / tokens / flagged。
 * 所有错误 try/catch 包住,不影响主代理。
 */
function makeAuditAccumulator(
  auditId: number,
  startTime: number,
  isStream: boolean,
  preFlagReasons: string[] = [],
): TransformStream<Uint8Array, Uint8Array> {
  let raw = '';
  let buf = '';
  let accContent = '';
  let accReasoning = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let finishReason: string | null = null;
  const dec = new TextDecoder();
  const ACC_LIMIT = 200_000; // 200KB 上限防 OOM(154 内存紧张)

  return new TransformStream({
    transform(chunk, ctrl) {
      ctrl.enqueue(chunk); // 始终透传
      try {
        const text = dec.decode(chunk, { stream: true });
        buf += text;
        if (raw.length < ACC_LIMIT) {
          raw += text.slice(0, ACC_LIMIT - raw.length);
        }
        if (isStream) {
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const obj = JSON.parse(data);
              const delta = obj?.choices?.[0]?.delta;
              if (delta?.content && accContent.length < ACC_LIMIT) {
                accContent += delta.content;
              }
              if (delta?.reasoning_content && accReasoning.length < ACC_LIMIT) {
                accReasoning += delta.reasoning_content;
              }
              const fr = obj?.choices?.[0]?.finish_reason;
              if (fr) finishReason = fr;
              if (obj?.usage) {
                promptTokens = obj.usage.prompt_tokens || promptTokens;
                completionTokens = obj.usage.completion_tokens || completionTokens;
              }
            } catch {
              // 单行 JSON parse 失败忽略
            }
          }
        }
      } catch {
        // accumulator 失败不影响主代理
      }
    },
    flush() {
      try {
        if (!isStream) {
          // 非流式: raw 是完整 JSON
          try {
            const obj = JSON.parse(raw);
            accContent = obj?.choices?.[0]?.message?.content ?? '';
            accReasoning = obj?.choices?.[0]?.message?.reasoning_content ?? '';
            finishReason = obj?.choices?.[0]?.finish_reason ?? null;
            promptTokens = obj?.usage?.prompt_tokens || 0;
            completionTokens = obj?.usage?.completion_tokens || 0;
          } catch {
            // 不是 JSON 就仅记录 raw
          }
        }
        const respHits = detectSuspicious(accContent + ' ' + accReasoning);
        // 合并请求阶段 + 响应阶段的关键词命中 (去重)
        const allHits = [...new Set([...preFlagReasons, ...respHits])];
        updateAuditEntry(auditId, {
          response_text: accContent || (raw.length < 5000 ? raw : ''),
          reasoning_text: accReasoning,
          response_finish_reason: finishReason ?? undefined,
          prompt_tokens: promptTokens || undefined,
          completion_tokens: completionTokens || undefined,
          duration_ms: Date.now() - startTime,
          flagged: allHits.length > 0 ? 1 : 0,
          flag_reason: allHits.length > 0 ? allHits.join(',') : undefined,
        });
      } catch {
        // flush 失败不抛
      }
    },
  });
}

/**
 * 流式 SSE 心跳 — 防止 Cloudflare 524 (origin response timeout)。
 *
 * 触发场景:MiniMax M2.7 等 reasoning 模型在大 prompt(>50K tokens)推理阶段,
 * frt(首字节)可能 60-100s,期间 SSE 流没有任何 chunk。Cloudflare 默认 100s
 * 没活动就主动 524 切断,客户看到 origin_response_timeout。
 *
 * 解法:每 intervalMs 没收到上游 chunk 就向客户注入一行 SSE comment(`: heartbeat\n\n`)。
 * SSE 协议规定以 ":" 开头是注释,OpenAI / Anthropic / 标准 EventSource 都自动忽略,
 * 不会被当成 data。Cloudflare 边缘看到流"在动"就不会触发 524。
 *
 * 仅对 SSE 响应启用(content-type: text/event-stream)。
 */
function makeHeartbeatTransform(intervalMs = 25_000): TransformStream<Uint8Array, Uint8Array> {
  const enc = new TextEncoder();
  const HEARTBEAT = enc.encode(': heartbeat\n\n');
  let lastActivityAt = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ctrlRef: TransformStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  // 检查频率:intervalMs / 4,但下限 1s 上限 5s,避免空转 CPU
  const checkPeriodMs = Math.min(5_000, Math.max(1_000, Math.floor(intervalMs / 4)));
  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      ctrlRef = controller;
      timer = setInterval(() => {
        if (closed || !ctrlRef) return;
        if (Date.now() - lastActivityAt >= intervalMs) {
          try {
            ctrlRef.enqueue(HEARTBEAT);
            lastActivityAt = Date.now();
          } catch {
            // controller 已 close 或 errored
          }
        }
      }, checkPeriodMs);
    },
    transform(chunk, controller) {
      controller.enqueue(chunk);
      lastActivityAt = Date.now();
    },
    flush() {
      closed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  });
}

/**
 * 把响应流里所有 "model":"..." 改写成客户请求的模型名,伪装上游真实模型。
 * 用于 NewAPI 后台做了"模型重定向"(如 claude-sonnet-4-6 → gpt-5.4)时,
 * 让客户响应看起来仍然是他请求的 Claude 模型,不会穿帮。
 *
 * 注意:Stream 边界可能切断 "model":"..." 字串,用 buffer 跨 chunk 拼接保护。
 */
function makeModelRewriter(requestedModel: string): TransformStream<Uint8Array, Uint8Array> {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  // JSON 中 "model":"...." 的正则,容忍 key/value 间空白
  const re = /"model"\s*:\s*"[^"]*"/g;
  const replacement = `"model":"${requestedModel.replace(/"/g, '\\"')}"`;
  // 跨 chunk 滚动 buffer:防止 "mode 被切到下个 chunk
  let buf = '';
  return new TransformStream({
    transform(chunk, ctrl) {
      buf += dec.decode(chunk, { stream: true });
      // 留最后 64 个字符不发,以免切断 "model":"...."
      const TAIL_KEEP = 64;
      if (buf.length > TAIL_KEEP) {
        const cut = buf.length - TAIL_KEEP;
        const out = buf.slice(0, cut).replace(re, replacement);
        buf = buf.slice(cut);
        ctrl.enqueue(enc.encode(out));
      }
    },
    flush(ctrl) {
      const out = buf.replace(re, replacement);
      if (out) ctrl.enqueue(enc.encode(out));
    },
  });
}

async function handle(req: NextRequest, pathParts: string[]) {
  // 1. 取 sk-key — 同时支持 OpenAI 风格(Authorization: Bearer)和 Anthropic 原生(x-api-key)
  const auth = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';
  let sk = '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    sk = auth.slice(7).trim();
  } else if (apiKeyHeader) {
    sk = apiKeyHeader.trim();
  }
  if (!sk) {
    return jsonError(401, '缺少认证头(Authorization: Bearer sk-xxx 或 x-api-key)');
  }

  // 2. 查卡 — 不在卡密表 = 不接受(老客户走 api.nassaapi.xyz)
  const card = getCardByTokenKey(sk);
  if (!card) {
    return jsonError(
      401,
      'sk-key 不属于卡密系统;若是后台直发 token,请用 https://api.nassaapi.xyz/v1'
    );
  }

  // 3. 状态/过期检查
  const now = Math.floor(Date.now() / 1000);
  if (card.status === 'expired' || (card.expires_at && card.expires_at <= now)) {
    return jsonError(403, '卡密已过期', 'forbidden');
  }
  if (card.status !== 'activated') {
    return jsonError(403, `卡密状态异常: ${card.status}`, 'forbidden');
  }

  // 4. RPH 限速 — 整点固定窗口(每小时 hh:00 重置)
  if (card.rph > 0) {
    const { used, nextResetAt } = countCurrentHourRequests(sk);
    if (used >= card.rph) {
      const retryAfter = Math.max(1, nextResetAt - Math.floor(Date.now() / 1000));
      const resp = jsonError(
        429,
        `每小时请求数已达上限 ${card.rph} 次,${retryAfter} 秒后(整点)重置`,
        'rate_limit_exceeded'
      );
      resp.headers.set('retry-after', String(retryAfter));
      return resp;
    }
  }

  // 5. 读 body 一次,顺便解析出客户请求的 model(用于响应伪装)
  //    并按路径做 system role 规范化，适配 MiniMax 等上游对 system 的双约束:
  //      - /v1/chat/completions:        normalizeMessages(body.messages)
  //      - /v1/responses (codex CLI):   normalizeResponsesInput(body.input)
  //    (Anthropic /v1/messages / embeddings 等不动,避免破坏原生协议)
  let bodyText: string | undefined;
  let requestedModel: string | null = null;
  if (!['GET', 'HEAD'].includes(req.method)) {
    bodyText = await req.text();
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        if (typeof parsed?.model === 'string') requestedModel = parsed.model;

        const isChatCompletions =
          pathParts.length >= 2 &&
          pathParts[0] === 'chat' &&
          pathParts[1] === 'completions';
        const isResponses =
          pathParts.length >= 1 && pathParts[0] === 'responses';

        let mutated = false;
        if (isChatCompletions && Array.isArray(parsed?.messages)) {
          const normalized = normalizeMessages(parsed.messages);
          if (normalized !== parsed.messages) {
            parsed.messages = normalized;
            mutated = true;
          }
        } else if (isResponses && parsed?.input !== undefined) {
          // codex CLI 0.130.0 等会发顶层 `instructions` + input 含 `developer` role,
          // NewAPI 反向转换两者都成 system,触发 MiniMax 双 system 2013。
          // 解决:在这一层把 instructions 合并到 input 的 system message 里,
          // 并把 developer role 转 system,统一合并成单 system。
          const instructions =
            typeof parsed.instructions === 'string' && parsed.instructions.length > 0
              ? parsed.instructions
              : undefined;
          const normalized = normalizeResponsesInput(parsed.input, {
            prependSystem: instructions,
          });
          if (normalized !== parsed.input) {
            parsed.input = normalized;
            mutated = true;
          }
          if (instructions !== undefined) {
            delete parsed.instructions;
            mutated = true;
          }
        }
        if (mutated) {
          bodyText = JSON.stringify(parsed);
        }
      } catch {
        // body 不是 JSON 没事，只是无法做模型伪装和 messages 规范化
      }
    }
  }

  // 5.1 model 白名单 — 客户请求的 model 不在该套餐许可列表直接 400,不浪费上游
  if (requestedModel) {
    const allowed = isCategory(card.category)
      ? modelsForCategory(card.category)
      : legacyModels();
    if (!allowed.includes(requestedModel)) {
      return jsonError(
        400,
        `模型 "${requestedModel}" 不在本套餐可用列表内。可用模型: ${allowed.join(', ')}`,
        'model_not_available'
      );
    }
  }

  // 6. 构造上游 URL
  const url = `${NEWAPI_UPSTREAM}/v1/${pathParts.join('/')}${req.nextUrl.search || ''}`;

  // 7. 拷贝 headers,过滤 hop-by-hop / host / 压缩 / cookie / cf
  const fwHeaders = new Headers();
  for (const [k, v] of req.headers) {
    const lk = k.toLowerCase();
    if (
      lk === 'host' ||
      lk === 'connection' ||
      lk === 'content-length' ||
      lk === 'accept-encoding' ||
      lk === 'cookie' ||
      lk.startsWith('cf-') ||
      lk.startsWith('x-forwarded-')
    )
      continue;
    fwHeaders.set(k, v);
  }
  // 透传客户真实 IP
  const xff =
    req.headers.get('x-forwarded-for') ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip');
  if (xff) fwHeaders.set('x-forwarded-for', xff);

  const init: RequestInit = {
    method: req.method,
    headers: fwHeaders,
    body: bodyText,
    signal: AbortSignal.timeout(720_000),
  };

  // 8.0 audit 请求阶段 INSERT(在 fetch 之前,这样即使 fetch 失败也能记录请求)
  let auditId: number | null = null;
  let preFlagReasons: string[] = [];
  const auditEndpoint = `/${pathParts.join('/')}`;
  const startTime = Date.now();
  try {
    const reqBodyJson = bodyText ? JSON.parse(bodyText) : {};
    const promptInfo = extractPromptText(auditEndpoint, reqBodyJson);
    const reqHash = promptInfo.structured ? normalizePromptHash(promptInfo.structured) : '';
    auditId = insertAuditEntry({
      card_id: card.id,
      sk_key: sk,
      ip:
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        req.headers.get('cf-connecting-ip') ??
        req.headers.get('x-real-ip') ??
        null,
      ua: req.headers.get('user-agent'),
      endpoint: auditEndpoint,
      model: requestedModel ?? 'unknown',
      request_messages: promptInfo.structured ?? bodyText?.slice(0, 5000),
      request_messages_hash: reqHash || undefined,
      request_size: bodyText?.length ?? 0,
      is_streaming: !!reqBodyJson?.stream,
      status_code: 0,
    });
    // 请求阶段关键词检测—保存到闭包变量，后续 flush 阶段合并(避免被响应阶段覆盖)
    if (auditId !== null) {
      preFlagReasons = detectSuspicious(promptInfo.text);
    }
  } catch (e) {
    console.error('[v1-proxy] audit insert failed (non-fatal):', e);
  }

  // 8. 转发
  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[v1-proxy] upstream fetch failed:', msg);
    if (auditId !== null) {
      try {
        updateAuditEntry(auditId, {
          status_code: 502,
          duration_ms: Date.now() - startTime,
        });
      } catch { }
    }
    return jsonError(502, `上游 NewAPI 服务无法访问: ${msg}`, 'service_unavailable');
  }

  // 8.1 audit fetch 后更新 status_code(响应收完后 flush 阶段会补 duration/tokens/text)
  if (auditId !== null) {
    try {
      updateAuditEntry(auditId, { status_code: upstream.status });
    } catch { }
  }

  // 9. 记录调用(带客户请求的模型名)
  try {
    recordRequest(sk, card.id, upstream.status, requestedModel);
  } catch (e) {
    console.error('[v1-proxy] recordRequest failed:', e);
  }

  // 10. 透传响应,清掉影响流式的头
  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    const lk = k.toLowerCase();
    if (
      lk === 'content-encoding' ||
      lk === 'content-length' ||
      lk === 'transfer-encoding' ||
      lk === 'connection'
    )
      continue;
    respHeaders.set(k, v);
  }

  // 11. 响应 pipeline:audit accumulator → think stripper → model rewriter → client
  // 顺序:
  //   1) audit 在前 — 累积统计时看到原始内容(含 <think>),审计完整模型行为
  //   2) think stripper — 剥离 <think>...</think> 让客户看不到思维链
  //      (MiniMax-M / mimo 等思考模型把 chain-of-thought 塞在 content 字段里)
  //   3) model rewriter 在后 — 输出给客户的响应 model 名被改写
  let body: ReadableStream<Uint8Array> | null = upstream.body as ReadableStream<Uint8Array> | null;
  const respCt = (upstream.headers.get('content-type') || '').toLowerCase();
  const isStream = respCt.includes('event-stream');
  if (body && auditId !== null) {
    try {
      body = body.pipeThrough(
        makeAuditAccumulator(auditId, startTime, isStream, preFlagReasons),
      ) as ReadableStream<Uint8Array>;
    } catch (e) {
      console.error('[v1-proxy] audit pipe failed (non-fatal):', e);
    }
  }
  // think stripper 仅对 JSON 响应有意义 — content-type 必须是 SSE 或 application/json
  const isJsonResp = respCt.includes('json');
  if (body && (isStream || isJsonResp)) {
    try {
      body = body.pipeThrough(
        makeThinkStripTransform(isStream),
      ) as ReadableStream<Uint8Array>;
    } catch (e) {
      console.error('[v1-proxy] think strip pipe failed (non-fatal):', e);
    }
  }
  if (requestedModel && body) {
    body = body.pipeThrough(makeModelRewriter(requestedModel)) as ReadableStream<Uint8Array>;
  }
  // 12. 流式响应加 SSE 心跳 — 防止 Cloudflare 524 (origin response timeout)。
  //     MiniMax M2.7 等 reasoning 模型在大 prompt(>50K tokens)推理时,frt 可能 60-100s,
  //     期间没有任何 SSE chunk,Cloudflare 默认 100s 没活动就主动 524 切断。
  //     此 transform 每 25s 没收到上游 chunk 时主动注入 SSE comment,让 CF 看到流活着。
  if (body && isStream) {
    try {
      body = body.pipeThrough(makeHeartbeatTransform(25_000)) as ReadableStream<Uint8Array>;
    } catch (e) {
      console.error('[v1-proxy] heartbeat pipe failed (non-fatal):', e);
    }
  }

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

type Ctx = { params: { path: string[] } };
export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx.params.path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx.params.path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx.params.path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx.params.path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx.params.path);
}
export async function HEAD(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx.params.path);
}
/**
 * CORS 预检 — 浏览器/Tauri/Electron webview 在跨域调 /v1/* 前会先发 OPTIONS,
 * 按规范不带 Authorization header。如果走 handle() 会被 401 拦掉,导致预检失败,
 * 客户端根本发不出真实 GET/POST(典型现象:CC Switch、Cherry Studio 在 Tauri 里"检查失败")。
 * 这里直接返回 204 + 全套 CORS headers,让预检通过。
 */
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') || '*';
  const reqHeaders =
    req.headers.get('access-control-request-headers') ||
    'authorization, content-type, x-api-key, anthropic-version';
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin === 'null' ? '*' : origin,
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS',
      'access-control-allow-headers': reqHeaders,
      'access-control-allow-credentials': 'true',
      'access-control-max-age': '86400',
      vary: 'Origin',
    },
  });
}
