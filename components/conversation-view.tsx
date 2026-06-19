'use client';

/**
 * 对话气泡视图 — 把 messages 数组渲染成 ChatGPT/Claude 风格的对话
 * 共享组件,被 /admin/audit/page.tsx 和 /audit-viewer/page.tsx 复用
 */

import { useMemo } from 'react';
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  Wrench,
  ImageIcon,
} from 'lucide-react';

interface ParsedMessage {
  role: string;
  content: any;
}

/** 任意值 → string(防 React error #31:object 不能作为 child)*/
function s(v: any): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** 尝试把字符串当 JSON pretty print,失败就返回原字符串 */
function tryPretty(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * 智能恢复被截断的 JSON 数组。
 * audit.ts 在请求体超过 200KB 时会切断 + 加 [TRUNCATED N bytes] 标记,
 * 导致 JSON.parse 失败。这里:
 *   1. 去掉 truncate 标记
 *   2. 一次扫描找出最后一个 depth=1 的 `}`(数组元素结束的位置)
 *   3. 在该位置后 close 数组,得到合法 JSON
 * O(N) 时间,200KB 数据 < 10ms
 */
function tryRecoverTruncatedJsonArray(s: string): any | null {
  // 去 [TRUNCATED] 后缀
  const cleaned = s.replace(/\s*\.{3}\[TRUNCATED[\s\S]*$/, '').trim();
  if (!cleaned) return null;

  if (!cleaned.startsWith('[')) {
    // 对象或其他:不处理截断,直接尝试 parse
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }

  // 扫描追踪 depth 找最后一个数组元素结束位置(depth 从 1 → 0 的 } 之前 depth=2 的 } 之后)
  // 严谨写法:在解析过程中跟踪 [/{/string/escape 状态,记录每次 depth 回到 1 时的 `}` 位置
  let depth = 0;
  let inStr = false;
  let escape = false;
  let lastSafeIdx = -1;

  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '[' || c === '{') {
      depth++;
    } else if (c === ']' || c === '}') {
      depth--;
      // 数组元素结束(depth 从 2 回到 1)且当前是 }
      if (depth === 1 && c === '}') {
        lastSafeIdx = i;
      }
    }
  }

  if (lastSafeIdx < 0) return null;
  const fixed = cleaned.slice(0, lastSafeIdx + 1) + ']';
  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

export function parseMessages(requestMessages: string, endpoint: string): ParsedMessage[] {
  if (!requestMessages) return [];

  let parsed: any;
  try {
    parsed = JSON.parse(requestMessages);
  } catch {
    // 尝试修复被截断的 JSON(audit.ts 的 200KB 截断会导致 JSON 不完整)
    parsed = tryRecoverTruncatedJsonArray(requestMessages);
    if (parsed === null) {
      // 真的修不了 → 当字符串显示
      return [{ role: 'user', content: requestMessages }];
    }
  }

  // 把 codex /v1/responses 的特殊 type 转成标准化 role
  const normalizeItem = (m: any): ParsedMessage | null => {
    if (m == null) return null;
    if (typeof m === 'string') return { role: 'user', content: m };

    // codex /v1/responses 的特殊 input items
    if (m.type === 'function_call') {
      return { role: 'function_call', content: m };
    }
    if (m.type === 'function_call_output') {
      return { role: 'function_call_output', content: m };
    }
    if (m.type === 'reasoning') {
      return { role: 'reasoning', content: m };
    }
    if (m.type === 'message') {
      return {
        role: m.role || 'assistant',
        content: m.content !== undefined ? m.content : m,
      };
    }

    // 标准 OpenAI/Anthropic {role, content}
    const role = m.role || m.type || 'user';
    const content = m.content !== undefined ? m.content : m;
    return { role, content };
  };

  // 数组:OpenAI/Anthropic messages 或 codex input
  if (Array.isArray(parsed)) {
    const items = parsed
      .map(normalizeItem)
      .filter((x): x is ParsedMessage => x !== null);
    if (items.length > 0) return items;
  }

  // 对象:完整 body
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.messages)) {
      const items = parsed.messages
        .map(normalizeItem)
        .filter((x: ParsedMessage | null): x is ParsedMessage => x !== null);
      if (items.length > 0) return items;
    }
    if (typeof parsed.input === 'string') {
      return [{ role: 'user', content: parsed.input }];
    }
    if (Array.isArray(parsed.input)) {
      const items = parsed.input
        .map(normalizeItem)
        .filter((x: ParsedMessage | null): x is ParsedMessage => x !== null);
      if (items.length > 0) return items;
    }
    if (typeof parsed.prompt === 'string') {
      return [{ role: 'user', content: parsed.prompt }];
    }
  }

  if (typeof parsed === 'string') {
    return [{ role: 'user', content: parsed }];
  }

  return [
    {
      role: 'user',
      content: typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : String(parsed),
    },
  ];
}

