import { NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { createRedemptions, usdToQuota } from "@/lib/newapi";
import { insertRedemptionLink } from "@/lib/db";
import { getPublicOrigin } from "@/lib/utils";

// 短链 ID 用 8 位 base58 字符（去掉视觉相似的 0/O/I/l），仅约 4×10^13 组合
const generateShortId = customAlphabet(
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  8
);

interface CreateBody {
  /** USD 金额（必填）。数据落库会转换为 New API 内部 quota 单位 */
  amount_usd: number;
  /** 生成多少张码，默认 1 */
  count?: number;
  /** 老板备注，例如 "@张三老客户特价" */
  memo?: string;
  /** 客户标识，便于事后追溯 */
  customer_label?: string;
  /** 兑换码本身的过期时间（小时数），可选。0 或不传 = 永不过期 */
  expires_in_hours?: number;
}

interface CreatedItem {
  short_id: string;
  short_url: string;
  redemption_code: string;
  amount_usd: number;
  amount_quota: number;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // ===== 输入校验 =====
  const amount = Number(body.amount_usd);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { ok: false, error: "amount_usd 必须是大于 0 的数字" },
      { status: 400 }
    );
  }
  if (amount > 10000) {
    return NextResponse.json(
      { ok: false, error: "amount_usd 单次不能超过 $10000，请联系开发者放开限制" },
      { status: 400 }
    );
  }

  const count = Math.max(1, Math.min(100, Math.floor(body.count ?? 1)));
  const memo = body.memo?.slice(0, 200) ?? null;
  const customerLabel = body.customer_label?.slice(0, 100) ?? null;

  let expiredTime = 0;
  let expiresAtIso: string | null = null;
  if (body.expires_in_hours && body.expires_in_hours > 0) {
    const expiresAt = new Date(
      Date.now() + body.expires_in_hours * 3600 * 1000
    );
    expiredTime = Math.floor(expiresAt.getTime() / 1000);
    expiresAtIso = expiresAt.toISOString();
  }

  const quota = usdToQuota(amount);

  // ===== 调 New API 批量创建兑换码 =====
  const newapiName = `auto-${Date.now()}`.slice(0, 20);
  let codes: string[];
  try {
    codes = await createRedemptions({
      name: newapiName,
      quota,
      count,
      expiredTime,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `调用 New API 失败: ${e.message ?? e}` },
      { status: 502 }
    );
  }

  // ===== 为每个码生成短链并写库 =====
  const origin = getPublicOrigin(req);
  const created: CreatedItem[] = [];
  for (const code of codes) {
    // 极小概率撞 short_id，循环重试
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
          expires_at: expiresAtIso,
        });
        break;
      } catch (e: any) {
        if (i === 4) throw e;
        // 否则换一个 short_id 再试
      }
    }
    created.push({
      short_id: shortId,
      short_url: `${origin}/r/${shortId}`,
      redemption_code: code,
      amount_usd: amount,
      amount_quota: quota,
    });
  }

  return NextResponse.json({ ok: true, items: created });
}
