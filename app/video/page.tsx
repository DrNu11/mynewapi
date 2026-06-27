'use client';

import Link from 'next/link';
import {
  AlertCircle,
  ArrowUp,
  Check,
  Clock3,
  Copy,
  Download,
  Film,
  ImagePlus,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type HailuoModel = 'hailuo-2.3' | 'hailuo-2.3-fast';
type StatusFilter = 'all' | 'processing' | 'success' | 'failed';

interface VideoTask {
  task_id: string;
  model: HailuoModel;
  prompt: string;
  duration: number;
  resolution: string;
  status: string;
  download_url: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

interface QuotaBucket {
  total: number;
  used: number;
  reserved?: number;
  remaining: number;
}

interface QuotaState {
  base: QuotaBucket;
  invite_bonus: QuotaBucket;
  provider?: 'newapi' | 'minimax_direct';
}

interface PendingOperation {
  operationId: string;
  code: string;
}

const MODEL_LABELS: Record<HailuoModel, string> = {
  'hailuo-2.3': '海螺 2.3',
  'hailuo-2.3-fast': '海螺 2.3 Fast',
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'processing', label: '生成中' },
  { value: 'success', label: '已完成' },
  { value: 'failed', label: '失败' },
];

function isSuccess(status: string): boolean {
  return /success|completed|succeeded/i.test(status);
}

function isFailed(status: string): boolean {
  return /fail|error|cancel/i.test(status);
}

function isProcessing(status: string): boolean {
  return !isSuccess(status) && !isFailed(status);
}

function statusLabel(status: string): string {
  if (isSuccess(status)) return '已完成';
  if (isFailed(status)) return '失败';
  if (/processing|in_progress/i.test(status)) return '生成中';
  return '排队中';
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function mergeTask(tasks: VideoTask[], incoming: VideoTask): VideoTask[] {
  const index = tasks.findIndex((task) => task.task_id === incoming.task_id);
  if (index === -1) return [incoming, ...tasks];
  const next = [...tasks];
  next[index] = { ...next[index], ...incoming };
  return next;
}

export default function VideoPage() {
  const [code, setCode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [model, setModel] = useState<HailuoModel>('hailuo-2.3');
  const [duration, setDuration] = useState<6 | 10>(6);
  const [resolution, setResolution] = useState<'768P' | '1080P'>('1080P');
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null);
  const [now, setNow] = useState(Date.now());

  const fileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const activeCodeRef = useRef('');
  const normalizedCode = code.trim().toUpperCase();
  const firstFrameImage = imageDataUrl || imageUrl.trim();
  const activeTaskIds = useMemo(
    () => tasks.filter((task) => isProcessing(task.status)).map((task) => task.task_id).join(','),
    [tasks],
  );

  const totalRemaining = quota
    ? quota.base.remaining + quota.invite_bonus.remaining
    : null;

  const filteredTasks = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesStatus = filter === 'all'
        || (filter === 'processing' && isProcessing(task.status))
        || (filter === 'success' && isSuccess(task.status))
        || (filter === 'failed' && isFailed(task.status));
      const matchesSearch = !keyword
        || task.prompt.toLowerCase().includes(keyword)
        || task.model.toLowerCase().includes(keyword)
        || task.resolution.toLowerCase().includes(keyword);
      return matchesStatus && matchesSearch;
    });
  }, [filter, search, tasks]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 1800);
  }, []);

  const loadHistory = useCallback(async (cardCode: string, quiet = false) => {
    if (!quiet) setHistoryLoading(true);
    try {
      const response = await fetch(`/api/video/history?code=${encodeURIComponent(cardCode)}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || '加载任务失败');
      if (activeCodeRef.current !== cardCode) return;
      setTasks(body.data.tasks || []);
    } finally {
      if (!quiet) setHistoryLoading(false);
    }
  }, []);

  const loadQuota = useCallback(async (cardCode: string) => {
    const response = await fetch(`/api/video/quota?code=${encodeURIComponent(cardCode)}`, {
      cache: 'no-store',
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.message || '查询额度失败');
    if (activeCodeRef.current !== cardCode) return;
    setQuota(body.data);
  }, []);

  const refreshWorkspace = useCallback(async (quiet = false) => {
    if (normalizedCode.length < 8) return;
    if (!quiet) setRefreshing(true);
    try {
      await Promise.all([
        loadHistory(normalizedCode, quiet),
        loadQuota(normalizedCode),
      ]);
      if (!quiet) showNotice('已刷新');
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : '刷新失败');
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, [loadHistory, loadQuota, normalizedCode, showNotice]);

  useEffect(() => {
    activeCodeRef.current = normalizedCode;
  }, [normalizedCode]);

  useEffect(() => {
    const savedCode = window.localStorage.getItem('nassa-video-card-code') || '';
    if (savedCode) setCode(savedCode);

    const savedOperation = window.sessionStorage.getItem('nassa-video-operation');
    if (savedOperation) {
      try {
        const operation = JSON.parse(savedOperation) as PendingOperation;
        setPendingOperation(operation);
        if (operation.code) setCode(operation.code);
      } catch {
        window.sessionStorage.removeItem('nassa-video-operation');
      }
    }
  }, []);

  useEffect(() => {
    if (normalizedCode.length < 8) {
      setTasks([]);
      setQuota(null);
      return;
    }
    window.localStorage.setItem('nassa-video-card-code', normalizedCode);
    const timer = window.setTimeout(() => {
      Promise.all([loadHistory(normalizedCode), loadQuota(normalizedCode)])
        .catch((reason) => setError(reason instanceof Error ? reason.message : '加载工作台失败'));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [loadHistory, loadQuota, normalizedCode]);

  useEffect(() => {
    if (!activeTaskIds || normalizedCode.length < 8) return;
    const ids = activeTaskIds.split(',');
    let stopped = false;

    const poll = async () => {
      const updates = await Promise.all(ids.map(async (taskId) => {
        try {
          const response = await fetch('/api/video/status', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: normalizedCode, task_id: taskId }),
          });
          const body = await response.json();
          return response.ok && body.success ? body.data as VideoTask : null;
        } catch {
          return null;
        }
      }));
      if (stopped) return;
      setTasks((current) => updates.reduce(
        (next, task) => task ? mergeTask(next, task) : next,
        current,
      ));
    };

    void poll();
    const timer = window.setInterval(poll, 8000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeTaskIds, normalizedCode]);

  useEffect(() => {
    if (!activeTaskIds) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeTaskIds]);

  useEffect(() => {
    if (!pendingOperation) return;
    let stopped = false;

    const poll = async () => {
      try {
        const response = await fetch('/api/video/operation-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: pendingOperation.code,
            operation_id: pendingOperation.operationId,
          }),
        });
        const body = await response.json();
        if (stopped || !response.ok || !body.success) return;
        if (body.data.status === 'submitted') {
          window.sessionStorage.removeItem('nassa-video-operation');
          setPendingOperation(null);
          await refreshWorkspace(true);
          showNotice('任务已恢复');
        } else if (body.data.status === 'failed') {
          window.sessionStorage.removeItem('nassa-video-operation');
          setPendingOperation(null);
          setError(body.data.last_error || '任务提交失败');
        }
      } catch {
        // A transient polling failure should not allow a duplicate submission.
      }
    };

    void poll();
    const timer = window.setInterval(poll, 7000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pendingOperation, refreshWorkspace, showNotice]);

  async function handleFile(file: File | null) {
    setError(null);
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setError('请选择 PNG、JPEG 或 WebP 图片');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('图片不能超过 8MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(String(reader.result || ''));
      setImageUrl('');
      setShowUrlInput(false);
    };
    reader.readAsDataURL(file);
  }

  async function createTask() {
    setError(null);
    if (normalizedCode.length < 8) {
      setSettingsOpen(true);
      setError('请先配置卡密');
      return;
    }
    if (!prompt.trim()) {
      promptRef.current?.focus();
      setError('请输入视频提示词');
      return;
    }
    if (!firstFrameImage) {
      setError('请添加首帧图片');
      return;
    }
    if (pendingOperation) {
      setError('上一次提交仍在确认中');
      return;
    }

    const operationId = crypto.randomUUID();
    setCreating(true);
    try {
      const response = await fetch('/api/video/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: operationId,
          code: normalizedCode,
          prompt: prompt.trim(),
          first_frame_image: firstFrameImage,
          model,
          duration,
          resolution,
        }),
      });
      const body = await response.json();
      if (!body.success) {
        if (body.code === 'SUBMISSION_UNCERTAIN') {
          const operation = { operationId, code: normalizedCode };
          setPendingOperation(operation);
          window.sessionStorage.setItem('nassa-video-operation', JSON.stringify(operation));
        }
        throw new Error(body.message || '创建任务失败');
      }

      setTasks((current) => mergeTask(current, body.data as VideoTask));
      setQuota((current) => current ? {
        ...current,
        base: body.data.base,
        invite_bonus: body.data.invite_bonus,
      } : {
        base: body.data.base,
        invite_bonus: body.data.invite_bonus,
        provider: body.data.provider,
      });
      setPrompt('');
      setImageDataUrl('');
      setImageUrl('');
      showNotice('任务已提交');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建任务失败');
    } finally {
      setCreating(false);
    }
  }

  function reuseTask(task: VideoTask) {
    setPrompt(task.prompt);
    setModel(task.model);
    setDuration(task.duration === 10 ? 10 : 6);
    setResolution(task.resolution === '768P' ? '768P' : '1080P');
    promptRef.current?.focus();
    showNotice('参数已载入');
  }

  async function copyText(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    showNotice(message);
  }

  async function createInviteLink() {
    if (normalizedCode.length < 8) return;
    setInviteLoading(true);
    try {
      const response = await fetch('/api/invite/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ card_code: normalizedCode }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || '生成邀请链接失败');
      setInviteUrl(body.data.invite_url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成邀请链接失败');
    } finally {
      setInviteLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f8fa] pb-[330px] text-[#17191d] md:pb-[245px]">
      <header className="sticky top-0 z-30 border-b border-[#e6e8ec] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1320px] items-center justify-between px-4 sm:px-6">
          <Link href="/video" className="no-underline flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center bg-[#071525] text-xl font-black text-[#28b7ff]">
              N
            </span>
            <span className="truncate text-lg font-semibold text-[#202227] sm:text-xl">
              Nassa Video Playground
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {totalRemaining !== null && (
              <span className="hidden text-sm text-[#676b73] sm:inline">
                剩余 {totalRemaining} 次
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setPrompt('');
                setImageDataUrl('');
                setImageUrl('');
                promptRef.current?.focus();
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#ef4444] px-3 text-sm font-semibold text-white shadow-sm hover:bg-[#dc3636]"
            >
              <Plus className="h-4 w-4" />
              New
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="工作台设置"
              className="flex h-9 w-9 items-center justify-center rounded-md text-[#5d6169] hover:bg-[#f1f3f5] hover:text-[#17191d]"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6">
        <div className="grid grid-cols-[minmax(0,1fr)_48px] gap-3 sm:flex sm:flex-row">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as StatusFilter)}
            aria-label="筛选任务状态"
            className="h-12 rounded-md border border-[#dfe2e7] bg-white px-4 text-sm font-medium outline-none focus:border-[#8a9099] sm:w-40"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <label className="order-3 col-span-2 flex h-12 min-w-0 flex-1 items-center gap-3 rounded-md border border-[#dfe2e7] bg-white px-4 focus-within:border-[#8a9099] sm:order-none sm:col-span-1">
            <Search className="h-5 w-5 shrink-0 text-[#9ca1a9]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索提示词、模型或参数..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a7abb3]"
            />
          </label>
          <button
            type="button"
            onClick={() => void refreshWorkspace()}
            disabled={normalizedCode.length < 8 || refreshing}
            title="刷新任务"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-[#dfe2e7] bg-white text-[#656a72] hover:bg-[#f3f4f6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {historyLoading ? (
          <div className="flex min-h-[360px] items-center justify-center text-sm text-[#8a8f97]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            正在加载任务
          </div>
        ) : filteredTasks.length > 0 ? (
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {filteredTasks.map((task) => {
              const elapsedSeconds = Math.max(0, Math.floor((now - task.created_at * 1000) / 1000));
              const progress = Math.min(94, Math.max(8, Math.round((elapsedSeconds / 240) * 100)));
              return (
                <article
                  key={task.task_id}
                  className="grid min-h-[214px] overflow-hidden rounded-md border border-[#e0e3e8] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:grid-cols-[42%_1fr]"
                >
                  <div className="relative flex min-h-[210px] items-center justify-center overflow-hidden bg-[#f0f1f3] sm:min-h-0">
                    {isSuccess(task.status) && task.download_url ? (
                      <video
                        src={task.download_url}
                        controls
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    ) : isFailed(task.status) ? (
                      <div className="flex flex-col items-center gap-2 text-[#f05b68]">
                        <AlertCircle className="h-8 w-8" />
                        <span className="text-sm font-medium">生成失败</span>
                      </div>
                    ) : (
                      <div className="flex w-full flex-col items-center gap-4 px-7 text-[#69707a]">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-[#d5d9df] bg-white">
                          <Film className="h-6 w-6" />
                          <span className="absolute inset-0 animate-ping rounded-full border border-[#b7bdc6] opacity-40" />
                        </div>
                        <div className="w-full">
                          <div className="mb-2 flex items-center justify-between text-xs">
                            <span>{statusLabel(task.status)}</span>
                            <span>{progress}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[#dfe2e6]">
                            <div
                              className="h-full rounded-full bg-[#25282e] transition-[width] duration-700"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-[11px] text-white">
                      <Clock3 className="h-3 w-3" />
                      {task.duration}s
                    </span>
                  </div>

                  <div className="flex min-w-0 flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className="text-sm font-medium leading-6 text-[#25282d]"
                        style={{
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 3,
                          overflow: 'hidden',
                        }}
                      >
                        {task.prompt}
                      </p>
                      <span className={`shrink-0 rounded px-2 py-1 text-[11px] font-medium ${
                        isSuccess(task.status)
                          ? 'bg-[#e9f7ef] text-[#238654]'
                          : isFailed(task.status)
                            ? 'bg-[#fff0f1] text-[#d94855]'
                            : 'bg-[#eef2f7] text-[#59616d]'
                      }`}>
                        {statusLabel(task.status)}
                      </span>
                    </div>

                    {task.error_message && (
                      <p className="mt-2 line-clamp-2 text-xs text-[#d94855]">{task.error_message}</p>
                    )}

                    <div className="mt-auto flex flex-wrap gap-1.5 pt-4 text-[11px] text-[#666c75]">
                      <span className="rounded bg-[#f2f3f5] px-2 py-1">{MODEL_LABELS[task.model] || task.model}</span>
                      <span className="rounded bg-[#f2f3f5] px-2 py-1">{task.resolution}</span>
                      <span className="rounded bg-[#f2f3f5] px-2 py-1">{formatTime(task.created_at)}</span>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-1 border-t border-[#eff0f2] pt-2">
                      <button
                        type="button"
                        onClick={() => reuseTask(task)}
                        title="复用参数"
                        className="flex h-8 w-8 items-center justify-center rounded text-[#757b84] hover:bg-[#f1f3f5] hover:text-[#25282d]"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      {task.download_url && (
                        <>
                          <button
                            type="button"
                            onClick={() => void copyText(task.download_url!, '链接已复制')}
                            title="复制视频链接"
                            className="flex h-8 w-8 items-center justify-center rounded text-[#757b84] hover:bg-[#f1f3f5] hover:text-[#25282d]"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <a
                            href={task.download_url}
                            download
                            target="_blank"
                            rel="noreferrer"
                            title="下载视频"
                            className="flex h-8 w-8 items-center justify-center rounded text-[#757b84] hover:bg-[#f1f3f5] hover:text-[#25282d]"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[390px] flex-col items-center justify-center text-center text-[#8a9098]">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#dfe2e7] bg-white">
              <Film className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-[#5f646c]">
              {normalizedCode.length < 8 ? '尚未加载任务' : '没有符合条件的任务'}
            </p>
            {normalizedCode.length < 8 && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="mt-3 rounded-md border border-[#d7dae0] bg-white px-3 py-2 text-xs font-medium text-[#50555d] hover:bg-[#f2f3f5]"
              >
                配置卡密
              </button>
            )}
          </div>
        )}
      </section>

      <section className="fixed inset-x-0 bottom-0 z-20 px-3 pb-3 sm:px-5 sm:pb-5">
        <div className="mx-auto max-w-[1080px] rounded-lg border border-[#dfe2e6] bg-white p-3 shadow-[0_16px_50px_rgba(17,24,39,0.16)] sm:p-4">
          {firstFrameImage && (
            <div className="mb-3 flex items-center gap-3 border-b border-[#eceef1] pb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={firstFrameImage} alt="首帧预览" className="h-12 w-12 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-[#43474e]">首帧图片</p>
                <p className="truncate text-[11px] text-[#969ba3]">
                  {imageDataUrl ? '本地图片' : imageUrl}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setImageDataUrl('');
                  setImageUrl('');
                }}
                title="移除首帧"
                className="flex h-8 w-8 items-center justify-center rounded text-[#8b9098] hover:bg-[#f1f3f5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {showUrlInput && !imageDataUrl && (
            <div className="mb-3 flex gap-2">
              <input
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://.../first-frame.jpg"
                className="h-10 min-w-0 flex-1 rounded-md border border-[#dfe2e7] px-3 text-sm outline-none focus:border-[#858b94]"
              />
              <button
                type="button"
                onClick={() => setShowUrlInput(false)}
                title="收起图片链接"
                className="flex h-10 w-10 items-center justify-center rounded-md border border-[#dfe2e7] text-[#747a83] hover:bg-[#f2f3f5]"
              >
                <Check className="h-4 w-4" />
              </button>
            </div>
          )}

          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={2}
            maxLength={1800}
            placeholder="描述你想生成的视频..."
            className="max-h-28 min-h-[54px] w-full resize-none bg-transparent px-1 text-sm leading-6 text-[#24272c] outline-none placeholder:text-[#a6abb3]"
          />

          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-[150px] flex-1 sm:flex-none">
              <span className="mb-1 block text-[11px] text-[#8d929a]">模型</span>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value as HailuoModel)}
                className="h-10 w-full rounded-md border border-[#e0e2e6] bg-[#fafafa] px-3 text-xs font-medium outline-none focus:border-[#91969f]"
              >
                <option value="hailuo-2.3">海螺 2.3</option>
                <option value="hailuo-2.3-fast">海螺 2.3 Fast</option>
              </select>
            </label>
            <label className="min-w-[92px] flex-1 sm:flex-none">
              <span className="mb-1 block text-[11px] text-[#8d929a]">时长</span>
              <select
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value) as 6 | 10)}
                className="h-10 w-full rounded-md border border-[#e0e2e6] bg-[#fafafa] px-3 text-xs font-medium outline-none focus:border-[#91969f]"
              >
                <option value={6}>6 秒</option>
                <option value={10}>10 秒</option>
              </select>
            </label>
            <label className="min-w-[105px] flex-1 sm:flex-none">
              <span className="mb-1 block text-[11px] text-[#8d929a]">画质</span>
              <select
                value={resolution}
                onChange={(event) => setResolution(event.target.value as '768P' | '1080P')}
                className="h-10 w-full rounded-md border border-[#e0e2e6] bg-[#fafafa] px-3 text-xs font-medium outline-none focus:border-[#91969f]"
              >
                <option value="768P">768P</option>
                <option value="1080P">1080P</option>
              </select>
            </label>

            <div className="ml-auto flex items-center gap-2 pt-4 sm:pt-0">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => void handleFile(event.target.files?.[0] || null)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title="上传首帧"
                className="flex h-10 w-10 items-center justify-center rounded-md bg-[#eef0f3] text-[#59606a] hover:bg-[#e3e6ea]"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowUrlInput((value) => !value)}
                title="使用图片链接"
                className="flex h-10 w-10 items-center justify-center rounded-md bg-[#eef0f3] text-[#59606a] hover:bg-[#e3e6ea]"
              >
                <Link2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void createTask()}
                disabled={creating || Boolean(pendingOperation)}
                title="生成视频"
                className="flex h-10 w-10 items-center justify-center rounded-md bg-[#202226] text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-[#d8dbe0]"
              >
                {creating || pendingOperation ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {(error || notice) && (
        <div className={`fixed bottom-[305px] left-1/2 z-50 max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-md px-4 py-2 text-sm shadow-lg md:bottom-[220px] ${
          error ? 'bg-[#dc3f4d] text-white' : 'bg-[#22252a] text-white'
        }`}>
          <div className="flex items-center gap-2">
            {error ? <AlertCircle className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}
            <span>{error || notice}</span>
            {error && (
              <button type="button" onClick={() => setError(null)} title="关闭提示">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="工作台设置"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSettingsOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-lg border border-[#dedfe3] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#eceef1] px-5 py-4">
              <div>
                <h2 className="font-semibold text-[#22252a]">工作台设置</h2>
                <p className="mt-0.5 text-xs text-[#92979f]">Nassa Video Playground</p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                title="关闭设置"
                className="flex h-8 w-8 items-center justify-center rounded text-[#767c85] hover:bg-[#f1f3f5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-6 px-5 py-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#40444a]">卡密</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="GP-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  className="h-11 w-full rounded-md border border-[#d9dce1] px-3 font-mono text-sm outline-none focus:border-[#777e88]"
                />
              </label>

              <div className="border-t border-[#eceef1] pt-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[#40444a]">视频额度</span>
                  <span className="text-xs text-[#8e939b]">
                    {quota ? `基础 ${quota.base.remaining} · 奖励 ${quota.invite_bonus.remaining}` : '未加载'}
                  </span>
                </div>
                {quota && (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eceef1]">
                    <div
                      className="h-full rounded-full bg-[#22252a]"
                      style={{
                        width: `${Math.min(100, ((quota.base.remaining + quota.invite_bonus.remaining) / Math.max(1, quota.base.total + quota.invite_bonus.total)) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="border-t border-[#eceef1] pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#40444a]">邀请奖励</p>
                    <p className="mt-1 text-xs text-[#92979f]">每位好友成功生成后增加一次额度</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void createInviteLink()}
                    disabled={normalizedCode.length < 8 || inviteLoading}
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-[#d9dce1] px-3 text-xs font-medium text-[#51565e] hover:bg-[#f3f4f6] disabled:opacity-40"
                  >
                    {inviteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    生成链接
                  </button>
                </div>
                {inviteUrl && (
                  <button
                    type="button"
                    onClick={() => void copyText(inviteUrl, '邀请链接已复制')}
                    className="mt-3 flex w-full items-center gap-2 rounded-md bg-[#f4f5f6] px-3 py-2 text-left text-xs text-[#60666f]"
                  >
                    <span className="min-w-0 flex-1 truncate">{inviteUrl}</span>
                    <Copy className="h-3.5 w-3.5 shrink-0" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[#eceef1] px-5 py-4">
              <Link href="/" className="text-xs text-[#777d86] hover:text-[#22252a]">
                返回激活中心
              </Link>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  void refreshWorkspace(true);
                }}
                className="rounded-md bg-[#202226] px-4 py-2 text-sm font-medium text-white hover:bg-black"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
