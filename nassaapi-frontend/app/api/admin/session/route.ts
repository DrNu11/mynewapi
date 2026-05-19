import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * 返回当前登录管理员的用户名。
 * 只有通过中间件（说明 cookie 或 Basic Auth 验证过）才能调到这里。
 *
 * 注：BasicAuth 场景下 cookie 解不出，会返回 username = "(basic)"。
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    try {
      const session = await verifySessionToken(token);
      if (session) {
        return NextResponse.json({
          ok: true,
          username: session.username,
          expiresAt: session.expiresAt,
        });
      }
    } catch {
      // fall through
    }
  }
  // 没有 cookie 但 middleware 让通过了 → Basic Auth
  return NextResponse.json({ ok: true, username: "(basic-auth)" });
}
