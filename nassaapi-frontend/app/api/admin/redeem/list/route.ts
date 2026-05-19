import { NextResponse } from "next/server";
import { listRedemptionLinks } from "@/lib/db";
import { getPublicOrigin } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "50", 10))
  );
  const offset = Math.max(
    0,
    Number.parseInt(url.searchParams.get("offset") ?? "0", 10)
  );

  const { rows, total } = listRedemptionLinks({ limit, offset });
  const origin = getPublicOrigin(req);

  return NextResponse.json({
    ok: true,
    total,
    items: rows.map((r) => ({
      ...r,
      short_url: `${origin}/r/${r.short_id}`,
    })),
  });
}
