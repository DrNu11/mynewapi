import { NextRequest, NextResponse } from "next/server";

const USER = process.env.BASIC_AUTH_USER || "admin";
const PASS = process.env.BASIC_AUTH_PASS || "nassa";
const REALM = "OpenClaw Admin";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${REALM}"` },
  });
}

export function middleware(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Basic ")) return unauthorized();

  try {
    const decoded = atob(auth.slice(6));
    const sep = decoded.indexOf(":");
    if (sep < 0) return unauthorized();
    const u = decoded.slice(0, sep);
    const p = decoded.slice(sep + 1);
    if (u === USER && p === PASS) return NextResponse.next();
  } catch {
    /* fall through */
  }
  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
