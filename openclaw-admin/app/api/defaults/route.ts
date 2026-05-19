import { NextRequest, NextResponse } from "next/server";
import { getDefaultModel, setDefaultModel } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const d = await getDefaultModel();
    return NextResponse.json(d);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const updates: any = {};
    if (typeof body.primary === "string") updates.primary = body.primary;
    if (Array.isArray(body.fallbacks)) updates.fallbacks = body.fallbacks;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "至少要给 primary 或 fallbacks" }, { status: 400 });
    }
    const d = await setDefaultModel(updates);
    return NextResponse.json({ ok: true, ...d });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
