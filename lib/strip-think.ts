/**
 * 流式剥离 `<think>...</think>` 块。
 *
 * 背景:
 *   MiniMax-M / mimo 等思考模型把 chain-of-thought 直接塞在 chat completions
 *   的 `content` 字段(用 <think>...</think> 标签包裹),而不是分离到 reasoning_content。
 *   codex CLI / 普通客户端会把 content 原样显示给用户,体验糟糕。
 *
 *   NewAPI 的 `thinking_to_content` 设置只在上游给出 reasoning_content 字段时生效,
 *   对"<think> 直接塞 content"的形态束手无策。所以由 nassa-cards 层处理。
 *
 * 设计:
 *   状态机 + 跨 chunk 边界缓冲。两个状态:
 *     - 'outside': 文本输出
 *     - 'inside':  在 <think>...</think> 内部,内容不输出
 *
 *   边界场景:
 *     - 跨 chunk 的 partial marker(如末尾 "Hello <thi"):缓冲后等下一 chunk
 *     - 整 chunk 都在 think 内部:不输出
 *     - 未闭合的 <think>(流意外结束):内容全丢弃,flush 不输出
 */
const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/**
 * 找 text 末尾匹配 marker 前缀的最长长度。
 * 用于检测跨 chunk 的 partial marker。
 *
 * 例: text="abc<th", marker="<think>" → 返回 3(末尾"<th"是 marker 前缀)
 *     text="abc",    marker="<think>" → 返回 0
 *     text="<",      marker="<think>" → 返回 1
 */
function partialMarkerLen(text: string, marker: string): number {
  const max = Math.min(text.length, marker.length - 1);
  for (let n = max; n > 0; n--) {
    if (text.endsWith(marker.slice(0, n))) return n;
  }
  return 0;
}

export class ThinkStripper {
  private state: 'outside' | 'inside' = 'outside';
  private buffer = ''; // 跨 chunk 暂存 partial marker

  /**
   * 喂入一段文本,返回应输出的剥离后内容(可能为空字符串)。
   * 调用方负责把返回值拼到客户端可见的内容。
   */
  feed(input: string): string {
    if (input.length === 0) return '';
    let combined = this.buffer + input;
    this.buffer = '';
    let out = '';

    while (combined.length > 0) {
      if (this.state === 'outside') {
        const idx = combined.indexOf(OPEN_TAG);
        if (idx === -1) {
          // 没完整 OPEN_TAG,看末尾是否是 partial marker 起始
          const partial = partialMarkerLen(combined, OPEN_TAG);
          if (partial > 0) {
            out += combined.slice(0, combined.length - partial);
            this.buffer = combined.slice(combined.length - partial);
          } else {
            out += combined;
          }
          combined = '';
        } else {
          out += combined.slice(0, idx);
          combined = combined.slice(idx + OPEN_TAG.length);
          this.state = 'inside';
        }
      } else {
        // inside: 找 CLOSE_TAG
        const idx = combined.indexOf(CLOSE_TAG);
        if (idx === -1) {
          // 没完整 CLOSE_TAG,看末尾是否 partial '</thin' 等
          const partial = partialMarkerLen(combined, CLOSE_TAG);
          if (partial > 0) {
            this.buffer = combined.slice(combined.length - partial);
          }
          combined = '';
        } else {
          // think 内容丢弃,跳过 CLOSE_TAG 切回 outside
          combined = combined.slice(idx + CLOSE_TAG.length);
          this.state = 'outside';
        }
      }
    }
    return out;
  }

  /**
   * 流结束时调用,返回剩余缓冲。
   * - outside 状态:缓冲是 partial marker 残留,作为普通文本输出
   * - inside 状态:think 未闭合,缓冲是 partial close marker,丢弃不输出
   */
  flush(): string {
    if (this.state === 'outside') {
      const tail = this.buffer;
      this.buffer = '';
      return tail;
    }
    this.buffer = '';
    return '';
  }
}

/**
 * 处理一行 SSE("data: {...}"或其他)。
 * 识别两种含 think 的字段并就地剥离:
 *   - chat completions:    obj.choices[].delta.content
 *   - responses API:       obj.delta (当 obj.type 以 'output_text.delta' 结尾)
 *
 * stripper 在调用方持有,跨多个 SSE event 共享状态以正确处理跨 event 的 <think>。
 */
