import { describe, test, expect } from 'vitest';
import { normalizeMessages, normalizeResponsesInput } from './normalize-messages';

describe('normalizeMessages', () => {
  test('两个连续 system 消息合并成一个,放在 user 之前', () => {
    const input = [
      { role: 'system', content: 'sys1' },
      { role: 'system', content: 'sys2' },
      { role: 'user', content: 'hi' },
    ];
    const expected = [
      { role: 'system', content: 'sys1\n\nsys2' },
      { role: 'user', content: 'hi' },
    ];
    expect(normalizeMessages(input)).toEqual(expected);
  });

  test('0 个 system 时不强制添加 empty system,数组不变', () => {
    const input = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(normalizeMessages(input)).toEqual(input);
  });

  test('system 出现在 user 之后,应被移到首位', () => {
    const input = [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'You are helpful' },
    ];
    const expected = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hi' },
    ];
    expect(normalizeMessages(input)).toEqual(expected);
  });

  test('合并 system 时保留首个 system 的 name 字段', () => {
    const input = [
      { role: 'system', name: 'main', content: 'sys1' },
      { role: 'system', content: 'sys2' },
      { role: 'user', content: 'hi' },
    ];
    const result = normalizeMessages(input);
    expect(result[0]).toEqual({ role: 'system', name: 'main', content: 'sys1\n\nsys2' });
  });

  test('1 个 system 已经在首位的标准请求,内容不变', () => {
    const input = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'how are you' },
    ];
    expect(normalizeMessages(input)).toEqual(input);
  });

  test('content 是 array (OpenAI multipart),提取 text 后跟字符串 system 合并', () => {
    const input = [
      { role: 'system', content: [{ type: 'text', text: 'sys1 part' }] },
      { role: 'system', content: 'sys2' },
      { role: 'user', content: 'hi' },
    ];
    const expected = [
      { role: 'system', content: 'sys1 part\n\nsys2' },
      { role: 'user', content: 'hi' },
    ];
    expect(normalizeMessages(input)).toEqual(expected);
  });

  test('content 是 array 且用 OpenAI Responses 风格 input_text type,也能提取', () => {
    // 兼容 /v1/responses 路径下 chat completions 反向转换的 content 块
    const input = [
      { role: 'system', content: [{ type: 'input_text', text: 'codex sys1' }] },
      { role: 'system', content: 'sys2' },
      { role: 'user', content: 'hi' },
    ];
    const expected = [
      { role: 'system', content: 'codex sys1\n\nsys2' },
      { role: 'user', content: 'hi' },
    ];
    expect(normalizeMessages(input)).toEqual(expected);
  });
});

