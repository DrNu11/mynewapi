// PayPal Orders v2 REST API 服务端封装
//
// ⚠️ server-only — 这个文件依赖 PAYPAL_CLIENT_SECRET,**绝对不能** 在 client component 里 import。
// 只在 app/api/paypal/* route handler 里用。
//
// 文档:
//   - OAuth: https://developer.paypal.com/api/rest/authentication/
//   - Orders v2: https://developer.paypal.com/docs/api/orders/v2/

import "server-only";

function getEnv() {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  const isLive = env === "live" || env === "production";
  return {
    base: isLive ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
    isLive,
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
  };
}

export function paypalConfigured(): boolean {
  const { clientId, clientSecret } = getEnv();
  return Boolean(clientId && clientSecret);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const { base, clientId, clientSecret } = getEnv();
  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials not configured (PAYPAL_CLIENT_ID/SECRET)");
  }

  // 缓存 5 分钟内复用(PayPal token 默认 9 小时,留余量)
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`PayPal OAuth failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

export type CreateOrderResult = {
  id: string;
  status: string;
};

export async function createOrder(amountUSD: number): Promise<CreateOrderResult> {
  if (!Number.isFinite(amountUSD) || amountUSD < 5 || amountUSD > 5000) {
    throw new Error(`Invalid amount: ${amountUSD} (must be 5-5000 USD)`);
  }

  const { base } = getEnv();
  const token = await getAccessToken();

  // 用整数美分避免浮点误差
  const value = amountUSD.toFixed(2);

  const resp = await fetch(`${base}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value,
          },
          description: "Toplenged AI · Credit top-up",
        },
      ],
      application_context: {
        brand_name: "Toplenged AI",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    }),
    cache: "no-store",
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`PayPal createOrder failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as CreateOrderResult;
  return data;
}

export type CaptureResult = {
  id: string;
  status: string;
  capturedAmountUSD: number;
  payerEmail?: string;
  rawCaptureId?: string;
};

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const { base } = getEnv();
  const token = await getAccessToken();

  const resp = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    // PayPal capture 不需要 body,但有些 SDK 例子会传 {} — 这里不传更省事
    cache: "no-store",
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`PayPal captureOrder failed: ${resp.status} ${text}`);
  }

  // capture 响应结构参考 https://developer.paypal.com/docs/api/orders/v2/#orders_capture
  const data = (await resp.json()) as {
    id: string;
    status: string;
    payer?: { email_address?: string };
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{
          id: string;
          status: string;
          amount: { currency_code: string; value: string };
        }>;
      };
    }>;
  };

  const cap = data.purchase_units?.[0]?.payments?.captures?.[0];
  if (!cap) {
    throw new Error("PayPal capture response missing captures payload");
  }
  if (cap.status !== "COMPLETED") {
    throw new Error(`PayPal capture not completed: ${cap.status}`);
  }
  if (cap.amount.currency_code !== "USD") {
    throw new Error(`Unexpected currency: ${cap.amount.currency_code}`);
  }

  return {
    id: data.id,
    status: data.status,
    capturedAmountUSD: Number(cap.amount.value),
    payerEmail: data.payer?.email_address,
    rawCaptureId: cap.id,
  };
}
