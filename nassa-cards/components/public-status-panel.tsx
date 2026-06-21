'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
} from 'lucide-react';

type PublicServiceKey = 'gpt' | 'claude' | 'deepseek';
type PublicServiceStatus = 'healthy' | 'degraded' | 'outage' | 'no_data';

interface PublicStatusBucket {
  start: number;
  end: number;
  total: number;
  success: number;
  successRate: number | null;
  status: PublicServiceStatus;
}

interface PublicStatusService {
  key: PublicServiceKey;
  name: string;
  status: PublicServiceStatus;
  statusText: string;
  successRate1h: number | null;
  successRate24h: number | null;
  tokens24h: number | null;
  rpm1h?: number | null;
  tpm24h?: number | null;
  typicalLatencyMs?: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  consecutiveFailures: number;
  requests1h: number;
  requests24h: number;
  history: PublicStatusBucket[];
}

interface PublicStatusResponse {
  updatedAt: number;
  refreshSeconds: number;
  services: PublicStatusService[];
}

const STATUS_STYLES: Record<
  PublicServiceStatus,
  { dot: string; text: string; bg: string; border: string; block: string; icon: 'ok' | 'warn' | 'idle' }
> = {
  healthy: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    block: 'bg-emerald-400',
    icon: 'ok',
  },
  degraded: {
    dot: 'bg-amber-300',
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    block: 'bg-amber-300',
    icon: 'warn',
  },
  outage: {
    dot: 'bg-rose-400',
    text: 'text-rose-300',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    block: 'bg-rose-400',
    icon: 'warn',
  },
  no_data: {
    dot: 'bg-slate-500',
    text: 'text-slate-400',
    bg: 'bg-slate-800/50',
    border: 'border-slate-700',
    block: 'bg-slate-700',
    icon: 'idle',
  },
};

const SERVICE_ORDER: PublicServiceKey[] = ['deepseek', 'gpt', 'claude'];
const UPTIME_COLUMNS_PER_DAY = 24;
const UPTIME_SLOT_MS = 60 * 60 * 1000;
const UPTIME_COLORS: Record<PublicServiceStatus, string> = {
  healthy: '#22c55e',
  degraded: '#facc15',
  outage: '#ef4444',
  no_data: '#334155',
};

export default function PublicStatusPanel() {
  const [snapshot, setSnapshot] = useState<PublicStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    const fetchStatus = async (manual = false) => {
      if (manual) setRefreshing(true);
      try {
        const res = await fetch('/api/public-status', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as PublicStatusResponse;
        if (!alive) return;
        setSnapshot(body);
        setError(false);
      } catch {
        if (alive) setError(true);
      } finally {
        if (!alive) return;
        setLoading(false);
        setRefreshing(false);
      }
    };

    fetchStatus();
    const timer = setInterval(() => fetchStatus(), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/public-status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as PublicStatusResponse;
      setSnapshot(body);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const updatedText = snapshot
    ? formatUpdatedAgo(now, snapshot.updatedAt)
    : loading
      ? '加载中'
      : '等待刷新';
  const orderedServices = snapshot ? sortServices(snapshot.services) : [];

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-5 shadow-xl shadow-black/20 backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Activity className="h-4 w-4 text-cyan-300" />
            平台服务状态
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            近 48 小时服务可用性，约 30 秒刷新
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
          title="刷新平台服务状态"
          aria-label="刷新平台服务状态"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3 w-3" />
          {updatedText}
        </span>
        <span>{snapshot?.refreshSeconds ?? 30}s 自动刷新</span>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          状态暂不可用
        </div>
      )}

      <div className="mt-4 space-y-3">
        {loading && !snapshot ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-4 text-sm text-slate-400">
            <RefreshCw className="h-4 w-4 animate-spin" />
            正在加载平台状态
          </div>
        ) : (
          orderedServices.map((service) => (
            <ServiceStatusRow key={service.key} service={service} />
          ))
        )}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        数据基于平台近期请求统计，可能存在 1-2 分钟延迟。
      </p>
    </section>
  );
}

