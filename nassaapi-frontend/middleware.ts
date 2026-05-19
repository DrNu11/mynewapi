import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  checkAdminCredentials,
  verifySessionToken,
} from "@/lib/auth";

/**
 * Admin 鉴权中间件 - 保护 /admin/* 与 /api/admin/* 路由。
 *
 * 优先级：
 *   1. cookie 会话（浏览器走这条，登录一次 30 天有效）
 *   2. HTTP Basic Auth 兜底（仅 /api/admin/*，方便 curl/脚本调试）
 *   3. 都没有：
 *      - /admin/* 页面 → 跳 /admin/login
 *      - /api/admin/* → 401 JSON
 *
 * 必须设置环境变量：
 *   ADMIN_USERNAME
 *   ADMIN_PASSWORD
 * 可选：
 *   ADMIN_SESSION_SECRET (>=16 chars，cookie 签名密钥；不设则从密码派生)
 *   ADMIN_SESSION_DAYS   (默认 30)
 */

const LOGIN_PAGE = "/admin/login";
const LOGIN_API = "/api/admin/login";
const LOGOUT_API = "/api/admin/logout";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 仅拦截 /admin 与 /api/admin
  if (!pathname.startsWith("/admin") && !pathname.startsWith("/api/admin")) {
    return NextResponse.next();
  }

  // 登录 / 登出端点本身要放行
  if (
    pathname === LOGIN_PAGE ||
    pathname === LOGIN_API ||
    pathname === LOGOUT_API
  ) {
    return NextResponse.next();
  }

  // 必备 env
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    return new NextResponse(
      JSON.stringify({
        error:
          "Server misconfigured: ADMIN_USERNAME / ADMIN_PASSWORD not set in env",
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  // 1. cookie 会话
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    try {
      const session = await verifySessionToken(token);
      if (session) return NextResponse.next();
    } catch {
      // 签名密钥缺失等：fall through
    }
  }

  // 2. 仅对 API 路径兜底支持 Basic Auth（curl/脚本场景）
  if (pathname.startsWith("/api/admin")) {
    if (checkBasicAuth(req)) return NextResponse.next();
    return new NextResponse(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      }
    );
  }

  // 3. /admin/* 页面 → 跳登录页，带回跳路径
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = LOGIN_PAGE;
  loginUrl.search = "";
  loginUrl.searchParams.set("from", pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

function checkBasicAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = atob(auth.slice("Basic ".length));
  } catch {
    return false;
  }
  const sepIdx = decoded.indexOf(":");
  if (sepIdx === -1) return false;
  const user = decoded.slice(0, sepIdx);
  const pass = decoded.slice(sepIdx + 1);
  return checkAdminCredentials(user, pass);
}

export const config = {
  // 匹配 /admin 与 /api/admin 下所有路径
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
