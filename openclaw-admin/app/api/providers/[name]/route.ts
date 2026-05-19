import { NextRequest, NextResponse } from "next/server";
import { deleteProvider, getProvider, updateProviderApiKey, updateProviderBaseUrl } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const p = await getProvider(params.name);
    if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ name: params.name, provider: p });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const body = await req.json();
    if (typeof body.apiKey === "string") {
      await updateProviderApiKey(params.name, body.apiKey);
    }
    if (typeof body.baseUrl === "string") {
      await updateProviderBaseUrl(params.name, body.baseUrl);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { name: string } }) {
  try {
    // 强制 body 二次校验:body.confirm 必须 === params.name(防止误删)
    const body = await req.json().catch(() => ({}));
    if (body.confirm !== params.name) {
      return NextResponse.json(
        { error: `二次校验失败:body.confirm 必须等于 provider 名 "${params.name}"` },
        { status: 400 }
      );
    }
    await deleteProvider(params.name);
    return NextResponse.json({ ok: true, deleted: params.name });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
