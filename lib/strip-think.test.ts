import { describe, test, expect } from 'vitest';
import { ThinkStripper, processSSELine, processNonStreamBody } from './strip-think';

describe('ThinkStripper', () => {
  test('无 <think> 标签:文本原样返回', () => {
    const s = new ThinkStripper();
    expect(s.feed('Hello world')).toBe('Hello world');
    expect(s.flush()).toBe('');
  });

  test('单个完整 <think>...</think> 在 chunk 内:剥离', () => {
    const s = new ThinkStripper();
    expect(s.feed('Before<think>reasoning here</think>After')).toBe('BeforeAfter');
    expect(s.flush()).toBe('');
  });

  test('完整 <think>...</think> 后跟换行:剥离 think 保留答案', () => {
    const s = new ThinkStripper();
    expect(s.feed('<think>\nThe answer is 2.\n</think>\n\n2')).toBe('\n\n2');
    expect(s.flush()).toBe('');
  });

  test('<think> 跨 chunk 起始边界:正确剥离', () => {
    const s = new ThinkStripper();
    // chunk 1 末尾是 '<thi'(partial marker)
    expect(s.feed('Hello <thi')).toBe('Hello ');
    // chunk 2 接 'nk>...</think>world'
    expect(s.feed('nk>internal</think>world')).toBe('world');
    expect(s.flush()).toBe('');
  });

  test('</think> 跨 chunk 结束边界:正确剥离', () => {
    const s = new ThinkStripper();
    expect(s.feed('text<think>think part 1')).toBe('text');
    expect(s.feed(' part 2</thi')).toBe('');
    expect(s.feed('nk>visible')).toBe('visible');
    expect(s.flush()).toBe('');
  });

  test('多个 <think>...</think>:全部剥离', () => {
    const s = new ThinkStripper();
    expect(s.feed('A<think>x</think>B<think>y</think>C')).toBe('ABC');
    expect(s.flush()).toBe('');
  });

  test('只有 <think> 没 </think>:think 内容被吃掉,flush 不输出', () => {
    const s = new ThinkStripper();
    expect(s.feed('visible<think>incomplete thinking')).toBe('visible');
    expect(s.flush()).toBe('');
  });

  test('partial marker 缓冲不输出,直到下一个 chunk 确定不是 marker', () => {
    const s = new ThinkStripper();
    // 末尾 '<' 可能是 marker 起始,缓冲
    expect(s.feed('Hello <')).toBe('Hello ');
    // 下个 chunk 是 'world',表明 < 后跟 w,不是 think marker,应输出 '<world'
    expect(s.feed('world')).toBe('<world');
    expect(s.flush()).toBe('');
  });

  test('partial <th 缓冲后 flush:输出缓冲内容(因为没真的开始 think)', () => {
    const s = new ThinkStripper();
    expect(s.feed('answer<th')).toBe('answer');
    expect(s.flush()).toBe('<th');
  });

  test('think 状态下 flush:不输出 think 内容', () => {
    const s = new ThinkStripper();
    expect(s.feed('text<think>unfinished')).toBe('text');
    expect(s.flush()).toBe('');
  });

  test('真实场景:MiniMax 完整响应', () => {
    const s = new ThinkStripper();
    const input = '<think>\nThe user is asking a simple math question: 1+1. This is straightforward - the answer is 2.\n</think>\n\n2';
    expect(s.feed(input)).toBe('\n\n2');
    expect(s.flush()).toBe('');
  });

  test('真实场景:MiniMax 流式分片', () => {
    const s = new ThinkStripper();
    // 模拟 SSE delta 分片
    let out = '';
    out += s.feed('<think>');
    out += s.feed('\nThe user');
    out += s.feed(' is asking');
    out += s.feed('</think>');
    out += s.feed('\n\n');
    out += s.feed('2');
    out += s.flush();
    expect(out).toBe('\n\n2');
  });

  test('空字符串 feed:返回空,状态不变', () => {
    const s = new ThinkStripper();
    expect(s.feed('')).toBe('');
    expect(s.feed('hello')).toBe('hello');
    expect(s.feed('')).toBe('');
    expect(s.flush()).toBe('');
  });

  test('紧邻的 think 块:无中间字符也正确处理', () => {
    const s = new ThinkStripper();
    expect(s.feed('<think>a</think><think>b</think>')).toBe('');
    expect(s.flush()).toBe('');
  });
});

