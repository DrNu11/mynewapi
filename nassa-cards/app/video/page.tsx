'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Film,
  ImagePlus,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from 'lucide-react';

type TaskState = {
  task_id: string;
  status: string;
  file_id?: string | null;
  download_url?: string | null;
  error_message?: string | null;
};

const models = ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast'];
const durations = [6, 10];
const resolutions = ['1080P', '768P'];

function statusText(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('success')) return '生成完成';
  if (s.includes('fail') || s.includes('error')) return '生成失败';
  if (s.includes('queryfailed')) return '查询失败';
  if (s.includes('processing') || s.includes('queue') || s.includes('prepare')) return '生成中';
  return status || '等待中';
}

export default function VideoPage() {
  const [code, setCode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [model, setModel] = useState(models[0]);
  const [duration, setDuration] = useState(6);
  const [resolution, setResolution] = useState('1080P');
  const [task, setTask] = useState<TaskState | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const firstFrameImage = useMemo(() => imageDataUrl || imageUrl.trim(), [imageDataUrl, imageUrl]);
  const canSubmit = code.trim().length >= 8 && prompt.trim() && firstFrameImage && !loading;
  const isDone = !!task?.download_url;

  useEffect(() => {
    try {
      const cachedCode = localStorage.getItem('nc_cache_code');
      if (cachedCode) setCode(cachedCode.toUpperCase());
    } catch {
      // ignore local cache parse errors
    }
  }, []);

  useEffect(() => {
    if (!task?.task_id || task.download_url) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      setPolling(true);
      try {
        const res = await fetch('/api/video/status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: code.trim().toUpperCase(), task_id: task.task_id }),
        });
        const body = await res.json();
        if (!alive) return;
        if (body?.data) setTask(body.data);
        if (!body.success && body.message) setError(body.message);
      } catch (e: any) {
        if (alive) setError(e?.message || '查询任务失败');
      } finally {
        if (alive) setPolling(false);
      }
    };

    poll();
    timer = setInterval(poll, 8000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [task?.task_id, task?.download_url, code]);

  async function onFileChange(file: File | null) {
    setError(null);
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setError('请上传 PNG / JPEG / WebP 图片');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('图片建议小于 8MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(String(reader.result || ''));
      setImageUrl('');
    };
    reader.readAsDataURL(file);
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setTask(null);
    try {
      const res = await fetch('/api/video/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          prompt: prompt.trim(),
          first_frame_image: firstFrameImage,
          model,
          duration,
          resolution,
        }),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.message || '创建任务失败');
        return;
      }
      setTask(body.data);
    } catch (e: any) {
      setError(e?.message || '创建任务失败');
    } finally {
      setLoading(false);
    }
  }

  async function copyUrl() {
    if (!task?.download_url) return;
    await navigator.clipboard.writeText(task.download_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 pt-10 pb-20">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          返回激活中心
        </a>

        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-4 py-1.5 text-sm text-brand-400">
            <Sparkles className="h-4 w-4" />
            MiniMax Hailuo 图生视频
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
            图生视频工作台
          </h1>
          <p className="mt-4 text-base text-slate-400 sm:text-lg">
            使用已激活的 GPT / DeepSeek 卡密创建视频任务，生成完成后直接预览和下载
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[380px_1fr]">
          <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
                <Film className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-100">创建任务</h2>
                <p className="text-xs text-slate-500">MiniMax Hailuo · 服务端安全调用</p>
              </div>
            </div>

          <form onSubmit={createTask} className="mt-5 space-y-5">
            <label className="block">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <KeyRound className="h-4 w-4" />
                卡密
              </span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="GP-XXXX-XXXX-XXXX / DE-XXXX-XXXX-XXXX"
                className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />
              <p className="mt-2 text-xs text-slate-500">
                请先在激活中心激活 GPT 或 DeepSeek 卡密，再从结果页进入此工作台。
              </p>
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <ImagePlus className="h-4 w-4" />
                首帧图片
              </span>
              <div className="mt-2 flex gap-2">
                <input
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    setImageDataUrl('');
                  }}
                  placeholder="https://.../image.jpg"
                  className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg border border-slate-600 bg-slate-950 px-3 text-slate-300 transition hover:border-brand-500/70 hover:text-white"
                  title="上传图片"
                >
                  <ImagePlus className="h-4 w-4" />
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => onFileChange(e.target.files?.[0] || null)}
              />
            </label>

            <label className="block">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <WandSparkles className="h-4 w-4" />
                提示词
              </span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder="描述镜头运动、主体动作、氛围和风格..."
                className="mt-2 w-full resize-none rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-slate-400">模型</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-2 py-2 text-xs outline-none focus:border-brand-500"
                >
                  {models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">时长</span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-2 py-2 text-xs outline-none focus:border-brand-500"
                >
                  {durations.map((d) => (
                    <option key={d} value={d}>
                      {d}s
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">分辨率</span>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-2 py-2 text-xs outline-none focus:border-brand-500"
                >
                  {resolutions.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            </div>

            {error && (
              <div className="flex gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              创建视频任务
            </button>
          </form>
          </section>

          <section className="min-h-[680px] rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-2xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">生成结果</h2>
              <p className="text-xs text-slate-500">任务创建后自动轮询，成功后展示视频预览</p>
            </div>
            {task && (
              <div className="flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1.5 text-xs text-brand-300">
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : polling ? (
                  <RefreshCw className="h-4 w-4 animate-spin text-brand-300" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                )}
                {statusText(task.status)}
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[260px_1fr]">
            <div className="space-y-3">
              <div className="aspect-square overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
                {firstFrameImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={firstFrameImage} alt="首帧预览" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-600">
                    <ImagePlus className="h-8 w-8" />
                  </div>
                )}
              </div>
              {task?.task_id && (
                <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-400">
                  <div className="text-slate-500">Task ID</div>
                  <div className="mt-1 break-all font-mono text-slate-200">{task.task_id}</div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
              {task?.download_url ? (
                <div className="space-y-4">
                  <video src={task.download_url} controls className="aspect-video w-full rounded-lg bg-black" />
                  <div className="flex flex-wrap gap-3">
                    <a
                      href={task.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
                    >
                      <Download className="h-4 w-4" />
                      下载视频
                    </a>
                    <button
                      type="button"
                      onClick={copyUrl}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500"
                    >
                      <Copy className="h-4 w-4" />
                      {copied ? '已复制' : '复制链接'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                  <Film className="h-12 w-12 text-slate-700" />
                  <h3 className="mt-4 text-sm font-medium text-slate-300">
                    {task ? statusText(task.status) : '还没有视频任务'}
                  </h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                    {task
                      ? task.error_message || '视频生成通常需要几分钟，请保持页面打开。'
                      : '填写左侧表单创建任务，完成后这里会出现可播放的视频。'}
                  </p>
                </div>
              )}
            </div>
          </div>
          </section>
        </div>
      </div>
    </main>
  );
}
