export type ModelCategory =
  | 'GPT'
  | 'Codex'
  | 'Claude'
  | 'Gemini'
  | 'DeepSeek'
  | 'GLM'
  | 'Grok'
  | 'MiMo';

export interface ModelDef {
  id: string;
  category: ModelCategory;
  note?: string;
}

/**
 * Nassa API 实际可用模型清单
 * 数据来源: GET /v1/models (而非后台 UI)
 * 拉取时间: 2026-05
 *
 * API 总数: 38 个
 * 健康检查覆盖: 23 个 (chat/codex,可用 /v1/chat/completions 测试)
 * 已排除: 见文件底部 (含 8 个上游 502 / 已废弃的旧版 GPT-5/Codex)
 *
 * 增删模型: 直接编辑下面的数组，UI 热更新
 * 重新同步: 跑   bash scripts/sync-models.sh   (TODO)
 */
export const MODELS: ModelDef[] = [
  // ============ GPT 家族 (chat) ============
  // 已删除（上游不存在,持续返回 502）: gpt-5, gpt-5.1
  { id: 'gpt-5.2', category: 'GPT' },
  { id: 'gpt-5.4', category: 'GPT' },
  { id: 'gpt-5.4-mini', category: 'GPT', note: 'mini' },
  { id: 'gpt-5.5', category: 'GPT' },

  // ============ Codex (编码) ============
  // 已删除（上游不存在,持续返回 502）:
  //   gpt-5-codex, gpt-5-codex-mini,
  //   gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini,
  //   gpt-5.2-codex
  { id: 'gpt-5.3-codex', category: 'Codex' },
  { id: 'gpt-5.3-codex-spark', category: 'Codex', note: 'spark' },

  // ============ Claude ============
  { id: 'claude-sonnet-4-6', category: 'Claude' },
  { id: 'claude-opus-4-7', category: 'Claude' },

  // ============ Gemini ============
  { id: 'gemini-2.5-flash', category: 'Gemini' },
  { id: 'gemini-2.5-flash-lite', category: 'Gemini' },
  { id: 'gemini-2.5-pro', category: 'Gemini' },
  { id: 'gemini-3-flash-preview', category: 'Gemini', note: 'preview' },
  { id: 'gemini-3-pro-preview', category: 'Gemini', note: 'preview' },
  { id: 'gemini-3.1-flash-lite-preview', category: 'Gemini', note: 'preview' },
  { id: 'gemini-3.1-pro-preview', category: 'Gemini', note: 'preview' },

  // ============ DeepSeek ============
  { id: 'deepseek-v4-flash', category: 'DeepSeek', note: 'flash' },
  { id: 'deepseek-v4-pro', category: 'DeepSeek' },

  // ============ GLM ============
  { id: 'glm-5.1', category: 'GLM' },

  // ============ Grok ============
  { id: 'grok-4.20-0309-non-reasoning', category: 'Grok', note: 'non-reasoning' },

  // ============ MiMo (chat 部分,TTS 变体已排除) ============
  { id: 'mimo-v2-omni', category: 'MiMo', note: 'omni' },
  { id: 'mimo-v2-pro', category: 'MiMo' },
  { id: 'mimo-v2.5', category: 'MiMo' },
  { id: 'mimo-v2.5-pro', category: 'MiMo' },

  // ====================================================================
  // 已排除的模型（不参与 chat/completions 健康检查）:
  //
  //   用户要求跳过:
  //     - MiniMax-M2.7
  //
  //   图像模型 (要走 /v1/images/generations):
  //     - gpt-image-2
  //     - grok-imagine-image-lite
  //
  //   TTS 模型 (要走 /v1/audio/speech):
  //     - mimo-v2-tts
  //     - mimo-v2.5-tts
  //     - mimo-v2.5-tts-voiceclone
  //     - mimo-v2.5-tts-voicedesign
  //
  //   要重启用 MiniMax: 把 'MiniMax' 加回 ModelCategory 类型,然后:
  //     { id: 'MiniMax-M2.7', category: 'MiniMax' },
  // ====================================================================
];
