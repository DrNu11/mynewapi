import { NextRequest, NextResponse } from "next/server";
import { addModel } from "@/lib/openclaw";

export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const body = await req.json();
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json({ error: "id 必填" }, { status: 400 });
    }
    await addModel(params.name, {
      id: body.id,
      name: body.name || body.id,
      reasoning: !!body.reasoning,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
