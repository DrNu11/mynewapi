import { NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { createRedemptions, usdToQuota } from "@/lib/newapi";
import {
  insertRedemptionLink,
  getActiveLinkByCustomerLabel,
} from "@/lib/db";
import { SITE } from "@/lib/constants";
import { getPublicOrigin } from "@/lib/utils";

/**
 * 机器人专用发货端点 — 被 xianyu-auto-reply 等自动回复机器人调用。
 *
 * 认证：`X-Bot-Secret` header 必须等于 env 里的 BOT_SHARED_SECRET
 *       （不走 Basic Auth，middleware 只拦 /admin 与 /api/admin）
 *
 * 请求：POST JSON
 *   {
 *     amount_usd: number,   // 必填 — 这笔订单对应多少美元额度
 *     order_id?: string,    // 订单号，用于幂等 + 记录
 *     item_id?: string,     // 商品 ID
 *     buyer_id?: string,    // 买家 ID
 *     spec_name?: string,   // 规格名
 *     spec_value?: string,  // 规格值
 *     platform?: string     // 平台名，默认 "xianyu"
 *   }
 *
 * 响应：HTTP 200 JSON
 *   { content: "<直接发给买家的消息全文>",
 *     data:    "<同上，兼容 xianyu-auto-reply 字段提取顺序>",
 *     short_url: ..., short_id: ..., is_duplicate: bool }
 *
 * xianyu-auto-reply 的 _get_api_card_content 会按 data → content → card 顺序提取字段。
 */

const generateShortId = customAlphabet(
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  8
);

interface BotRedeemBody {
  amount_usd: number;
  order_id?: string;
  item_id?: string;
  buyer_id?: string;
  spec_name?: string;
  spec_value?: string;
  platform?: string;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  // ========== 共享密钥认证 ==========
  const expectedSecret = process.env.BOT_SHARED_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured: BOT_SHARED_SECRET not set" },
      { status: 500 }
    );
  }

  // 兼容多种 header 名 — xianyu-auto-reply 配置的 header 键完全由用户控制
  const gotSecret =
    req.headers.get("x-bot-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (gotSecret !== expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing bot secret" },
      { status: 401 }
    );
  }

  // ========== 解析请求体 ==========
  let body: BotRedeemBody;
  try {
    body = (await req.json()) as BotRedeemBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const amount = Number(body.amount_usd);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { ok: false, error: "amount_usd 必须是大于 0 的数字" },
      { status: 400 }
    );
  }
  if (amount > 1000) {
    return NextResponse.json(
      { ok: false, error: "机器人单笔不能超过 $1000，请联系运营" },
      { status: 400 }
    );
  }

  const platform = (body.platform || "xianyu").slice(0, 20);
  const orderId = body.order_id?.slice(0, 80) || "";
  const itemId = body.item_id?.slice(0, 80) || "";
  const buyerId = body.buyer_id?.slice(0, 80) || "";

  // customer_label 用于幂等：同一 order_id 重试只生成一次码
  const customerLabel = orderId
    ? `${platform}:${orderId}`
    : `${platform}:anon:${Date.now()}`;

  const origin = getPublicOrigin(req);

  // ========== 幂等检查 ==========
  if (orderId) {
    const existing = getActiveLinkByCustomerLabel(customerLabel);
    if (existing) {
      const shortUrl = `${origin}/r/${existing.short_id}`;
      const content = renderDeliveryMessage({
        shortUrl,
        amountUsd: existing.amount_usd ?? amount,
      });
      return NextResponse.json({
        ok: true,
        content,
        data: content,
        short_id: existing.short_id,
        short_url: shortUrl,
        amount_usd: existing.amount_usd,
        is_duplicate: true,
      });
    }
  }

  // ========== 调 New API 创建兑换码 ==========
  const quota = usdToQuota(amount);
  const newapiName = `bot-${platform}-${Date.now()}`.slice(0, 20);

  let codes: string[];
  try {
    codes = await createRedemptions({
      name: newapiName,
      quota,
      count: 1,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `调用 New API 失败: ${msg}` },
      { status: 502 }
    );
  }

  const code = codes[0];

  // 备注里堆一些上下文，事后好排查
  const memoParts = [
    `机器人[${platform}]`,
    orderId ? `订单:${orderId}` : null,
    itemId ? `商品:${itemId}` : null,
    buyerId ? `买家:${buyerId}` : null,
    body.spec_value || body.spec_name
      ? `规格:${body.spec_name ?? ""}=${body.spec_value ?? ""}`
      : null,
  ].filter(Boolean);
  const memo = memoParts.join(" / ").slice(0, 200);

  // ========== 生成短链并入库 ==========
  let shortId = "";
  for (let i = 0; i < 5; i++) {
    shortId = generateShortId();
    try {
      insertRedemptionLink({
        short_id: shortId,
        redemption_code: code,
        newapi_name: newapiName,
        amount_quota: quota,
        amount_usd: amount,
        memo,
        customer_label: customerLabel,
      });
      break;
    } catch (e) {
      if (i === 4) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          { ok: false, error: `写入数据库失败: ${msg}` },
          { status: 500 }
        );
      }
    }
  }

  const shortUrl = `${origin}/r/${shortId}`;
  const content = renderDeliveryMessage({ shortUrl, amountUsd: amount });

  return NextResponse.json({
    ok: true,
    content,
    data: content, // 与 xianyu-auto-reply 的字段提取顺序兼容
    short_id: shortId,
    short_url: shortUrl,
    amount_usd: amount,
    is_duplicate: false,
  });
}

// GET 用于让用户在浏览器直接测试端点是否通、是否能识别 secret
export async function GET(req: Request) {
  const expectedSecret = process.env.BOT_SHARED_SECRET;
  const gotSecret =
    new URL(req.url).searchParams.get("secret") ||
    req.headers.get("x-bot-secret") ||
    "";
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/bot/redeem",
    expect_header: "X-Bot-Secret: <BOT_SHARED_SECRET>",
    secret_configured: Boolean(expectedSecret),
    secret_matched:
      Boolean(expectedSecret) && gotSecret === expectedSecret,
    example_body: {
      amount_usd: 0.7,
      order_id: "1234567890",
      item_id: "item_id_here",
      buyer_id: "buyer_id_here",
      spec_name: "套餐",
      spec_value: "基础包",
      platform: "xianyu",
    },
  });
}

/** 渲染要发给买家的消息文本 */
function renderDeliveryMessage(args: {
  shortUrl: string;
  amountUsd: number;
}): string {
  const tmpl =
    process.env.BOT_DELIVERY_TEMPLATE ??
    [
      "感谢购买 ${BRAND} 中转站额度 ✨",
      "",
      "您的兑换链接（点击查看兑换码和使用教程）：",
      "${SHORT_URL}",
      "",
      "快速使用：",
      "1. 打开链接复制兑换码",
      "2. 登录 ${CONSOLE_HOST}（支持邮箱/密码注册）",
      "3. 进入「钱包」-「兑换码」粘贴即可到账",
      "",
      "有任何问题请联系 ${EMAIL} ❤️",
    ].join("\n");

  return tmpl
    .replace(/\$\{SHORT_URL\}/g, args.shortUrl)
    .replace(/\$\{AMOUNT_USD\}/g, args.amountUsd.toFixed(2))
    .replace(/\$\{BRAND\}/g, SITE.brand)
    .replace(/\$\{EMAIL\}/g, SITE.email)
    .replace(
      /\$\{CONSOLE_HOST\}/g,
      new URL(SITE.consoleUrl).host
    );
}
