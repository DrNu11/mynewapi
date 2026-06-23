'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Search,
  RefreshCw,
  X,
  Eye,
  CheckCircle2,
  XCircle,
  Ban,
  ArrowLeft,
  MessageSquare,
  Code,
  ChevronDown,
  Wrench,
  ImageIcon,
  Brain,
  Download,
} from 'lucide-react';

interface AuditRow {
  id: number;
  ts: number;
  sk_prefix: string;
  sk_full_hash: string;
  ip: string | null;
  ua: string | null;
  endpoint: string;
  model: string;
  request_size: number;
  status_code: number;
  is_streaming: number;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  flagged: number;
  flag_reason: string | null;
  review_status: number;
  review_note: string | null;
}

interface AuditDetail extends AuditRow {
  request_messages: string;
  request_messages_hash: string | null;
  response_text: string | null;
  reasoning_text: string | null;
  response_finish_reason: string | null;
}

interface ListResponse {
  success: boolean;
  data?: {
    rows: AuditRow[];
    total: number;
    limit: number;
    offset: number;
    stats: {
      total: number;
      flagged_total: number;
      unreviewed: number;
      confirmed_abuse: number;
      last_24h: number;
    };
  };
  message?: string;
}

const REVIEW_LABELS: Record<number, { label: string; cls: string }> = {
  0: { label: '未审', cls: 'border-slate-600 bg-slate-700/40 text-slate-200' },
  1: { label: '审过无问题', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  2: { label: '确认滥用', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  3: { label: '已 ban', cls: 'border-red-500/40 bg-red-500/10 text-red-300' },
};

export default function AuditPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [stats, setStats] = useState<ListResponse['data'] extends infer R ? (R extends { stats: infer S } ? S : never) : never>();
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  // filters
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [search, setSearch] = useState('');
  const [skHash, setSkHash] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (flaggedOnly) sp.set('flagged', '1');
      if (endpoint) sp.set('endpoint', endpoint);
      if (search) sp.set('search', search);
      if (skHash) sp.set('sk_hash', skHash);
      sp.set('limit', String(limit));
      sp.set('offset', String(offset));
      const r = await fetch(`/api/admin/audit?${sp.toString()}`);
      if (r.status === 401) {
        router.replace('/admin/login');
        return;
      }
      const j: ListResponse = await r.json();
      if (j.success && j.data) {
        setRows(j.data.rows);
        setTotal(j.data.total);
        setStats(j.data.stats as any);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaggedOnly, endpoint, skHash, offset]);

  const showDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/admin/audit/${id}`);
      const j = await r.json();
      if (j.success) setDetail(j.data);
    } finally {
      setDetailLoading(false);
    }
  };

  const setReview = async (id: number, status: number, note?: string) => {
    await fetch(`/api/admin/audit/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ review_status: status, review_note: note }),
    });
    fetchList();
    if (detail?.id === id) {
      showDetail(id);
    }
  };

  const fmtTs = (ts: number) =>
    new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
  const fmtDur = (ms: number | null) => (ms == null ? '-' : `${ms}ms`);
  const truncatedHash = (h: string) => `${h.slice(0, 8)}...${h.slice(-4)}`;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={() => router.push('/admin')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700/60"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回
          </button>
          <h1 className="text-2xl font-bold">客户对话审计</h1>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/40 px-2.5 py-1 text-xs text-slate-400">
            <AlertTriangle className="h-3 w-3" />
            隐私敏感数据 · 仅 admin 可见
          </span>
          {/* 一键导出按钮组 */}
          <div className="ml-auto flex items-center gap-2">
            <a
              href="/api/admin/audit/export?type=conversations"
              className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-200 transition hover:bg-purple-500/20"
              title="导出全部对话审计 JSONL"
            >
              <Download className="h-3.5 w-3.5" />
              导出审计对话
            </a>
            <a
              href="/api/admin/audit/export?type=requests"
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-200 transition hover:bg-blue-500/20"
              title="导出全部请求日志 JSONL"
            >
              <Download className="h-3.5 w-3.5" />
              导出请求日志
            </a>
            <a
              href="/api/admin/audit/export?type=expired_cards"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-500/20"
              title="导出已过期/到期卡密 JSON"
            >
              <Download className="h-3.5 w-3.5" />
              导出过期卡密
            </a>
          </div>
        </div>

        {/* 统计卡片 */}
        {stats && (
          <div className="mb-4 grid grid-cols-5 gap-3">
            <StatCard label="总记录" value={stats.total} />
            <StatCard label="近 24h" value={stats.last_24h} accent="blue" />
            <StatCard
              label="已 flagged"
              value={stats.flagged_total}
              accent={stats.flagged_total > 0 ? 'amber' : undefined}
            />
            <StatCard
              label="未审核"
              value={stats.unreviewed}
              accent={stats.unreviewed > 0 ? 'amber' : undefined}
            />
            <StatCard
              label="确认滥用"
              value={stats.confirmed_abuse}
              accent={stats.confirmed_abuse > 0 ? 'red' : undefined}
            />
          </div>
        )}

        {/* 过滤器 */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(e) => {
                setOffset(0);
                setFlaggedOnly(e.target.checked);
              }}
              className="h-4 w-4 rounded"
            />
            仅看 flagged
          </label>
          <select
            value={endpoint}
            onChange={(e) => {
              setOffset(0);
              setEndpoint(e.target.value);
            }}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
          >
            <option value="">全部 endpoint</option>
            <option value="/chat/completions">/chat/completions</option>
            <option value="/responses">/responses</option>
            <option value="/messages">/messages</option>
          </select>
          <div className="flex flex-1 items-center gap-2">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setOffset(0);
                  fetchList();
                }
              }}
              placeholder="搜索 prompt / response 内容(回车搜索)"
              className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm placeholder:text-slate-500"
            />
            {skHash && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/40 bg-purple-500/10 px-2 py-1 font-mono text-xs text-purple-300">
                客户 {truncatedHash(skHash)}
                <button onClick={() => setSkHash('')} title="清除筛选">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
          <button
            onClick={() => {
              setOffset(0);
              fetchList();
            }}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-700/60 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-600/60 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* 列表表格 */}
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">id</th>
                <th className="px-3 py-2 text-left">时间</th>
                <th className="px-3 py-2 text-left">客户 sk</th>
                <th className="px-3 py-2 text-left">endpoint</th>
                <th className="px-3 py-2 text-left">model</th>
                <th className="px-3 py-2 text-right">tokens</th>
                <th className="px-3 py-2 text-right">耗时</th>
                <th className="px-3 py-2 text-center">状态</th>
                <th className="px-3 py-2 text-left">flagged</th>
                <th className="px-3 py-2 text-center">审核</th>
                <th className="px-3 py-2 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((r) => {
                const review = REVIEW_LABELS[r.review_status] ?? REVIEW_LABELS[0];
                return (
                  <tr
                    key={r.id}
                    className={`hover:bg-slate-800/40 ${r.flagged ? 'bg-amber-500/5' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">#{r.id}</td>
                    <td className="px-3 py-2 font-mono text-xs">{fmtTs(r.ts)}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => {
                          setSkHash(r.sk_full_hash);
                          setOffset(0);
                        }}
                        className="font-mono text-xs text-blue-300 hover:underline"
                        title="点击查看该客户所有请求"
                      >
                        {r.sk_prefix}
                      </button>
                      {r.ip && <div className="font-mono text-[10px] text-slate-500">{r.ip}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.endpoint}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.model}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {r.prompt_tokens != null ? `${r.prompt_tokens}→${r.completion_tokens ?? '?'}` : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {fmtDur(r.duration_ms)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] ${r.status_code >= 200 && r.status_code < 300
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : r.status_code >= 400
                            ? 'bg-red-500/10 text-red-300'
                            : 'bg-slate-700/40 text-slate-400'
                          }`}
                      >
                        {r.status_code || '-'}
                      </span>
                      {r.is_streaming === 1 && (
                        <div className="text-[9px] text-slate-500">stream</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.flagged === 1 ? (
                        <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {(r.flag_reason || '').slice(0, 40)}
                          {(r.flag_reason || '').length > 40 ? '…' : ''}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${review.cls}`}>
                        {review.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => showDetail(r.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-200 hover:bg-blue-500/20"
                      >
                        <Eye className="h-3 w-3" />
                        查看
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={11} className="px-3 py-12 text-center text-slate-500">
                    无记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            共 <span className="font-mono text-slate-300">{total}</span> 条 ·
            当前 {offset + 1}-{Math.min(offset + limit, total)}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1 text-sm disabled:opacity-50"
            >
              上一页
            </button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1 text-sm disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      {/* 详情弹窗 */}
      {detail && (
        <DetailModal
          detail={detail}
          loading={detailLoading}
          onClose={() => setDetail(null)}
          onSetReview={(s, n) => setReview(detail.id, s, n)}
          onJumpSk={(h) => {
            setSkHash(h);
            setOffset(0);
            setDetail(null);
          }}
        />
      )}
    </main>
  );
}

function StatCard(props: { label: string; value: number; accent?: 'blue' | 'amber' | 'red' }) {
  const cls =
    props.accent === 'red'
      ? 'border-red-500/40 bg-red-500/10 text-red-300'
      : props.accent === 'amber'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : props.accent === 'blue'
          ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
          : 'border-slate-700 bg-slate-900/60 text-slate-100';
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{props.label}</div>
      <div className="mt-1 font-mono text-2xl font-bold">{props.value.toLocaleString()}</div>
    </div>
  );
}

function DetailModal(props: {
  detail: AuditDetail;
  loading: boolean;
  onClose: () => void;
  onSetReview: (status: number, note?: string) => void;
  onJumpSk: (skHash: string) => void;
}) {
  const { detail, onClose, onSetReview, onJumpSk } = props;
  const [note, setNote] = useState(detail.review_note || '');

  const [viewMode, setViewMode] = useState<'chat' | 'json'>('chat');
  const reqMessages = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(detail.request_messages), null, 2);
    } catch {
      return detail.request_messages;
    }
  }, [detail.request_messages]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-[1100px] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-sm font-bold">#{detail.id} 审计详情</h2>
            <span className="font-mono text-xs text-slate-400">
              {new Date(detail.ts * 1000).toLocaleString('zh-CN', { hour12: false })}
            </span>
            {detail.flagged === 1 && (
              <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                <AlertTriangle className="h-3 w-3" />
                {detail.flag_reason}
              </span>
            )}
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* metadata bar */}
        <div className="grid grid-cols-4 gap-3 border-b border-slate-800 bg-slate-900/60 px-5 py-3 text-xs">
          <Meta label="客户" value={
            <button
              onClick={() => onJumpSk(detail.sk_full_hash)}
              className="font-mono text-blue-300 hover:underline"
              title="查看该客户所有请求"
            >
              {detail.sk_prefix}
            </button>
          } />
          <Meta label="IP" value={<span className="font-mono">{detail.ip || '-'}</span>} />
          <Meta label="UA" value={<span className="truncate font-mono" title={detail.ua || ''}>{(detail.ua || '-').slice(0, 30)}{(detail.ua || '').length > 30 ? '…' : ''}</span>} />
          <Meta label="endpoint" value={<span className="font-mono">{detail.endpoint}</span>} />
          <Meta label="model" value={<span className="font-mono">{detail.model}</span>} />
          <Meta label="tokens" value={<span className="font-mono">{detail.prompt_tokens ?? '?'} → {detail.completion_tokens ?? '?'}</span>} />
          <Meta label="耗时" value={<span className="font-mono">{detail.duration_ms ?? '-'}ms</span>} />
          <Meta label="HTTP" value={<span className="font-mono">{detail.status_code} · {detail.is_streaming ? 'stream' : 'non-stream'}</span>} />
        </div>

        {/* tabs */}
        <div className="flex items-center gap-1 border-b border-slate-800 bg-slate-950 px-4">
          <button
            onClick={() => setViewMode('chat')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition ${viewMode === 'chat'
              ? 'border-blue-400 text-blue-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            对话视图
          </button>
          <button
            onClick={() => setViewMode('json')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition ${viewMode === 'json'
              ? 'border-blue-400 text-blue-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
          >
            <Code className="h-3.5 w-3.5" />
            JSON 原始
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-auto p-5">
          {viewMode === 'chat' ? (
            <ConversationView
              requestMessages={detail.request_messages}
              responseText={detail.response_text}
              reasoningText={detail.reasoning_text}
              endpoint={detail.endpoint}
              flagReason={detail.flag_reason}
            />
          ) : (
            <>
              <Section title="📥 客户请求 prompt (request_messages)">
                <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-black/40 p-3 font-mono text-xs text-slate-200">
                  {reqMessages}
                </pre>
              </Section>

              {detail.reasoning_text && (
                <Section title="🧠 模型思考过程 (reasoning_text)">
                  <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 font-mono text-xs text-purple-100">
                    {detail.reasoning_text}
                  </pre>
                </Section>
              )}

              <Section title="📤 模型响应 (response_text)">
                <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 font-mono text-xs text-emerald-50">
                  {detail.response_text || '(无响应内容,可能是 codex /v1/responses 流式格式未解析)'}
                </pre>
              </Section>
            </>
          )}
        </div>

        {/* review footer */}
        <div className="flex items-center gap-3 border-t border-slate-800 bg-slate-950 px-5 py-3">
          <span className="text-xs text-slate-400">审核标记:</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注(可选)"
            className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
          />
          <button
            onClick={() => onSetReview(1, note)}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20"
          >
            <CheckCircle2 className="h-3 w-3" />
            无问题
          </button>
          <button
            onClick={() => onSetReview(2, note)}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/20"
          >
            <XCircle className="h-3 w-3" />
            确认滥用
          </button>
          <button
            onClick={() => onSetReview(3, note)}
            className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20"
          >
            <Ban className="h-3 w-3" />
            已 ban
          </button>
        </div>
      </div>
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {props.title}
      </h3>
      {props.children}
    </div>
  );
}

function Meta(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{props.label}</span>
      <div className="text-slate-200">{props.value}</div>
    </div>
  );
}

// ============================================================================
// 对话气泡视图 — 把 messages 数组渲染成 ChatGPT/Claude 风格的对话
// ============================================================================

interface ParsedMessage {
  role: string;
  content: any; // string | ContentBlock[]
}

function parseMessages(requestMessages: string, endpoint: string): ParsedMessage[] {
  let parsed: any;
  try {
    parsed = JSON.parse(requestMessages);
  } catch {
    return [];
  }

  // OpenAI / Anthropic: messages 数组
  if (Array.isArray(parsed)) {
    return parsed.filter((m) => m && m.role).map((m) => ({ role: m.role, content: m.content }));
  }

  // codex /v1/responses: input 字段(string 或 array)
  if (endpoint.includes('/responses')) {
    if (parsed?.input && typeof parsed.input === 'string') {
      return [{ role: 'user', content: parsed.input }];
    }
    if (Array.isArray(parsed?.input)) {
      return parsed.input
        .filter((it: any) => it)
        .map((it: any) => ({
          role: it.role || it.type || 'user',
          content: it.content ?? it,
        }));
    }
  }

  // 其他兜底
  if (parsed?.messages && Array.isArray(parsed.messages)) {
    return parsed.messages.map((m: any) => ({ role: m.role, content: m.content }));
  }

  return [];
}

function ConversationView(props: {
  requestMessages: string;
  responseText: string | null;
  reasoningText: string | null;
  endpoint: string;
  flagReason: string | null;
}) {
  const messages = useMemo(
    () => parseMessages(props.requestMessages, props.endpoint),
    [props.requestMessages, props.endpoint],
  );

  if (messages.length === 0 && !props.responseText) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-6 text-center text-sm text-slate-500">
        无法解析为对话格式。请切换到 <span className="text-slate-300">JSON 原始</span> 视图查看。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 关键词命中提示 */}
      {props.flagReason && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">关键词命中:</span> {props.flagReason}
          </span>
        </div>
      )}

      {/* request messages 气泡 */}
      {messages.map((msg, i) => (
        <MessageBubble key={i} role={msg.role} content={msg.content} flagReason={props.flagReason} />
      ))}

      {/* assistant 响应气泡(thinking + content) */}
      {(props.responseText || props.reasoningText) && (
        <AssistantResponseBubble
          responseText={props.responseText}
          reasoningText={props.reasoningText}
          flagReason={props.flagReason}
        />
      )}
    </div>
  );
}

function MessageBubble(props: { role: string; content: any; flagReason: string | null }) {
  const isSystem = props.role === 'system' || props.role === 'developer';
  const isUser = props.role === 'user';
  const isAssistant = props.role === 'assistant';
  const isTool = props.role === 'tool';

  if (isSystem) {
    return (
      <details className="rounded-lg border border-purple-500/30 bg-purple-500/5">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-purple-300">
          ⚙️ {props.role} prompt(点击展开)
        </summary>
        <div className="px-3 pb-3">
          <ContentRenderer content={props.content} />
        </div>
      </details>
    );
  }

  if (isTool) {
    return (
      <div className="ml-8 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-amber-300">📝 tool result</div>
        <ContentRenderer content={props.content} compact />
      </div>
    );
  }

  // user / assistant 气泡
  const bubbleClass = isUser
    ? 'ml-12 self-end border-blue-500/40 bg-blue-500/10 text-blue-50'
    : 'mr-12 border-emerald-500/40 bg-emerald-500/10 text-emerald-50';
  const labelClass = isUser ? 'text-blue-300' : 'text-emerald-300';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] rounded-lg border px-4 py-3 ${bubbleClass}`}>
        <div className={`mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${labelClass}`}>
          {isUser ? '👤 user' : isAssistant ? '🤖 assistant' : props.role}
        </div>
        <ContentRenderer content={props.content} highlightKeywords={isUser ? props.flagReason : null} />
      </div>
    </div>
  );
}

function AssistantResponseBubble(props: {
  responseText: string | null;
  reasoningText: string | null;
  flagReason: string | null;
}) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-emerald-50">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
          🤖 assistant <span className="text-slate-500">· 模型实际返回</span>
        </div>

        {/* reasoning 折叠展示 */}
        {props.reasoningText && (
          <details className="mb-2 rounded-md border border-purple-500/30 bg-purple-500/5">
            <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium text-purple-300">
              <Brain className="mr-1 inline h-3 w-3" />
              思考过程 reasoning ({props.reasoningText.length} 字)— 点击展开
            </summary>
            <pre className="whitespace-pre-wrap break-words px-2 pb-2 font-mono text-xs text-purple-100">
              {props.reasoningText}
            </pre>
          </details>
        )}

        {props.responseText ? (
          <ContentRenderer content={props.responseText} />
        ) : (
          <div className="text-xs italic text-slate-500">
            (无响应内容 · 可能 codex /v1/responses 流式 SSE 未解析)
          </div>
        )}
      </div>
    </div>
  );
}

