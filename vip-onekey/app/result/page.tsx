'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Crown, Mail, Clock, ArrowLeft, RefreshCw } from 'lucide-react';

interface Result {
  email: string;
  user_id: number;
  target_group: string;
  plan_days: number;
  activated_at: number;
  expires_at: number;
}

export default function ResultPage() {
  const [data, setData] = useState<Result | null>(null);
  const [already, setAlready] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('vip_result');
    if (raw) setData(JSON.parse(raw));
    setAlready(sessionStorage.getItem('vip_already') === '1');
  }, []);

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="text-slate-400">未找到激活信息,请返回首页重新激活</div>
      </main>
    );
  }

  const remainSec = Math.max(0, data.expires_at - Math.floor(Date.now() / 1000));
  const remainDays = Math.floor(remainSec / 86400);
  const remainHours = Math.floor((remainSec % 86400) / 3600);
  const expireDate = new Date(data.expires_at * 1000);
  const expireStr = expireDate.toLocaleString('zh-CN', { hour12: false });

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto max-w-2xl px-6 pt-16 pb-24">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            {already ? (
              <RefreshCw className="h-8 w-8 text-emerald-400" />
            ) : (
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            )}
            <h1 className="text-2xl font-bold text-slate-100">
              {already ? '已开通,无需重复激活' : '开通成功'}
            </h1>
          </div>

          <div className="mt-6 space-y-3 text-sm">
            <Row icon={<Mail className="h-4 w-4 text-slate-500" />} label="账号邮箱" value={data.email} mono />
            <Row icon={<Crown className="h-4 w-4 text-brand-400" />} label="当前分组" value={data.target_group} mono />
            <Row
              icon={<Clock className="h-4 w-4 text-slate-500" />}
              label="到期时间"
              value={expireStr}
            />
            <Row
              icon={<Clock className="h-4 w-4 text-slate-500" />}
              label="剩余时长"
              value={`${remainDays} 天 ${remainHours} 小时`}
            />
          </div>

          <div className="mt-7 rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-400">
            <p>
              <span className="font-medium text-slate-200">提示:</span> 您的账号已升级至{' '}
              <span className="font-mono text-brand-400">{data.target_group}</span> 分组,所有模型按
              0.6 倍率计费。到期时间到达后系统自动回退至默认分组,无需手动操作。
            </p>
          </div>

          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" /> 返回首页
          </Link>
        </div>

        <footer className="mt-10 text-center text-xs text-slate-600">
          {new Date().getFullYear()} NassaAPI · VIP 一键开通
        </footer>
      </div>
    </main>
  );
}

function Row({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-slate-800 pb-2">
      <span className="flex items-center gap-1.5 text-slate-400">
        {icon}
        {label}
      </span>
      <span className={`text-slate-100 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