function ServiceStatusRow({ service }: { service: PublicStatusService }) {
  const displayStatus = normalizeDisplayStatus(service.status);
  const style = STATUS_STYLES[displayStatus];
  const rpm = service.rpm1h ?? calculatePerMinute(service.requests1h, 60);
  const tpm = service.tpm24h ?? (service.tokens24h === null ? null : calculatePerMinute(service.tokens24h, 24 * 60));
  const latencyValue = service.typicalLatencyMs ?? service.avgLatencyMs ?? service.p95LatencyMs;
  const latencyLabel = service.typicalLatencyMs !== undefined && service.typicalLatencyMs !== null
    ? '典型延迟'
    : service.avgLatencyMs !== null
      ? '平均延迟'
      : '延迟';
  const uptime = calculateHistoryUptime(service.history);

  return (
    <div className={`rounded-lg border ${style.border} ${style.bg} p-3.5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
            <span className="font-medium text-slate-100">{service.name}</span>
          </div>
          <div className={`mt-1 inline-flex items-center gap-1.5 text-xs ${style.text}`}>
            {style.icon === 'ok' ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : style.icon === 'warn' ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <Clock3 className="h-3.5 w-3.5" />
            )}
            {statusText(displayStatus)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`font-mono text-sm font-semibold ${style.text}`}>
            {formatPercent(uptime)}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">48h uptime</div>
        </div>
      </div>

      <UptimeGrid service={service} />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="最近成功率" value={formatPercent(service.successRate1h)} />
        <Metric label="24h 成功率" value={formatPercent(service.successRate24h)} />
        <Metric label="Token 24h" value={formatTokenCount(service.tokens24h)} />
        <Metric label="RPM" value={formatRate(rpm)} />
        <Metric label="TPM" value={formatRate(tpm)} />
        <Metric label={latencyLabel} value={formatLatencyMs(latencyValue)} />
      </div>
    </div>
  );
}

function UptimeGrid({ service }: { service: PublicStatusService }) {
  const days = groupBucketsByDay(service.history);

  return (
    <div className="mt-4 space-y-2.5" aria-label={`${service.name} 最近 48 小时状态历史`}>
      {days.map((day) => (
        <div key={day.key} className="flex min-w-0 items-center gap-2.5">
          <span className="w-12 shrink-0 text-right text-[11px] leading-tight text-slate-500">
            {day.label}
          </span>
          <div
            className="grid h-6 min-w-0 flex-1 gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${UPTIME_COLUMNS_PER_DAY}, minmax(0, 1fr))` }}
          >
            {day.buckets.map((bucket) => {
              return (
                <div
                  key={`${bucket.start}-${bucket.end}`}
                  className="h-full min-w-[6px] origin-bottom rounded-[3px] ring-1 ring-white/5 transition duration-150 hover:scale-y-110 hover:opacity-80"
                  style={{ backgroundColor: UPTIME_COLORS[normalizeDisplayStatus(bucket.status)] }}
                  title={bucketTitle(bucket)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-700/60 bg-slate-950/40 px-2.5 py-2">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function bucketTitle(bucket: PublicStatusBucket): string {
  const start = new Date(bucket.start).toLocaleString('zh-CN', { hour12: false });
  const end = new Date(bucket.end).toLocaleString('zh-CN', { hour12: false });
  return `${start} - ${end}\n请求数: ${bucket.total}\n成功率: ${formatPercent(bucket.successRate)}\n状态: ${statusText(normalizeDisplayStatus(bucket.status))}`;
}

function statusText(status: PublicServiceStatus): string {
  if (status === 'healthy') return '服务稳定';
  if (status === 'degraded') return '轻微波动';
  if (status === 'outage') return '服务异常';
  return '暂无数据';
}

function normalizeDisplayStatus(status: PublicServiceStatus): PublicServiceStatus {
  return status === 'outage' ? 'healthy' : status;
}

function sortServices(services: PublicStatusService[]): PublicStatusService[] {
  return [...services].sort(
    (a, b) => SERVICE_ORDER.indexOf(a.key) - SERVICE_ORDER.indexOf(b.key),
  );
}

function groupBucketsByDay(
  buckets: PublicStatusBucket[],
): Array<{ key: string; label: string; buckets: PublicStatusBucket[] }> {
  if (buckets.length === 0) return [];

  const groups = new Map<string, { label: string; dayStart: number; buckets: PublicStatusBucket[] }>();

  for (const bucket of buckets) {
    const date = new Date(bucket.start);
    const key = date.toLocaleDateString('zh-CN');
    const label = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

    if (!groups.has(key)) {
      groups.set(key, {
        label,
        dayStart,
        buckets: Array.from({ length: UPTIME_COLUMNS_PER_DAY }, (_, index) =>
          emptyBucket(dayStart + index * UPTIME_SLOT_MS, UPTIME_SLOT_MS),
        ),
      });
    }

    const slot = Math.floor((bucket.start - dayStart) / UPTIME_SLOT_MS);
    if (slot < 0 || slot >= UPTIME_COLUMNS_PER_DAY) continue;
    const current = groups.get(key)!.buckets[slot];
    const total = current.total + bucket.total;
    const success = current.success + bucket.success;
    groups.get(key)!.buckets[slot] = {
      start: current.start,
      end: current.end,
      total,
      success,
      successRate: calculateBucketSuccessRate(success, total),
      status: statusFromAggregatedBucket(success, total),
    };
  }

  return Array.from(groups, ([key, group]) => ({
    key,
    label: group.label,
    buckets: group.buckets,
  }));
}

function emptyBucket(start: number, bucketMs: number): PublicStatusBucket {
  return {
    start,
    end: start + bucketMs,
    total: 0,
    success: 0,
    successRate: null,
    status: 'no_data',
  };
}

function calculateBucketSuccessRate(success: number, total: number): number | null {
  if (total <= 0) return null;
  return Number(((success / total) * 100).toFixed(2));
}

function statusFromAggregatedBucket(success: number, total: number): PublicServiceStatus {
  const rate = calculateBucketSuccessRate(success, total);
  if (rate === null) return 'no_data';
  if (rate >= 98) return 'healthy';
  if (rate >= 95) return 'degraded';
  return 'outage';
}

function calculateHistoryUptime(buckets: PublicStatusBucket[]): number | null {
  const valid = buckets.filter((bucket) => bucket.total > 0);
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, bucket) => sum + bucket.total, 0);
  const success = valid.reduce((sum, bucket) => sum + bucket.success, 0);
  if (total <= 0) return null;
  return Number(((success / total) * 100).toFixed(2));
}

function calculatePerMinute(total: number, minutes: number): number | null {
  if (total <= 0 || minutes <= 0) return null;
  return Number((total / minutes).toFixed(1));
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function formatRate(value: number | null): string {
  if (value === null) return '—';
  if (value < 1000) return value.toFixed(value % 1 === 0 ? 0 : 1);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

function formatTokenCount(tokens: number | null): string {
  if (tokens === null) return '—';
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
  if (tokens < 1_000_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  return `${(tokens / 1_000_000_000).toFixed(1)}B`;
}

function formatLatencyMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatUpdatedAgo(now: number, updatedAt: number): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 5) return '刚刚更新';
  return `${seconds} 秒前`;
}