export function processSSELine(line: string, stripper: ThinkStripper): string {
  if (!line.startsWith('data: ')) return line;
  const dataStr = line.slice(6);
  if (dataStr === '[DONE]' || dataStr.trim() === '') return line;
  try {
    const obj = JSON.parse(dataStr);
    let mutated = false;
    // chat completions stream delta
    if (Array.isArray(obj?.choices)) {
      for (const c of obj.choices) {
        const content = c?.delta?.content;
        if (typeof content === 'string') {
          c.delta.content = stripper.feed(content);
          mutated = true;
        }
      }
    }
    // responses API output_text delta event
    if (
      typeof obj?.type === 'string' &&
      obj.type.endsWith('output_text.delta') &&
      typeof obj.delta === 'string'
    ) {
      obj.delta = stripper.feed(obj.delta);
      mutated = true;
    }
    // Anthropic Messages 流式: content_block_delta + delta.type === 'text_delta'
    if (
      obj?.type === 'content_block_delta' &&
      obj?.delta?.type === 'text_delta' &&
      typeof obj.delta.text === 'string'
    ) {
      obj.delta.text = stripper.feed(obj.delta.text);
      mutated = true;
    }
    if (mutated) return 'data: ' + JSON.stringify(obj);
    return line;
  } catch {
    return line;
  }
}

/**
 * 处理非流式响应 body(完整 JSON)。
 * 识别两种含 think 的字段:
 *   - chat completions: choices[].message.content
 *   - responses API:    output[].content[].text (type === 'output_text')
 *
 * 每个独立 content 用独立 ThinkStripper(它们是独立完整文本,状态不共享)。
 * 无 <think> 时返回原 body(零拷贝优化)。
 */
export function processNonStreamBody(body: string): string {
  try {
    const obj = JSON.parse(body);
    let mutated = false;
    if (Array.isArray(obj?.choices)) {
      for (const c of obj.choices) {
        const content = c?.message?.content;
        if (typeof content === 'string' && content.includes('<think>')) {
          const s = new ThinkStripper();
          c.message.content = s.feed(content) + s.flush();
          mutated = true;
        }
      }
    }
    if (Array.isArray(obj?.output)) {
      for (const out of obj.output) {
        if (Array.isArray(out?.content)) {
          for (const part of out.content) {
            if (
              part?.type === 'output_text' &&
              typeof part.text === 'string' &&
              part.text.includes('<think>')
            ) {
              const s = new ThinkStripper();
              part.text = s.feed(part.text) + s.flush();
              mutated = true;
            }
          }
        }
      }
    }
    // Anthropic Messages 非流式: 顶层 type='message' + content[] 数组,
    // 每项 {type:'text', text:'...'} 或 tool_use 等
    if (obj?.type === 'message' && Array.isArray(obj?.content)) {
      for (const part of obj.content) {
        if (
          part?.type === 'text' &&
          typeof part.text === 'string' &&
          part.text.includes('<think>')
        ) {
          const s = new ThinkStripper();
          part.text = s.feed(part.text) + s.flush();
          mutated = true;
        }
      }
    }
    return mutated ? JSON.stringify(obj) : body;
  } catch {
    return body;
  }
}

/**
 * 把 ThinkStripper 包装成 TransformStream,可插入 Response 的 body pipeline。
 *
 * isStream=true: SSE 行流,跨 event 共享 stripper 状态
 * isStream=false: 累积整 body 后一次性处理(非流式 JSON)
 */
export function makeThinkStripTransform(
  isStream: boolean,
): TransformStream<Uint8Array, Uint8Array> {
  const streamStripper = new ThinkStripper();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = '';

  return new TransformStream({
    transform(chunk, ctrl) {
      const text = dec.decode(chunk, { stream: true });
      buf += text;
      if (isStream) {
        // SSE 按 \n 分行;最后一行可能不完整,留到下次或 flush
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        if (lines.length > 0) {
          const out = lines.map((l) => processSSELine(l, streamStripper)).join('\n') + '\n';
          ctrl.enqueue(enc.encode(out));
        }
      }
      // 非流式: 全部累到 flush 一次处理
    },
    flush(ctrl) {
      if (isStream) {
        // 处理残余最后一行(如果有)
        if (buf.length > 0) {
          ctrl.enqueue(enc.encode(processSSELine(buf, streamStripper)));
        }
      } else {
        ctrl.enqueue(enc.encode(processNonStreamBody(buf)));
      }
    },
  });
}
