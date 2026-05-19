import { SITE } from "@/lib/constants";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-ink-500/10">
          <span className="text-3xl">🔍</span>
        </div>
        <h1 className="mt-6 text-2xl font-bold text-white">链接不存在</h1>
        <p className="mt-3 text-sm text-ink-400 leading-relaxed">
          这个兑换链接不存在或已被删除。请检查链接是否复制完整，
          或联系销售方重新发送。
        </p>
        <a
          href={`mailto:${SITE.email}`}
          className="mt-6 inline-block text-sm text-brand-300 hover:text-brand-200"
        >
          联系 {SITE.email}
        </a>
      </div>
    </div>
  );
}
