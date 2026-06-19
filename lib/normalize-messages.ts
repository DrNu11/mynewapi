/**
 * OpenAI 风格的 chat message 结构。完全以 unknown 定义的原因:
 * 客户可能传任何形式的 content (string / array / null / object)。
 */
export type Message = {
  role?: unknown;
  content?: unknown;
  name?: unknown;
  [key: string]: unknown;
};

/**
 * 把 message 的 content 提取为文本。
 *   - string:原样
 *   - array (OpenAI multipart 新格式):过滤出文本类型块合并
 *     - chat completions: {type:"text", text:"..."}
 *     - responses API:    {type:"input_text", text:"..."}
 *   - 其他:返回空字符串
 *
 * 注意:array content 里的非 text 部分(image_url / input_image 等)会被丢弃。
 * 但 system role 携带 image 的场景极少见,且 minimax 本身不支持图片,可接受。
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (p): p is { type: 'text' | 'input_text'; text: string } => {
          if (!p || typeof p !== 'object') return false;
          const type = (p as { type?: unknown }).type;
          const text = (p as { text?: unknown }).text;
          return (type === 'text' || type === 'input_text') && typeof text === 'string';
        },
      )
      .map((p) => p.text)
      .join('\n\n');
  }
  return '';
}

/**
 * 规范化 messages 数组,适配 MiniMax 等上游对 system role 的双约束:
 *   1. messages 中最多只能有 1 个 role:"system" 消息
 *   2. system 必须出现在所有 user/assistant 消息之前
 *
 * 触发该规范化的现实场景:
 *   - 客户应用层注入 1 个 system + SDK 默认注入 1 个 system → minimax 返回 2013
 *   - 客户中途切换 prompt(对话历史里 user 之后又插 system) → minimax 返回 2013
 *
 * 策略:
 *   - 0 个 system: 原样返回
 *   - ≥1 个 system: 抽出全部 system, content 用 "\n\n" 合并, 作为单一 system 放到首位
 *   - 保留首个 system 的 name 字段(如果有)
 */
export function normalizeMessages(messages: Message[]): Message[] {
  const systems = messages.filter((m) => m?.role === 'system');
  if (systems.length === 0) return messages;
  const nonSystems = messages.filter((m) => m?.role !== 'system');
  const merged: Message = {
    role: 'system',
    content: systems.map((s) => extractText(s.content)).join('\n\n'),
  };
  const firstName = systems[0]?.name;
  if (typeof firstName === 'string' && firstName) {
    merged.name = firstName;
  }
  return [merged, ...nonSystems];
}

/**
 * 规范化 OpenAI Responses API 的 `input` 字段(Codex CLI 0.130.0 等用 /v1/responses 的客户)。
 *
 * input 形态:
 *   - string:           客户传一句话,无 role 概念 → 原样返回(除非 prependSystem)
 *   - InputItem[]:      role+content 数组(类似 messages) → 复用 normalizeMessages 处理 system
 *   - 其他类型 (null/undefined/object): 不动,原样返回
 *
 * options.prependSystem:
 *   codex CLI 0.130.0 等客户的顶层 `instructions` 字段内容。
 *   会作为第一个 system message 注入到 input 开头,然后参与 system 合并。
 *
 * 根因(2026-05-18 incident):
 *   /v1/responses 顶层 `instructions` + input 含 `developer` role 时,
 *   NewAPI 反向转换会把两者都转成 system,产生双 system → MiniMax 2013。
 *   解决: 提前在 nassa-cards 把 developer 转 system,合并 prependSystem 与所有 system,
 *   并从顶层删除 instructions(在调用方处理),让 NewAPI 收到干净的单 system input。
 *
 * InputItem 数组可能含非 role 元素(如 {type:"function_call_output", call_id, output}),
 * 这些元素 role 字段为 undefined,进入 nonSystems 分支保持顺序。
 */
export function normalizeResponsesInput(
  input: unknown,
  options?: { prependSystem?: string },
): unknown {
  const prepend = options?.prependSystem;
  const hasPrepend = typeof prepend === 'string' && prepend.length > 0;

  // string input + prependSystem → 构造 [system, user]
  if (typeof input === 'string') {
    if (hasPrepend) {
      return [
        { role: 'system', content: prepend },
        { role: 'user', content: input },
      ];
    }
    return input;
  }

  // 非数组(null/undefined/对象等): 不动
  if (!Array.isArray(input)) return input;

  // developer role → system role(只对 message 类元素生效,不影响 function_call 等)
  // 用 some 探测是否需要 mutate,避免不必要的拷贝(保留零拷贝零变更的现有行为)
  const needsDevToSys = input.some((m) => (m as Message)?.role === 'developer');
  const effectiveInput: Message[] = needsDevToSys
    ? (input as Message[]).map((m) =>
      m?.role === 'developer' ? { ...m, role: 'system' } : m,
    )
    : (input as Message[]);

  // prependSystem: 在最前面注入一条 system message
  if (hasPrepend) {
    const withPrepend = [{ role: 'system', content: prepend }, ...effectiveInput];
    return normalizeMessages(withPrepend);
  }

  // 没有 prepend 也没有 developer → 复用现有逻辑(零拷贝路径)
  if (!needsDevToSys) {
    return normalizeMessages(effectiveInput);
  }
  return normalizeMessages(effectiveInput);
}
