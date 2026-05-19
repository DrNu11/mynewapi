import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789";
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3000);
    const r = await fetch(`${gatewayUrl}/health`, { signal: ac.signal, cache: "no-store" });
    clearTimeout(t);
    const data = await r.json().catch(() => ({}));
    return NextResponse.json({ ok: r.ok, gateway: data, gatewayUrl });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e), gatewayUrl }, { status: 200 });
  }
}
