import crypto from 'node:crypto';
import { CATEGORIES, type Category } from './categories';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符 I,O,0,1

function randomSegment(len = 4): string {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

/** 生成单个卡密,格式: <PREFIX>-XXXX-XXXX-XXXX (DE / GP 前缀按 category 分) */
export function generateCode(category: Category): string {
  const p = CATEGORIES[category].prefix;
  return `${p}-${randomSegment()}-${randomSegment()}-${randomSegment()}`;
}

/** 生成 N 个唯一卡密 */
export function generateCodes(category: Category, count: number): string[] {
  const set = new Set<string>();
  while (set.size < count) set.add(generateCode(category));
  return Array.from(set);
}

/** 校验卡密格式;前缀从 CATEGORIES 动态派生 + 兼容历史 NASSA- */
const PREFIX_PATTERN = [
  ...Object.values(CATEGORIES).map((c) => c.prefix),
  'NASSA',
].join('|');
const CODE_REGEX = new RegExp(
  `^(${PREFIX_PATTERN})-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$`
);
export function isValidCodeFormat(code: string): boolean {
  return CODE_REGEX.test(code);
}

/** 标准化(去空格、转大写) */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}
