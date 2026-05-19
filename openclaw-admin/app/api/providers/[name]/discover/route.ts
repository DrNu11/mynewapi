import { NextRequest, NextResponse } from "next/server";
import { addModelsBulk, discoverModels, getProvider } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

// GET: 调上游 /v1/models 拉清单
export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const [result, existing] = await Promise.all([
      discoverModels(params.name),
      getProvider(params.name),
    ]);
    const have = new Set((existing?.models || []).map((m) => m.id));
    const annotated = result.models.map((m) => ({ ...m, alreadyAdded: have.has(m.id) }));
    return NextResponse.json({
      models: annotated,
      triedUrl: result.triedUrl,
      totalRemote: result.models.length,
      newCount: annotated.filter((m) => !m.alreadyAdded).length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}

// POST: 批量添加选中的模型
export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  try {
    const body = await req.json();
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    const reasoning = !!body?.reasoning;
    if (ids.length === 0) {
      return NextResponse.json({ error: "ids 数组不能为空" }, { status: 400 });
    }
    const r = await addModelsBulk(params.name, ids, reasoning);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