export function ConversationView(props: {
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
      {props.flagReason && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">关键词命中:</span> {props.flagReason}
          </span>
        </div>
      )}

      {messages.map((msg, i) => (
        <MessageBubble
          key={i}
          role={msg.role}
          content={msg.content}
          flagReason={props.flagReason}
        />
      ))}

      {(props.responseText || props.reasoningText) && (
        <AssistantResponseBubble
          responseText={props.responseText}
          reasoningText={props.reasoningText}
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

  // codex /v1/responses 特殊 type 渲染
  if (props.role === 'function_call') {
    const c = props.content || {};
    return (
      <details className="ml-8 rounded-lg border border-purple-500/30 bg-purple-500/5">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-purple-300">
          <Wrench className="mr-1 inline h-3 w-3" />
          🔧 调用工具:
          <span className="ml-1 font-mono text-purple-100">{s(c.name) || '(unknown)'}</span>
          {c.call_id && <span className="ml-2 font-mono text-[10px] text-purple-400/60">{s(c.call_id)}</span>}
        </summary>
        <div className="px-3 pb-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">参数</div>
          <pre className="overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-[11px] text-purple-100">
            {tryPretty(c.arguments)}
          </pre>
        </div>
      </details>
    );
  }
  if (props.role === 'function_call_output') {
    const c = props.content || {};
    return (
      <details className="ml-8 rounded-lg border border-amber-500/30 bg-amber-500/5">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-amber-300">
          📝 工具返回
          {c.call_id && <span className="ml-2 font-mono text-[10px] text-amber-400/60">{s(c.call_id)}</span>}
        </summary>
        <div className="px-3 pb-3">
          <pre className="overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-[11px] text-amber-100">
            {tryPretty(c.output)}
          </pre>
        </div>
      </details>
    );
  }
  if (props.role === 'reasoning') {
    const c = props.content || {};
    const summary = s(
      c.summary ||
      (Array.isArray(c.content) ? c.content.map((x: any) => s(x?.text)).join('\n') : '') ||
      c,
    );
    return (
      <details className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-fuchsia-300">
          🧠 思考过程 reasoning(点击展开)
        </summary>
        <div className="px-3 pb-3">
          <pre className="overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-[11px] text-fuchsia-100">
            {summary}
          </pre>
        </div>
      </details>
    );
  }

  if (isSystem) {
    return (
      <details className="rounded-lg border border-purple-500/30 bg-purple-500/5">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-purple-300">
          ⚙️ {s(props.role)} prompt（点击展开）
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

  const bubbleClass = isUser
    ? 'ml-12 self-end border-blue-500/40 bg-blue-500/10 text-blue-50'
    : 'mr-12 border-emerald-500/40 bg-emerald-500/10 text-emerald-50';
  const labelClass = isUser ? 'text-blue-300' : 'text-emerald-300';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] rounded-lg border px-4 py-3 ${bubbleClass}`}>
        <div
          className={`mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${labelClass}`}
        >
          {isUser ? '👤 user' : isAssistant ? '🤖 assistant' : s(props.role)}
        </div>
        <ContentRenderer
          content={props.content}
          highlightKeywords={isUser ? props.flagReason : null}
        />
      </div>
    </div>
  );
}

function AssistantResponseBubble(props: {
  responseText: string | null;
  reasoningText: string | null;
}) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-emerald-50">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
          🤖 assistant <span className="text-slate-500">· 模型实际返回</span>
        </div>

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

  if (typeof props.content === 'string') {
    return (
      <TextWithHighlight
        text={props.content}
        keywords={props.highlightKeywords}
        compact={props.compact}
      />
    );
  }

  if (Array.isArray(props.content)) {
    return (
      <div className="space-y-2">
        {props.content.map((block: any, i: number) => (
          <ContentBlockRenderer
            key={i}
            block={block}
            highlightKeywords={props.highlightKeywords ?? null}
          />
        ))}
      </div>
    );
  }

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
            tool_use: <span className="font-mono">{s(block.name)}</span>{' '}
            <ChevronDown className="ml-1 inline h-3 w-3" />
          </summary>
          <pre className="whitespace-pre-wrap px-2 pb-2 font-mono text-[11px] text-purple-100">
            {s(block.input)}
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
          [{s(block.type) || '?'}] {s(block)}
        </pre>
      );
  }
}

function TextWithHighlight(props: {
  text: any; // 可能是 string / object / 其他;内部强制转 string 防 React error #31
  keywords?: string | null;
  compact?: boolean;
}) {
  // 强制转 string,object 用 JSON.stringify
  const rawText = props.text;
  let text: string;
  if (typeof rawText === 'string') {
    text = rawText;
  } else if (rawText == null) {
    text = '';
  } else if (typeof rawText === 'object') {
    try {
      text = JSON.stringify(rawText, null, 2);
    } catch {
      text = String(rawText);
    }
  } else {
    text = String(rawText);
  }
  const cls = props.compact
    ? 'whitespace-pre-wrap break-words text-xs leading-relaxed'
    : 'whitespace-pre-wrap break-words text-sm leading-relaxed';

  if (!props.keywords) {
    return <div className={cls}>{text}</div>;
  }

  const kws = props.keywords
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (kws.length === 0) return <div className={cls}>{text}</div>;

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
