import { NextRequest, NextResponse } from "next/server";
import { removeModel, updateModel } from "@/lib/openclaw";

export async function DELETE(_req: NextRequest, { params }: { params: { name: string; modelId: string } }) {
  try {
    const modelId = decodeURIComponent(params.modelId);
    await removeModel(params.name, modelId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { name: string; modelId: string } }) {
  try {
    const modelId = decodeURIComponent(params.modelId);
    const body = await req.json();
    await updateModel(params.name, modelId, body);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