function ContentRenderer(props: {
  content: any;
  compact?: boolean;
  highlightKeywords?: string | null;
}) {
  if (props.content == null) {
    return <div className="text-xs italic text-slate-500">(空)</div>;
  }

  // string content
  if (typeof props.content === 'string') {
    return <TextWithHighlight text={props.content} keywords={props.highlightKeywords} compact={props.compact} />;
  }

  // array (Anthropic content blocks / multimodal)
  if (Array.isArray(props.content)) {
    return (
      <div className="space-y-2">
        {props.content.map((block: any, i: number) => (
          <ContentBlockRenderer key={i} block={block} highlightKeywords={props.highlightKeywords ?? null} />
        ))}
      </div>
    );
  }

  // fallback: object
  return (
    <pre className="overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-[11px] text-slate-300">
      {JSON.stringify(props.content, null, 2)}
    </pre>
  );
}

function ContentBlockRenderer(props: { block: any; highlightKeywords: string | null }) {
  const block = props.block;
  if (block == null) return null;
  if (typeof block === 'string') {
    return <TextWithHighlight text={block} keywords={props.highlightKeywords} />;
  }

  switch (block.type) {
    case 'text':
    case 'input_text':
    case 'output_text':
      return <TextWithHighlight text={block.text || ''} keywords={props.highlightKeywords} />;

    case 'image':
    case 'image_url':
      return (
        <span className="inline-flex items-center gap-1 rounded border border-blue-400/30 bg-blue-400/10 px-2 py-0.5 text-xs text-blue-300">
          <ImageIcon className="h-3 w-3" />
          [image]
        </span>
      );

    case 'tool_use':
      return (
        <details className="rounded border border-purple-400/30 bg-purple-400/5">
          <summary className="cursor-pointer px-2 py-1 text-[11px] text-purple-300">
            <Wrench className="mr-1 inline h-3 w-3" />
            tool_use: <span className="font-mono">{block.name}</span>
            {' '}
            <ChevronDown className="ml-1 inline h-3 w-3" />
          </summary>
          <pre className="whitespace-pre-wrap px-2 pb-2 font-mono text-[11px] text-purple-100">
            {JSON.stringify(block.input, null, 2)}
          </pre>
        </details>
      );

    case 'tool_result':
      return (
        <details className="rounded border border-amber-400/30 bg-amber-400/5">
          <summary className="cursor-pointer px-2 py-1 text-[11px] text-amber-300">
            📝 tool_result <ChevronDown className="ml-1 inline h-3 w-3" />
          </summary>
          <div className="px-2 pb-2 text-[11px]">
            <ContentRenderer content={block.content} compact />
          </div>
        </details>
      );

    default:
      return (
        <pre className="overflow-auto whitespace-pre-wrap rounded bg-black/20 p-1.5 font-mono text-[10px] text-slate-400">
          [{block.type || '?'}] {JSON.stringify(block, null, 2)}
        </pre>
      );
  }
}

function TextWithHighlight(props: { text: string; keywords?: string | null; compact?: boolean }) {
  const text = props.text || '';
  const cls = props.compact
    ? 'whitespace-pre-wrap break-words text-xs leading-relaxed'
    : 'whitespace-pre-wrap break-words text-sm leading-relaxed';

  if (!props.keywords) {
    return <div className={cls}>{text}</div>;
  }

  // 高亮命中的关键词(逗号分隔多个)
  const kws = props.keywords.split(',').map((k) => k.trim()).filter(Boolean);
  if (kws.length === 0) return <div className={cls}>{text}</div>;

  // 构造正则,case-insensitive
  const pattern = new RegExp(
    '(' + kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
    'gi',
  );
  const parts = text.split(pattern);
  return (
    <div className={cls}>
      {parts.map((p, i) => {
        const isHit = kws.some((k) => p.toLowerCase() === k.toLowerCase());
        return isHit ? (
          <mark key={i} className="rounded bg-amber-500/40 px-0.5 text-amber-100">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </div>
  );
}