describe('processSSELine', () => {
  test('非 data: 行原样返回(空行/event:/comment)', () => {
    const s = new ThinkStripper();
    expect(processSSELine('', s)).toBe('');
    expect(processSSELine('event: response.created', s)).toBe('event: response.created');
    expect(processSSELine(': comment', s)).toBe(': comment');
  });

  test('data: [DONE] 原样', () => {
    const s = new ThinkStripper();
    expect(processSSELine('data: [DONE]', s)).toBe('data: [DONE]');
  });

  test('chat completions delta.content 含 <think>...</think>:剥离', () => {
    const s = new ThinkStripper();
    const line = 'data: {"choices":[{"delta":{"content":"<think>thinking</think>answer"}}]}';
    const result = processSSELine(line, s);
    expect(result).toBe('data: {"choices":[{"delta":{"content":"answer"}}]}');
  });

  test('chat completions delta.content 不含 <think>:不变', () => {
    const s = new ThinkStripper();
    const line = 'data: {"choices":[{"delta":{"content":"hello"}}]}';
    expect(processSSELine(line, s)).toBe(line);
  });

  test('responses API output_text.delta 含 <think>:剥离', () => {
    const s = new ThinkStripper();
    const line = 'data: {"type":"response.output_text.delta","delta":"<think>x</think>y"}';
    const result = processSSELine(line, s);
    expect(result).toBe('data: {"type":"response.output_text.delta","delta":"y"}');
  });

  test('跨 SSE event 的 <think>:状态在 stripper 中保持', () => {
    const s = new ThinkStripper();
    // event 1: 开 think
    const l1 = processSSELine('data: {"choices":[{"delta":{"content":"<think>part1"}}]}', s);
    expect(l1).toBe('data: {"choices":[{"delta":{"content":""}}]}');
    // event 2: think 内部
    const l2 = processSSELine('data: {"choices":[{"delta":{"content":"part2"}}]}', s);
    expect(l2).toBe('data: {"choices":[{"delta":{"content":""}}]}');
    // event 3: 关 think + 答案
    const l3 = processSSELine('data: {"choices":[{"delta":{"content":"</think>2"}}]}', s);
    expect(l3).toBe('data: {"choices":[{"delta":{"content":"2"}}]}');
  });

  test('无 delta.content 字段(如纯 role event):不变', () => {
    const s = new ThinkStripper();
    const line = 'data: {"choices":[{"delta":{"role":"assistant"}}]}';
    expect(processSSELine(line, s)).toBe(line);
  });

  test('JSON parse 失败:原样返回', () => {
    const s = new ThinkStripper();
    expect(processSSELine('data: {not json}', s)).toBe('data: {not json}');
  });

  test('Anthropic content_block_delta 含 <think>:剥离', () => {
    const s = new ThinkStripper();
    const line = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"<think>r</think>answer"}}';
    const result = processSSELine(line, s);
    expect(result).toBe('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}');
  });

  test('Anthropic 流式跨 event 的 <think>:状态保持', () => {
    const s = new ThinkStripper();
    const l1 = processSSELine('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"<think>start"}}', s);
    expect(l1).toBe('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}');
    const l2 = processSSELine('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"</think>2"}}', s);
    expect(l2).toBe('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"2"}}');
  });

  test('Anthropic message_start/message_stop 等非 delta 事件:不变', () => {
    const s = new ThinkStripper();
    const line = 'data: {"type":"message_start","message":{"role":"assistant","content":[]}}';
    expect(processSSELine(line, s)).toBe(line);
  });
});

describe('processNonStreamBody', () => {
  test('chat completions message.content 含 <think>:剥离', () => {
    const body = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '<think>x</think>answer' } }],
    });
    const result = processNonStreamBody(body);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.content).toBe('answer');
  });

  test('chat completions 多 choice:每个独立剥离', () => {
    const body = JSON.stringify({
      choices: [
        { message: { content: '<think>a</think>A' } },
        { message: { content: '<think>b</think>B' } },
      ],
    });
    const result = processNonStreamBody(body);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.content).toBe('A');
    expect(parsed.choices[1].message.content).toBe('B');
  });

  test('responses output 含 output_text:剥离', () => {
    const body = JSON.stringify({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: '<think>r</think>answer' }],
        },
      ],
    });
    const result = processNonStreamBody(body);
    const parsed = JSON.parse(result);
    expect(parsed.output[0].content[0].text).toBe('answer');
  });

  test('responses output 含 function_call 等非 text 类型:不动', () => {
    const body = JSON.stringify({
      output: [
        {
          type: 'function_call',
          name: 'shell',
          arguments: { cmd: ['echo', '1'] },
        },
      ],
    });
    const result = processNonStreamBody(body);
    expect(JSON.parse(result)).toEqual(JSON.parse(body));
  });

  test('内容无 <think>:返回原 body 不变(零拷贝)', () => {
    const body = JSON.stringify({
      choices: [{ message: { content: 'plain answer' } }],
    });
    expect(processNonStreamBody(body)).toBe(body);
  });

  test('非 JSON body:原样返回', () => {
    expect(processNonStreamBody('not json')).toBe('not json');
  });

  test('Anthropic Messages 顶层 content[]:剥离 text 中的 <think>', () => {
    // 真实场景: claude code 用 /v1/messages,响应是 type=message,content[]=text blocks
    const body = JSON.stringify({
      id: 'msg_abc',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: '<think>用户问 X</think>\n\n我是 DeepSeek-V4。' },
      ],
      model: 'deepseek-v4-pro',
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const result = processNonStreamBody(body);
    const parsed = JSON.parse(result);
    expect(parsed.content[0].text).toBe('\n\n我是 DeepSeek-V4。');
  });

  test('Anthropic content[] 含 tool_use 类型:不动', () => {
    const body = JSON.stringify({
      type: 'message',
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'shell', input: { cmd: 'ls' } },
      ],
    });
    const result = processNonStreamBody(body);
    expect(JSON.parse(result)).toEqual(JSON.parse(body));
  });

  test('Anthropic 多 content block:每个独立剥离', () => {
    const body = JSON.stringify({
      type: 'message',
      content: [
        { type: 'text', text: '<think>a</think>A' },
        { type: 'text', text: '<think>b</think>B' },
      ],
    });
    const result = processNonStreamBody(body);
    const parsed = JSON.parse(result);
    expect(parsed.content[0].text).toBe('A');
    expect(parsed.content[1].text).toBe('B');
  });
});
