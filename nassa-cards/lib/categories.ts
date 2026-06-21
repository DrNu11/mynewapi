/**
 * 卡密分类:DeepSeek / GPT / Claude 套餐。
 * 一张卡密只能用对应分类的模型,这样老板可以分别定价。
 * 加新类只改这一个文件:补一个 prefix + 模型清单 + 颜色,UI/校验自动跟随。
 */

export type Category = 'deepseek' | 'gpt' | 'claude';

export interface CategoryMeta {
  id: Category;
  /** 卡密前缀,2 个大写字母,需要全局唯一,且不能跟历史 NASSA 冲突 */
  prefix: 'DE' | 'GP' | 'CL';
  label: string;
  shortLabel: string;
  description: string;
  modelsEnv: string;
  defaultModels: string;
  /** 是否在结果页展示 Codex CLI 一键配置(只有 gpt 类有 codex 模型) */
  hasCodex: boolean;
  /** Tailwind 徽章配色 */
  badgeClass: string;
  /** 每张卡每小时请求数上限(0 = 不限);防客户开多进程恶意并发 */
  defaultRPH: number;
  /**
   * 给客户展示的 base URL 后缀。
   * - OpenAI 兼容客户端(Cherry Studio / Codex / Cursor 等):需要 '/v1' 后缀,SDK 会拼成 '<base>/chat/completions'
   * - Anthropic Claude Code CLI:不要 '/v1' 后缀,CLI 会自己拼 '<base>/v1/messages'
   *   填了 '/v1' 反而会变成 '<base>/v1/v1/messages' 404
   */
  baseUrlSuffix: '/v1' | '';
}

export const CATEGORIES: Record<Category, CategoryMeta> = {
  deepseek: {
    id: 'deepseek',
    prefix: 'DE',
    label: 'DeepSeek 套餐',
    shortLabel: 'DeepSeek',
    description: '畅用 DeepSeek V4 全系列(Flash + Pro)',
    modelsEnv: 'MODELS_DEEPSEEK',
    defaultModels: 'deepseek-v4-flash,deepseek-v4-pro',
    hasCodex: false,
    badgeClass: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
    defaultRPH: 500,
    baseUrlSuffix: '/v1',
  },
  gpt: {
    id: 'gpt',
    prefix: 'GP',
    label: 'GPT 套餐',
    shortLabel: 'GPT',
    description: '畅用 GPT-5 全系列 + Codex + Image(适配 Claude Code / Codex CLI)',
    modelsEnv: 'MODELS_GPT',
    // 与 NewAPI 后台 default group 实际可用渠道对齐(7 个 chat + 1 image)
    // gpt-oss-120b-medium 在 default group 未配置渠道(2026-05-08 实测 503),已下架
    defaultModels:
      'gpt-5.2,gpt-5.4,gpt-5.4-mini,gpt-5.5,gpt-5.3-codex,gpt-5.3-codex-spark,gpt-image-2',
    hasCodex: true,
    badgeClass: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
    defaultRPH: 400,
    baseUrlSuffix: '/v1',
  },
  claude: {
    id: 'claude',
    prefix: 'CL',
    label: 'Claude 套餐',
    shortLabel: 'Claude',
    description: '畅用 Anthropic Claude(Opus 4.7/4.8 + Sonnet 4.6)',
    modelsEnv: 'MODELS_CLAUDE',
    // 与 NewAPI 后台 default group 渠道实际可用的 Claude 模型对齐
    defaultModels: 'claude-opus-4-7,claude-sonnet-4-6,claude-opus-4-8',
    hasCodex: false,
    badgeClass: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
    defaultRPH: 300,
    // Claude Code CLI 会自己拼 /v1/messages,这里给空串;客户复制粘贴到 ANTHROPIC_BASE_URL 直接用
    baseUrlSuffix: '',
  },
};

export const CATEGORY_LIST: CategoryMeta[] = [
  CATEGORIES.deepseek,
  CATEGORIES.gpt,
  CATEGORIES.claude,
];

/**
 * 模型显示名别名 — 某些模型在上游渠道做了映射(如 gpt-5.5 → gpt-5.4-mini),
 * 但给客户展示和统计时统一归入一个对外名称,让卡密看板不暴露内部渠道细节。
 *
 * key = 客户可能请求的任意内部模型名
 * val = 在 cards 统计/展示中统一显示的模型名
 */
export const MODEL_DISPLAY_ALIASES: Record<string, string> = {
  'gpt-5.4': 'gpt-5.5',
  'gpt-5.4-mini': 'gpt-5.5',
  'gpt-5.2': 'gpt-5.5',
  'GPT-5.4': 'gpt-5.5',
  'GPT-5.4 Mini': 'gpt-5.5',
};

/** 解析模型显示名:有别名走别名,否则原样返回 */
export function displayModelName(requestedModel: string): string {
  return MODEL_DISPLAY_ALIASES[requestedModel] ?? requestedModel;
}

export function isCategory(v: unknown): v is Category {
  return v === 'deepseek' || v === 'gpt' || v === 'claude';
}

/** 从卡密前缀推断 category;NASSA-* 老卡密返回 null */
export function categoryFromCode(code: string): Category | null {
  for (const meta of CATEGORY_LIST) {
    if (code.startsWith(`${meta.prefix}-`)) return meta.id;
  }
  return null;
}

/** 取该 category 的模型列表(env 优先,否则用默认) */
export function modelsForCategory(c: Category): string[] {
  const meta = CATEGORIES[c];
  const raw = process.env[meta.modelsEnv] || meta.defaultModels;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 老 NASSA 卡密兼容:用 ALLOWED_MODELS,否则合并所有 category 的模型 */
export function legacyModels(): string[] {
  const raw = process.env.ALLOWED_MODELS;
  if (raw && raw.trim()) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [...modelsForCategory('deepseek'), ...modelsForCategory('gpt')];
}