describe('normalizeResponsesInput', () => {
  test('input 是 string 时原样返回（无 role 概念）', () => {
    expect(normalizeResponsesInput('Hello world')).toBe('Hello world');
  });

  test('input 是空字符串时原样返回', () => {
    expect(normalizeResponsesInput('')).toBe('');
  });

  test('input 为 null/undefined 时原样返回', () => {
    expect(normalizeResponsesInput(null)).toBe(null);
    expect(normalizeResponsesInput(undefined)).toBe(undefined);
  });

  test('input 是非数组对象时原样返回（兜底）', () => {
    const obj = { foo: 'bar' };
    expect(normalizeResponsesInput(obj)).toBe(obj);
  });

  test('input 是 InputItem[] 且含两个 system,合并到首位', () => {
    const input = [
      { role: 'system', content: 'sys1' },
      { role: 'system', content: 'sys2' },
      { role: 'user', content: 'hi' },
    ];
    const expected = [
      { role: 'system', content: 'sys1\n\nsys2' },
      { role: 'user', content: 'hi' },
    ];
    expect(normalizeResponsesInput(input)).toEqual(expected);
  });

  test('input 是 InputItem[] 且 system 在 user 之后,应被移到首位', () => {
    const input = [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'You are helpful' },
    ];
    const expected = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hi' },
    ];
    expect(normalizeResponsesInput(input)).toEqual(expected);
  });

  test('input 的 system content 用 input_text multipart 也能正确合并', () => {
    // codex CLI 0.130.0 实际发出的形态:content 是 [{type:"input_text",text:"..."}]
    const input = [
      { role: 'system', content: [{ type: 'input_text', text: 'codex sys' }] },
      { role: 'system', content: [{ type: 'input_text', text: 'extra sys' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ];
    const result = normalizeResponsesInput(input) as Array<{ role: string; content: unknown }>;
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'system', content: 'codex sys\n\nextra sys' });
    // 非 system 元素保持原样(不修改 user/assistant 的 content)
    expect(result[1]).toEqual({ role: 'user', content: [{ type: 'input_text', text: 'hi' }] });
  });

  test('input 无 system 元素时数组原样返回（reference equality 体现零拷贝）', () => {
    const input = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(normalizeResponsesInput(input)).toBe(input);
  });

  test('input 含 developer role 应转 system 并合并（codex 风格：避免 MiniMax 双 system 2013）', () => {
    // 根因：NewAPI 反向转换 /v1/responses → chat completions 时,developer role
    // 会被转成 system,如果同时还有顶层 instructions 也会转 system,导致两个 system。
    // nassa-cards 层提前合并: developer → system + 多 system 合并 → 单 system。
    const input = [
      { role: 'developer', content: 'Be concise.' },
      { role: 'user', content: 'hi' },
    ];
    const expected = [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'hi' },
    ];
    expect(normalizeResponsesInput(input)).toEqual(expected);
  });

  test('developer + system 同时出现,合并成单 system', () => {
    const input = [
      { role: 'system', content: 'You are codex.' },
      { role: 'developer', content: 'Be concise.' },
      { role: 'user', content: 'hi' },
    ];
    const expected = [
      { role: 'system', content: 'You are codex.\n\nBe concise.' },
      { role: 'user', content: 'hi' },
    ];
    expect(normalizeResponsesInput(input)).toEqual(expected);
  });

  test('options.prependSystem 注入顶层 instructions 到 input 开头', () => {
    const input = [
      { role: 'user', content: 'hi' },
    ];
    const expected = [
      { role: 'system', content: 'You are codex.' },
      { role: 'user', content: 'hi' },
    ];
    expect(normalizeResponsesInput(input, { prependSystem: 'You are codex.' })).toEqual(expected);
  });

  test('codex 真实场景：instructions + developer + user → 单 system', () => {
    // 这是 codex CLI 0.130.0 触发 MiniMax 2013 的真实组合
    const input = [
      { role: 'developer', content: [{ type: 'input_text', text: 'Be concise.' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'echo 1' }] },
    ];
    const result = normalizeResponsesInput(input, { prependSystem: 'You are codex.' }) as Array<{ role: string; content: unknown }>;
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'system', content: 'You are codex.\n\nBe concise.' });
    expect(result[1]).toEqual({ role: 'user', content: [{ type: 'input_text', text: 'echo 1' }] });
  });

  test('prependSystem 与 input 已有 system 都存在,合并成单 system 在最前', () => {
    const input = [
      { role: 'system', content: 'Old system.' },
      { role: 'user', content: 'hi' },
    ];
    const result = normalizeResponsesInput(input, { prependSystem: 'New instructions.' }) as Array<{ role: string; content: string }>;
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'system', content: 'New instructions.\n\nOld system.' });
    expect(result[1]).toEqual({ role: 'user', content: 'hi' });
  });

  test('prependSystem 是空字符串/undefined 不注入', () => {
    const input = [{ role: 'user', content: 'hi' }];
    expect(normalizeResponsesInput(input, { prependSystem: '' })).toBe(input);
    expect(normalizeResponsesInput(input, { prependSystem: undefined })).toBe(input);
    expect(normalizeResponsesInput(input, {})).toBe(input);
  });

  test('input 是 string 但有 prependSystem,转成 [system, user]', () => {
    const result = normalizeResponsesInput('hello', { prependSystem: 'You are codex.' }) as Array<{ role: string; content: string }>;
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'system', content: 'You are codex.' });
    expect(result[1]).toEqual({ role: 'user', content: 'hello' });
  });

  test('input 的非 message 元素（如 tool_call output）保持原样', () => {
    // Responses API InputItem 可以是 { type: "function_call_output", call_id, output }
    const input = [
      { role: 'system', content: 'sys1' },
      { role: 'system', content: 'sys2' },
      { type: 'function_call_output', call_id: 'abc', output: 'result' },
      { role: 'user', content: 'hi' },
    ];
    const result = normalizeResponsesInput(input) as Array<Record<string, unknown>>;
    expect(result[0]).toEqual({ role: 'system', content: 'sys1\n\nsys2' });
    expect(result).toContainEqual({ type: 'function_call_output', call_id: 'abc', output: 'result' });
    expect(result).toContainEqual({ role: 'user', content: 'hi' });
    expect(result).toHaveLength(3);
  });
});
