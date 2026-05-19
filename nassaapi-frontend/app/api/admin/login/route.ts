import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  checkAdminCredentials,
  createSessionToken,
  getSessionMaxAgeSeconds,
} from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { username?: unknown; password?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: "用户名和密码必填" },
      { status: 400 }
    );
  }

  if (!checkAdminCredentials(username, password)) {
    // 简单延迟，缓解暴破
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json(
      { ok: false, error: "用户名或密码错误" },
      { status: 401 }
    );
  }

  const token = await createSessionToken(username);
  const isProd = process.env.NODE_ENV === "production";
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: getSessionMaxAgeSeconds(),
  });
  return res;
}
