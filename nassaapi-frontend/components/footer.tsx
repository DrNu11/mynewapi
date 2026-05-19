import Link from "next/link";
import { Mail, ExternalLink } from "lucide-react";
import { SITE } from "@/lib/constants";

const FOOTER_LINKS = [
  {
    title: "产品",
    links: [
      { label: "模型支持", href: "/#models" },
      { label: "定价", href: "/pricing" },
      { label: "API 文档", href: SITE.docsUrl, external: true },
      { label: "状态页", href: "/status" },
    ],
  },
  {
    title: "公司",
    links: [
      { label: "关于我们", href: "/about" },
      { label: "联系我们", href: `mailto:${SITE.email}` },
      { label: "服务条款", href: "/terms" },
      { label: "隐私政策", href: "/privacy" },
    ],
  },
  {
    title: "开发者",
    links: [
      { label: "快速开始", href: "/docs/quickstart" },
      { label: "OpenAI 兼容", href: "/docs/openai" },
      { label: "代码示例", href: "/docs/examples" },
      { label: "更新日志", href: "/changelog" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-auto border-t border-white/5 bg-ink-950">
      <div className="container-page py-16">
        <div className="grid grid-cols-2 gap-8 lg:grid-cols-5">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <Logo className="h-7 w-7" />
              <span className="text-base font-semibold text-white">
                {SITE.brand}
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-ink-400 leading-relaxed">
              {SITE.description}
            </p>
            <a
              href={`mailto:${SITE.email}`}
              className="mt-4 inline-flex items-center gap-2 text-sm text-ink-300 hover:text-white transition-colors"
            >
              <Mail className="h-4 w-4" />
              {SITE.email}
            </a>
          </div>

          {FOOTER_LINKS.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-white">{col.title}</h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link: any) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noreferrer" : undefined}
                      className="text-sm text-ink-400 hover:text-white transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-white/5 pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="text-xs text-ink-500">
            © {new Date().getFullYear()} {SITE.brand} ({SITE.domain}). All rights
            reserved.
          </p>

          {/* AGPL §5: Appropriate Legal Notice — DO NOT REMOVE */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-500">
            <a
              href={SITE.poweredBy.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-ink-300 transition-colors"
            >
              {SITE.poweredBy.label}
              <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href={SITE.modifiedSourceCode.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-ink-300 transition-colors"
            >
              {SITE.modifiedSourceCode.label}
              <ExternalLink className="h-3 w-3" />
            </a>
            <span>Licensed under AGPL-3.0</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="footerLogoGrad" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#5B85FF" />
          <stop offset="100%" stopColor="#2540F5" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#footerLogoGrad)" />
      <path
        d="M9 22 L9 10 L13 10 L19 18 L19 10 L23 10 L23 22 L19 22 L13 14 L13 22 Z"
        fill="white"
        fillOpacity="0.95"
      />
    </svg>
  );
}
