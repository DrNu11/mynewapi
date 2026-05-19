import { notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink, ShieldCheck, ArrowRight } from "lucide-react";
import {
  getRedemptionLinkByShortId,
  markRevealed,
  type RedemptionLink,
} from "@/lib/db";
import { quotaToUsd } from "@/lib/newapi";
import { SITE } from "@/lib/constants";
import { CopyCodeButton } from "./copy-button";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: { shortId: string };
}

export async function generateMetadata({ params }: PageProps) {
  return {
    title: "兑换码 · " + SITE.brand,
    robots: { index: false, follow: false },
  };
}

export default function RedeemPage({ params }: PageProps) {
  const link = getRedemptionLinkByShortId(params.shortId);
  if (!link) {
    notFound();
  }

  // 已过期
  if (
    link.expires_at &&
    new Date(link.expires_at).getTime() < Date.now()
  ) {
    return <ExpiredView />;
  }

  // 已停用
  if (link.status === "disabled") {
    return <DisabledView />;
  }

  // 标记已查看（fire-and-forget，不影响渲染）
  try {
    markRevealed(params.shortId);
  } catch {
    // ignore
  }

  return <RedeemView link={link} />;
}

function RedeemView({ link }: { link: RedemptionLink }) {
  const usd = link.amount_usd ?? quotaToUsd(link.amount_quota);
  const isFirstView = link.visit_count === 0;

  return (
    <div className="min-h-screen bg-ink-950 flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-1.5 text-xs text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            兑换码已为您准备好
          </div>
          <h1 className="mt-6 text-3xl font-bold text-white tracking-tight">
            ${usd.toFixed(2)} 等值额度
          </h1>
          <p className="mt-2 text-sm text-ink-400">
            点击下方按钮复制兑换码，到 {SITE.brand} 充值
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
          <p className="text-xs text-ink-400 mb-2">您的兑换码</p>
          <div className="rounded-xl border border-white/10 bg-ink-950 p-4 break-all font-mono text-sm text-white selection:bg-brand-500/40">
            {link.redemption_code}
          </div>
          <CopyCodeButton code={link.redemption_code} />
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="text-sm font-semibold text-white mb-3">如何使用</h2>
          <ol className="space-y-2.5 text-sm text-ink-300">
            <li className="flex gap-3">
              <Step n={1} />
              <span>
                访问{" "}
                <a
                  href={SITE.consoleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-300 hover:text-brand-200 underline-offset-4 hover:underline inline-flex items-center gap-1"
                >
                  {new URL(SITE.consoleUrl).host}
                  <ExternalLink className="h-3 w-3" />
                </a>{" "}
                登录或注册账号
              </span>
            </li>
            <li className="flex gap-3">
              <Step n={2} />
              <span>左侧菜单进入「钱包」/「充值」页面</span>
            </li>
            <li className="flex gap-3">
              <Step n={3} />
              <span>粘贴上方兑换码，点击「兑换」</span>
            </li>
            <li className="flex gap-3">
              <Step n={4} />
              <span>额度立即到账，可直接调用 API 或 Playground 试用</span>
            </li>
          </ol>
          <Link
            href={SITE.consoleUrl + "/topup"}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-ink-950 hover:bg-ink-100 transition-colors"
          >
            前往充值页
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {isFirstView && (
          <p className="mt-6 text-center text-xs text-ink-500">
            ⚠️ 这个码只在你这里显示，请尽快复制并兑换。 兑换后即使分享也无法重复使用。
          </p>
        )}

        <p className="mt-8 text-center text-xs text-ink-600">
          由 {SITE.brand} ({SITE.domain}) 安全发放 · 有问题请联系{" "}
          <a
            href={`mailto:${SITE.email}`}
            className="text-ink-400 hover:text-ink-200"
          >
            {SITE.email}
          </a>
        </p>
      </div>
    </div>
  );
}

function ExpiredView() {
  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10">
          <span className="text-3xl">⏰</span>
        </div>
        <h1 className="mt-6 text-2xl font-bold text-white">链接已过期</h1>
        <p className="mt-3 text-sm text-ink-400 leading-relaxed">
          这个兑换码链接已超出有效期。请联系销售方重新发放，或访问{" "}
          <a
            href={SITE.consoleUrl}
            className="text-brand-300 hover:text-brand-200"
          >
            {new URL(SITE.consoleUrl).host}
          </a>{" "}
          直接购买。
        </p>
      </div>
    </div>
  );
}

function DisabledView() {
  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10">
          <span className="text-3xl">🚫</span>
        </div>
        <h1 className="mt-6 text-2xl font-bold text-white">链接已停用</h1>
        <p className="mt-3 text-sm text-ink-400 leading-relaxed">
          这个兑换码链接已被发放方停用。如有疑问请联系销售方。
        </p>
      </div>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-[10px] font-bold text-brand-300">
      {n}
    </span>
  );
}
