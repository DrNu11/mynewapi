import { NextRequest, NextResponse } from "next/server";
import { renameProvider } from "@/lib/openclaw";

export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const { newName } = await req.json();
    if (typeof newName !== "string" || !newName) {
      return NextResponse.json({ error: "newName 必填" }, { status: 400 });
    }
    await renameProvider(params.name, newName);
    return NextResponse.json({ ok: true, oldName: params.name, newName });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
