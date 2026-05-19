// BFF 反代路由 — 把 /api/* 透传到 NewAPI 后端
//
// 为什么不直接从浏览器调 https://api.toplenged.com/api/*?
//   1. NewAPI 用 session cookie 鉴权,不是 JWT
//   2. 207:1555 是 HTTP,api.toplenged.com 是 HTTPS,跨域 Secure cookie 浏览器拒收
//   3. 同源 BFF 模式避开所有跨域 / cookie 兼容性问题
//
// 工作流:
//   浏览器 → POST /api/user/login → 本路由 → POST https://api.toplenged.com/api/user/login
//   ← 透传 NewAPI 的 set-cookie(去掉 Secure 标志让本地 HTTP 也能收)
//
// 上游地址通过环境变量 NEWAPI_UPSTREAM 配置(默认 https://api.toplenged.com)

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM = process.env.NEWAPI_UPSTREAM || "https://api.toplenged.com";

// 不允许从前端转发的敏感 header(避免 SSRF / header injection)
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailers",
  "content-length", // fetch 会自动算
]);

async function proxy(req: NextRequest, path: string[]) {
  const search = req.nextUrl.search; // 透传查询参数
  const upstreamURL = `${UPSTREAM}/api/${path.join("/")}${search}`;

  // 转发 headers(去 hop-by-hop)
  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  });
  // 重写 Host 让 NewAPI 的 caddy 路由正确
  headers.set("host", new URL(UPSTREAM).host);

  const init: RequestInit = {
    method: req.method,
    headers,
    // 让 BFF 自己跟随 NewAPI 的 301/308(常见于 trailing slash 规范化)
    // 否则浏览器收到 301 会试图跨域 follow 到 https://api.toplenged.com 失败
    redirect: "follow",
  };

  // 透传 body(注意 GET/HEAD 不能带 body)
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  let upstreamResp: Response;
  try {
    upstreamResp = await fetch(upstreamURL, init);
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `Upstream unreachable: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  // 透传响应,重写 set-cookie
  //   - 去掉 Secure(本地 HTTP 才能收)
  //   - 去掉 SameSite=None 改 Lax(本地 HTTP 不接受 SameSite=None 而无 Secure)
  //   - Domain 去掉(让浏览器自动绑定 app 域名)
  const respHeaders = new Headers();
  upstreamResp.headers.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") return; // 单独处理
    if (HOP_BY_HOP.has(k.toLowerCase())) return;
    respHeaders.append(k, v);
  });

  // Next.js 把 multi-cookie 合并到 getSetCookie()
  const setCookies = upstreamResp.headers.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    const cleaned = raw
      .replace(/;\s*Secure/gi, "")
      .replace(/;\s*SameSite=None/gi, "; SameSite=Lax")
      .replace(/;\s*Domain=[^;]+/gi, "");
    respHeaders.append("set-cookie", cleaned);
  }

  return new NextResponse(upstreamResp.body, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: respHeaders,
  });
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export async function PUT(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export async function PATCH(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
