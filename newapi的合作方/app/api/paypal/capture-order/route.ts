// POST /api/paypal/capture-order
// Body: { order_id: string }
//
// 流程:
//   1. 从请求 cookie + N-A-U 调 NewAPI /api/user/self,确认当前登录用户(防止 user_id 伪造)
//   2. PayPal capture 订单,验证 status=COMPLETED 拿到真实成交金额
//   3. 用 admin access token 调 NewAPI /api/user/manage action=add_quota 加 quota
//   4. 返回 { added_usd, new_balance }(new_balance 选返,前端可显示)
//
// 安全性要点:
//   - user_id 不接受客户端传入 — 永远从 cookie session 推导(NewAPI /api/user/self 的 data.id)
//   - amount 不信前端 body — 永远以 PayPal capture 响应里的 amount 为准
//   - admin token 仅在服务端使用,绝不下放到前端

import { NextRequest, NextResponse } from "next/server";
import { captureOrder, paypalConfigured } from "@/lib/paypal";

export const runtime = "nodejs";

const QUOTA_PER_USD = 500_000; // NewAPI 默认 quota_per_unit
const UPSTREAM = process.env.NEWAPI_UPSTREAM || "https://api.toplenged.com";
const ADMIN_TOKEN = process.env.NEWAPI_ADMIN_ACCESS_TOKEN || "";

type SelfResp = {
  success: boolean;
  message?: string;
  data?: { id: number; username: string; quota: number; used_quota: number };
};

async function getCurrentUser(req: NextRequest): Promise<SelfResp["data"] | null> {
  const headers = new Headers();
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const nau = req.headers.get("new-api-user");
  if (nau) headers.set("new-api-user", nau);

  const r = await fetch(`${UPSTREAM}/api/user/self`, { headers, redirect: "follow", cache: "no-store" });
  if (!r.ok) return null;
  const j = (await r.json()) as SelfResp;
  if (!j.success || !j.data?.id) return null;
  return j.data;
}

async function adminAddQuota(userId: number, quota: number): Promise<void> {
  if (!ADMIN_TOKEN) throw new Error("NEWAPI_ADMIN_ACCESS_TOKEN not set");

  const r = await fetch(`${UPSTREAM}/api/user/manage`, {
    method: "POST",
    headers: {
      Authorization: ADMIN_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: userId,
      action: "add_quota",
      mode: "add",
      value: quota,
    }),
    cache: "no-store",
  });

  const j = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string };
  if (!r.ok || !j.success) {
    throw new Error(`NewAPI add_quota failed: ${r.status} ${j.message || "unknown"}`);
  }
}

export async function POST(req: NextRequest) {
  if (!paypalConfigured()) {
    return NextResponse.json(
      { success: false, message: "PayPal not configured" },
      { status: 503 }
    );
  }
  if (!ADMIN_TOKEN) {
    return NextResponse.json(
      { success: false, message: "Server not configured for top-up (admin token missing)" },
      { status: 503 }
    );
  }

  let body: { order_id?: unknown };
  try {
    body = (await req.json()) as { order_id?: unknown };
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }
  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  if (!orderId) {
    return NextResponse.json({ success: false, message: "order_id required" }, { status: 400 });
  }

  // 1) 确认登录态(防止 user_id 伪造)
  const me = await getCurrentUser(req);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
  }

  // 2) PayPal capture
  let cap: Awaited<ReturnType<typeof captureOrder>>;
  try {
    cap = await captureOrder(orderId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "capture failed";
    console.error("[paypal/capture-order] PayPal:", msg);
    return NextResponse.json({ success: false, message: msg }, { status: 502 });
  }

  // 3) NewAPI 上账
  const quotaToAdd = Math.round(cap.capturedAmountUSD * QUOTA_PER_USD);
  try {
    await adminAddQuota(me.id, quotaToAdd);
  } catch (err) {
    // 已扣款但上账失败 — 严重事件,打日志,返回 502,让运营手动补
    const msg = err instanceof Error ? err.message : "add_quota failed";
    console.error(
      "[paypal/capture-order] CRITICAL: paid but add_quota failed",
      {
        userId: me.id,
        username: me.username,
        orderId,
        paypalCaptureId: cap.rawCaptureId,
        amountUSD: cap.capturedAmountUSD,
        payerEmail: cap.payerEmail,
        error: msg,
      }
    );
    return NextResponse.json(
      {
        success: false,
        message: `Payment captured but credit failed: ${msg}. Please contact support with order ${orderId}.`,
      },
      { status: 502 }
    );
  }

  console.log(
    "[paypal/capture-order] OK",
    {
      userId: me.id,
      username: me.username,
      orderId,
      paypalCaptureId: cap.rawCaptureId,
      amountUSD: cap.capturedAmountUSD,
      addedQuota: quotaToAdd,
      payerEmail: cap.payerEmail,
    }
  );

  return NextResponse.json({
    success: true,
    data: {
      added_usd: cap.capturedAmountUSD,
      added_quota: quotaToAdd,
      order_id: orderId,
      capture_id: cap.rawCaptureId,
    },
  });
}
