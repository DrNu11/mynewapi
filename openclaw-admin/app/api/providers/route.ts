import { NextRequest, NextResponse } from "next/server";
import { createProvider, listProviders, getConfigPath } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const providers = await listProviders();
    return NextResponse.json({ providers, configPath: getConfigPath() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, baseUrl, apiKey, api } = body || {};
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name 必填" }, { status: 400 });
    }
    await createProvider(name, { baseUrl, apiKey, api });
    return NextResponse.json({ ok: true, name });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
