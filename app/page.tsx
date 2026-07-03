'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PLANS } from '@/lib/plans';
import type { Plan } from '@/lib/plans';
import { CATEGORY_LIST } from '@/lib/categories';
import type { CategoryMeta } from '@/lib/categories';
import { Sparkles, KeyRound, Loader2, ShieldCheck, Zap, ShoppingCart, Film, WandSparkles, Presentation, ImageIcon, GraduationCap, PlayCircle, X } from 'lucide-react';

// 新手视频教程入口 —— 视频文件由服务器 public 目录提供，不入 Git。
// 部署时把教程 mp4 放到 /opt/nassa-cards/public/tutorials/nassa-api-quickstart.mp4 即可。
const TUTORIAL_VIDEO_URL = "/tutorials/nassa-api-quickstart.mp4";
// 可选封面图；不存在时浏览器会静默忽略 poster，不会报错。
const TUTORIAL_POSTER_URL = "/tutorials/nassa-api-quickstart-poster.jpg";

function TutorialVideoCard() {
  const [open, setOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // 关闭弹窗时暂停并停止视频，避免后台继续播放/占用带宽。
  const handleClose = () => {
    setOpen(false);
    setLoadError(false);
  };

  // Esc 关闭 + 打开时锁定滚动。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex flex-col justify-between rounded-2xl border border-slate-700 bg-slate-900/60 p-6 text-left shadow-2xl backdrop-blur transition hover:border-amber-500/60"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <div>
          <div className="flex items-center gap-2 text-amber-400">
            <GraduationCap className="h-4 w-4" />
            <span className="text-sm font-medium">新手教程</span>
          </div>
          <h3 className="mt-3 text-2xl font-bold text-slate-100">新手视频教程</h3>
          <p className="mt-2 text-sm text-slate-400">
            不会配置？跟着视频完成卡密激活、API Key 复制，以及 Cherry Studio / Claude Code / Cursor 配置。
          </p>
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 font-medium text-slate-950 transition group-hover:bg-amber-400">
          <PlayCircle className="h-4 w-4" />
          观看教程
          <span aria-hidden="true">→</span>
        </div>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
          aria-label="新手视频教程"
        >
          <div
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleClose}
              className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-1.5 text-white/90 transition hover:bg-black/80 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              aria-label="关闭教程视频"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="aspect-video w-full bg-black">
              {loadError ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
                  <p className="text-base font-medium text-amber-300">视频暂时无法播放</p>
                  <p className="text-sm text-slate-400">
                    请稍后重试，或直接联系客服获取教程。如持续失败，可能视频还在上传中。
                  </p>
                </div>
              ) : (
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster={TUTORIAL_POSTER_URL}
                  className="h-full w-full"
                  onError={() => setLoadError(true)}
                >
                  <source src={TUTORIAL_VIDEO_URL} type="video/mp4" />
                  您的浏览器不支持视频播放。
                </video>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function planDescriptionForCategory(cat: CategoryMeta, plan: Plan): string {
  if (cat.id === 'gpt' && plan.id === '7d') {
    return '一周高强度使用,$1000 额度跑满为止';
  }
  return plan.description;
}

export default function HomePage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingCache, setCheckingCache] = useState(true);
  const router = useRouter();

  // 页面加载时检查本地缓存，有未过期的 key 直接跳 result
  useEffect(() => {
    try {
      if (sessionStorage.getItem('nc_skip_cache_redirect') === '1') {
        sessionStorage.removeItem('nc_skip_cache_redirect');
        setCheckingCache(false);
        return;
      }

      const raw = localStorage.getItem('nc_cache');
      if (!raw) { setCheckingCache(false); return; }
      const cached = JSON.parse(raw);
      if (!cached?.api_key) { setCheckingCache(false); return; }
      // 检查是否已过期
      if (cached.expires_at && cached.expires_at * 1000 < Date.now()) {
        localStorage.removeItem('nc_cache');
        localStorage.removeItem('nc_cache_code');
        setCheckingCache(false);
        return;
      }
      sessionStorage.setItem('nc_result', raw);
      sessionStorage.setItem('nc_already', '1');
      router.replace('/result');
    } catch {
      setCheckingCache(false);
    }
  }, [router]);

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.message || '激活失败');
        setLoading(false);
        return;
      }
      // 写入 sessionStorage（当前页面跳转用）
      sessionStorage.setItem('nc_result', JSON.stringify(body.data));
      sessionStorage.setItem('nc_already', body.already_activated ? '1' : '0');
      // 写入 localStorage（跨浏览器会话持久化）
      localStorage.setItem('nc_cache', JSON.stringify(body.data));
      localStorage.setItem('nc_cache_code', code.trim());
      router.push('/result');
    } catch (err: any) {
      setError(err.message || '网络错误');
      setLoading(false);
    }
  }

  if (checkingCache) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-4 py-1.5 text-sm text-brand-400">
            <Sparkles className="h-4 w-4" />
            DeepSeek / GPT / Claude 三套餐任选
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
            输入卡密 · 即刻开通
          </h1>
          <p className="mt-4 text-base text-slate-400 sm:text-lg">
            激活后获得专属 API Key,可在 Cherry Studio / Claude Code / Cursor 等任意工具中使用
          </p>
        </div>

        {/* 激活 / 购买 双栏 */}
        <div className="mx-auto mt-12 grid max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* 激活卡 */}
          <form
            onSubmit={handleRedeem}
            className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-2xl backdrop-blur"
          >
            <label className="block text-sm font-medium text-slate-300">
              <KeyRound className="mr-1.5 inline h-4 w-4" />
              卡密
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={`${CATEGORY_LIST.map((c) => c.prefix).join(' / ')}- XXXX-XXXX-XXXX`}
              className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 font-mono tracking-wider text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              {CATEGORY_LIST.map((c) => (
                <span key={c.id}>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${c.badgeClass}`}
                  >
                    {c.prefix}-
                  </span>{' '}
                  {c.label}
                </span>
              ))}
            </p>
            {error && (
              <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !code}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在开通...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  立即激活
                </>
              )}
            </button>
            <p className="mt-3 text-center text-xs text-slate-500">
              激活后可重新输入同一卡密查看 API Key,直到到期。关闭浏览器后重新打开无需再次输入。
            </p>
          </form>

          {/* 购买卡 */}
          <a
            href="https://pay.qxvx.cn/shop/codex"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col justify-between rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-2xl backdrop-blur transition hover:border-emerald-500/60"
          >
            <div>
              <div className="flex items-center gap-2 text-emerald-400">
                <ShoppingCart className="h-4 w-4" />
                <span className="text-sm font-medium">还没有卡密?</span>
              </div>
              <h3 className="mt-3 text-2xl font-bold text-slate-100">立即购买卡密</h3>
              <p className="mt-2 text-sm text-slate-400">
                跳转自动发卡店铺,支付宝 / 微信扫码付款,卡密自动到手,回本页粘贴激活即可使用。
              </p>
            </div>
            <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-3 font-medium text-white transition group-hover:bg-emerald-600">
              <ShoppingCart className="h-4 w-4" />
              前往购买店铺
              <span aria-hidden="true">→</span>
            </div>
          </a>

          {/* 视频生成入口 */}
          <a
            href="https://video.nassaapi.xyz/"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col justify-between rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-2xl backdrop-blur transition hover:border-violet-500/60"
          >
            <div>
              <div className="flex items-center gap-2 text-violet-400">
                <Film className="h-4 w-4" />
                <span className="text-sm font-medium">AI 视频生成</span>
              </div>

              <h3 className="mt-3 text-2xl font-bold text-slate-100">
                视频在线生成
              </h3>

              <p className="mt-2 text-sm text-slate-400">
                上传一张图片和一句提示词，在线生成短视频。适合想入手漫剧的朋友们。
              </p>
            </div>

            <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 py-3 font-medium text-white transition group-hover:bg-violet-600">
              <WandSparkles className="h-4 w-4" />
              立即生成
              <span aria-hidden="true">→</span>
            </div>
          </a>

          {/* PPT 生成入口 */}
          <Link
            href="/ppt"
            className="group flex flex-col justify-between rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-2xl backdrop-blur transition hover:border-cyan-500/60"
          >
            <div>
              <div className="flex items-center gap-2 text-cyan-400">
                <Presentation className="h-4 w-4" />
                <span className="text-sm font-medium">AI PPT 生成</span>
              </div>

              <h3 className="mt-3 text-2xl font-bold text-slate-100">
                在线生成 PPTX
              </h3>

              <p className="mt-2 text-sm text-slate-400">
                固定请求地址，只填写 API Key，即可生成可下载的 PowerPoint 文件。
              </p>
            </div>

            <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-3 font-medium text-slate-950 transition group-hover:bg-cyan-400">
              <Presentation className="h-4 w-4" />
              立即生成
              <span aria-hidden="true">→</span>
            </div>
          </Link>

          {/* image-2 生图入口 */}
          <a
            href="https://image.nassaapi.xyz/"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col justify-between rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-2xl backdrop-blur transition hover:border-rose-500/60"
          >
            <div>
              <div className="flex items-center gap-2 text-rose-400">
                <ImageIcon className="h-4 w-4" />
                <span className="text-sm font-medium">image-2 生图</span>
              </div>
              <h3 className="mt-3 text-2xl font-bold text-slate-100">2毛一张4K</h3>
              <p className="mt-2 text-sm text-slate-400">
                输入提示词和 API Key，image-2 生图，高清 4K 输出，2毛一张超低价。
              </p>
            </div>
            <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-rose-500 px-4 py-3 font-medium text-white transition group-hover:bg-rose-600">
              <ImageIcon className="h-4 w-4" />
              立即生成
              <span aria-hidden="true">→</span>
            </div>
          </a>

          {/* 新手视频教程入口 —— 红框位置（image-2 生图右侧） */}
          <TutorialVideoCard />
        </div>

        {/* 套餐展示 */}
        <div className="mt-16 space-y-12">
          {CATEGORY_LIST.map((cat) => (
            <div key={cat.id}>
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-2xl font-semibold text-slate-100">{cat.label}</h2>
                <span
                  className={`rounded border px-2 py-0.5 font-mono text-xs ${cat.badgeClass}`}
                >
                  {cat.prefix}-XXXX-XXXX-XXXX
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-400">{cat.description}</p>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {PLANS.filter((p) => !p.internal).map((plan) => (
                  <div
                    key={`${cat.id}-${plan.id}`}
                    className="rounded-xl border border-slate-700 bg-slate-900/40 p-6 transition hover:border-brand-500/50"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-lg font-semibold text-slate-100">{plan.label}</span>
                      <span className="font-mono text-xs text-slate-500">{plan.days}d</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">{planDescriptionForCategory(cat, plan)}</p>
                    <ul className="mt-4 space-y-1.5 text-sm text-slate-300">
                      {cat.defaultModels.split(',').map((m) => (
                        <li key={m} className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-brand-400" />
                          <span className="font-mono text-xs">{m.trim()}</span>
                        </li>
                      ))}
                      {cat.hasCodex && (
                        <li className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-brand-400" />
                          <span>一键配置 Codex CLI</span>
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <footer className="mt-16 text-center text-xs text-slate-600">
          {new Date().getFullYear()} NassaAPI · 卡密激活中心
        </footer>
      </div>
    </main>
  );
}
