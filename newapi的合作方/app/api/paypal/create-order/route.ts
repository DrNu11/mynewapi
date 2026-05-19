// POST /api/paypal/create-order
// Body: { amount: number(USD) }
// 调 PayPal Orders v2 创建订单,返回 { id } 给前端 SDK 用于支付
//
// 注意:此路由必须在 catch-all /api/[...path]/route.ts 之前匹配。
// Next.js 14 静态路由优先于 dynamic catch-all,所以这里安全。

import { NextRequest, NextResponse } from "next/server";
import { createOrder, paypalConfigured } from "@/lib/paypal";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!paypalConfigured()) {
    return NextResponse.json(
      {
        success: false,
        message: "PayPal not configured on server (missing PAYPAL_CLIENT_ID/SECRET)",
      },
      { status: 503 }
    );
  }

  let body: { amount?: unknown };
  try {
    body = (await req.json()) as { amount?: unknown };
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 5 || amount > 5000) {
    return NextResponse.json(
      { success: false, message: "Amount must be 5–5000 USD" },
      { status: 400 }
    );
  }

  try {
    const order = await createOrder(amount);
    return NextResponse.json({ success: true, data: { id: order.id, status: order.status } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "PayPal createOrder error";
    console.error("[paypal/create-order]", msg);
    return NextResponse.json({ success: false, message: msg }, { status: 502 });
  }
}
