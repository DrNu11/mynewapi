'use client';

/**
 * 审计 JSONL 在线查看器 — 完全客户端解析,文件不上传服务器,隐私安全
 *
 * 用途:把 /admin/audit/export 下载的 audit-conversations-*.jsonl 文件
 *      转换成 ChatGPT 风格对话气泡查看,方便扯皮时给客户看证据。
 */

import { useState, useMemo, useRef } from 'react';
import {
  Upload,
  FileJson,
  AlertTriangle,
  Search,
  Eye,
  X,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import { ConversationView } from '@/components/conversation-view';
import { ErrorBoundary } from '@/components/error-boundary';

interface AuditRecord {
  id: number;
  ts: number;
  sk_prefix: string;
  sk_full_hash: string;
  ip: string | null;
  ua: string | null;
  endpoint: string;
  model: string;
  request_messages: string;
  request_messages_hash: string | null;
  request_size: number;
  response_text: string | null;
  reasoning_text: string | null;
  response_finish_reason: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  status_code: number;
  is_streaming: number;
  duration_ms: number | null;
  flagged: number;
  flag_reason: string | null;
  review_status: number;
  review_note: string | null;
}

export default function AuditViewerPage() {
  const [records, setRecords] = useState<AuditRecord[] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [fileSize, setFileSize] = useState<number>(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [search, setSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [selected, setSelected] = useState<AuditRecord | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setParsing(true);
    setParseError(null);
    setFileName(file.name);
    setFileSize(file.size);

    try {
      const text = await file.text();
      const lines = text.split('\n').filter((l) => l.trim());
      const parsed: AuditRecord[] = [];
      let lineNum = 0;
      for (const line of lines) {
        lineNum++;
        try {
          const obj = JSON.parse(line);
          parsed.push(obj);
        } catch (err) {
          console.warn(`第 ${lineNum} 行 JSON 解析失败,跳过:`, err);
        }
      }
      // 按时间倒序
      parsed.sort((a, b) => b.ts - a.ts);
      setRecords(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      setRecords(null);
    } finally {
      setParsing(false);
    }
  };

  const reset = () => {
    setRecords(null);
    setFileName('');
    setFileSize(0);
    setParseError(null);
    setSearch('');
    setFlaggedOnly(false);
    setSelected(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 过滤后的列表
  const filtered = useMemo(() => {
    if (!records) return [];
    return records.filter((r) => {
      if (flaggedOnly && r.flagged !== 1) return false;
      if (search) {
        const sLow = search.toLowerCase();
        if (
          !(
            (r.request_messages || '').toLowerCase().includes(sLow) ||
            (r.response_text || '').toLowerCase().includes(sLow) ||
            (r.sk_prefix || '').toLowerCase().includes(sLow) ||
            (r.model || '').toLowerCase().includes(sLow)
          )
        ) {
          return false;
        }
      }
      return true;
    });
  }, [records, search, flaggedOnly]);

  const stats = useMemo(() => {
    if (!records) return null;
    const flaggedCnt = records.filter((r) => r.flagged === 1).length;
    const errCnt = records.filter((r) => r.status_code >= 400).length;
    const skCnt = new Set(records.map((r) => r.sk_full_hash)).size;
    return { total: records.length, flaggedCnt, errCnt, skCnt };
  }, [records]);

  const fmtTs = (ts: number) =>
    new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
  const fmtBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="mb-4 flex items-center gap-3">
          <FileJson className="h-7 w-7 text-purple-400" />
          <div>
            <h1 className="text-2xl font-bold">审计对话 在线查看器</h1>
            <p className="text-xs text-slate-500">
              上传 audit-conversations-*.jsonl 文件 → 转换成 ChatGPT 风格对话查看 ·
              <span className="ml-1 text-emerald-400">文件完全在浏览器本地解析,不上传服务器</span>
            </p>
          </div>
          {records && (
            <button
              onClick={reset}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-700/60 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-600/60"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重新上传
            </button>
          )}
        </div>

        {!records ? (
          /* 上传区 */
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`mt-8 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-16 transition ${dragOver
              ? 'border-purple-400 bg-purple-500/10'
              : 'border-slate-700 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-900/60'
              }`}
          >
            <Upload className="h-12 w-12 text-purple-400" />
            <div className="text-lg font-semibold">
              {parsing ? '解析中...' : '点击或拖拽 .jsonl 文件到这里'}
            </div>
            <div className="text-xs text-slate-500">
              支持 audit-conversations-*.jsonl (来自 /admin/audit 导出)
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jsonl,application/x-ndjson,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {parseError && (
              <div className="mt-3 max-w-md rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                解析失败:{parseError}
              </div>
            )}
            <div className="mt-4 text-[10px] text-slate-600">
              💡 文件不会上传服务器 · 全部在你的浏览器本地解析,关闭页面即清空
            </div>
          </div>
        ) : (
          <>
            {/* 文件信息 */}
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="font-mono text-slate-200">{fileName}</span>
                <span className="text-slate-500">{fmtBytes(fileSize)}</span>
              </div>
              {stats && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 font-mono text-slate-300">
                    总记录 {stats.total}
                  </span>
                  <span className="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 font-mono text-slate-300">
                    客户数 {stats.skCnt}
                  </span>
                  {stats.flaggedCnt > 0 && (
                    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-amber-300">
                      flagged {stats.flaggedCnt}
                    </span>
                  )}
                  {stats.errCnt > 0 && (
                    <span className="rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-red-300">
                      失败 {stats.errCnt}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 过滤器 */}
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={flaggedOnly}
                  onChange={(e) => setFlaggedOnly(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                仅看 flagged
              </label>
              <div className="flex flex-1 items-center gap-2">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索 prompt / response / sk / model"
                  className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm placeholder:text-slate-500"
                />
              </div>
              <span className="text-xs text-slate-500">
                显示 <span className="font-mono text-slate-300">{filtered.length}</span> /{' '}
                <span className="font-mono text-slate-400">{stats?.total ?? 0}</span>
              </span>
            </div>

            {/* 列表 */}
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
                    <th className="px-3 py-2 text-center">状态</th>
                    <th className="px-3 py-2 text-left">flagged</th>
                    <th className="px-3 py-2 text-center">查看</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filtered.slice(0, 500).map((r) => (
                    <tr
                      key={r.id}
                      className={`hover:bg-slate-800/40 ${r.flagged ? 'bg-amber-500/5' : ''}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">#{r.id}</td>
                      <td className="px-3 py-2 font-mono text-xs">{fmtTs(r.ts)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-blue-300">{r.sk_prefix}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.endpoint}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.model}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {r.prompt_tokens != null
                          ? `${r.prompt_tokens}→${r.completion_tokens ?? '?'}`
                          : '-'}
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
                      </td>
                      <td className="px-3 py-2">
                        {r.flagged === 1 ? (
                          <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {(r.flag_reason || '').slice(0, 30)}
                            {(r.flag_reason || '').length > 30 ? '…' : ''}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => setSelected(r)}
                          className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-200 hover:bg-blue-500/20"
                        >
                          <Eye className="h-3 w-3" />
                          查看
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-12 text-center text-slate-500">
                        无匹配记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 500 && (
              <div className="mt-2 text-center text-xs text-slate-500">
                显示前 500 条 · 共 {filtered.length} 条匹配 · 用搜索/过滤缩小范围
              </div>
            )}
          </>
        )}
      </div>

      {/* 详情弹窗 */}
      {selected && (
        <DetailModal record={selected} onClose={() => setSelected(null)} />
      )}
    </main>
  );
}

function DetailModal(props: { record: AuditRecord; onClose: () => void }) {
  const r = props.record;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={props.onClose}
    >
      <div
        className="flex max-h-[92vh] w-[1100px] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-sm font-bold">#{r.id} 对话详情</h2>
            <span className="font-mono text-xs text-slate-400">
              {new Date(r.ts * 1000).toLocaleString('zh-CN', { hour12: false })}
            </span>
            {r.flagged === 1 && (
              <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                <AlertTriangle className="h-3 w-3" />
                {r.flag_reason}
              </span>
            )}
          </div>
          <button onClick={props.onClose} className="rounded p-1 hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3 border-b border-slate-800 bg-slate-900/60 px-5 py-3 text-xs">
          <Meta label="客户" value={<span className="font-mono text-blue-300">{r.sk_prefix}</span>} />
          <Meta label="IP" value={<span className="font-mono">{r.ip || '-'}</span>} />
          <Meta label="endpoint" value={<span className="font-mono">{r.endpoint}</span>} />
          <Meta label="model" value={<span className="font-mono">{r.model}</span>} />
          <Meta
            label="tokens"
            value={
              <span className="font-mono">
                {r.prompt_tokens ?? '?'} → {r.completion_tokens ?? '?'}
              </span>
            }
          />
          <Meta
            label="耗时"
            value={<span className="font-mono">{r.duration_ms ?? '-'}ms</span>}
          />
          <Meta
            label="HTTP"
            value={
              <span className="font-mono">
                {r.status_code} · {r.is_streaming ? 'stream' : 'non-stream'}
              </span>
            }
          />
          <Meta
            label="UA"
            value={
              <span className="truncate font-mono" title={r.ua || ''}>
                {(r.ua || '-').slice(0, 30)}
                {(r.ua || '').length > 30 ? '…' : ''}
              </span>
            }
          />
        </div>

        <div className="flex-1 overflow-auto p-5">
          <ErrorBoundary
            fallback={
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4">
                <div className="mb-2 font-semibold text-red-300">
                  ⚠️ 对话视图渲染失败 · 显示原始 JSON
                </div>
                <pre className="overflow-auto whitespace-pre-wrap rounded bg-black/40 p-3 font-mono text-xs text-slate-200">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(r.request_messages), null, 2);
                    } catch {
                      return r.request_messages || '(空)';
                    }
                  })()}
                </pre>
                {r.response_text && (
                  <>
                    <div className="mt-3 mb-1 text-xs font-semibold text-emerald-300">📤 响应:</div>
                    <pre className="overflow-auto whitespace-pre-wrap rounded bg-black/40 p-3 font-mono text-xs text-emerald-100">
                      {r.response_text}
                    </pre>
                  </>
                )}
              </div>
            }
          >
            <ConversationView
              requestMessages={r.request_messages}
              responseText={r.response_text}
              reasoningText={r.reasoning_text}
              endpoint={r.endpoint}
              flagReason={r.flag_reason}
            />
          </ErrorBoundary>
        </div>
      </div>
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
