// Mock 模型数据 — 后续替换为从 NewAPI `/api/models` 拉取
//
// 合作方明确范围:
//   - 收费 3 个:Sonnet (Claude) / GPT-5.5 (OpenAI) / DeepSeek
//   - 免费 4-5 个:接国内大厂接口转过来(Qwen / Llama / GLM / Yi 等)
//
// price 单位:USD per 1M tokens(input / output)

export type ModelTier = "free" | "paid";

export type ModelInfo = {
  id: string;            // 调用名,如 gpt-5.5
  name: string;          // 展示名,如 GPT-5.5
  provider: string;      // Anthropic / OpenAI / DeepSeek / Alibaba ...
  tier: ModelTier;
  contextK: number;      // 上下文长度(K tokens)
  priceIn?: number;      // input  $/1M (paid 才有)
  priceOut?: number;     // output $/1M
  capability: string[];  // ["chat","reasoning","vision","code"]
  description: string;
  badge?: string;        // "Pro" / "Plus" / "New"
};

export const MODELS: ModelInfo[] = [
  // ===== Paid (3) =====
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    tier: "paid",
    contextK: 200,
    priceIn: 3,
    priceOut: 15,
    capability: ["chat", "reasoning", "vision", "code"],
    description: "Anthropic's flagship balanced model. Best for production agents and long context.",
    badge: "Pro",
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "OpenAI",
    tier: "paid",
    contextK: 256,
    priceIn: 2.5,
    priceOut: 10,
    capability: ["chat", "reasoning", "vision", "code"],
    description: "OpenAI's latest frontier model. Strong general intelligence and tool-use.",
    badge: "Plus",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    tier: "paid",
    contextK: 128,
    priceIn: 0.27,
    priceOut: 1.1,
    capability: ["chat", "reasoning", "code"],
    description: "Best price-performance ratio. Strong at code and Chinese.",
  },

  // ===== Free (5) =====
  {
    id: "qwen3-235b-a22b",
    name: "Qwen3 235B-A22B",
    provider: "Alibaba",
    tier: "free",
    contextK: 128,
    capability: ["chat", "reasoning", "code"],
    description: "Alibaba's flagship MoE model. Free tier with rate limits.",
  },
  {
    id: "llama-3.3-70b",
    name: "Llama 3.3 70B",
    provider: "Meta",
    tier: "free",
    contextK: 128,
    capability: ["chat", "code"],
    description: "Meta's open-weight model. Free for general use.",
  },
  {
    id: "glm-4.6",
    name: "GLM-4.6",
    provider: "Zhipu AI",
    tier: "free",
    contextK: 128,
    capability: ["chat", "reasoning"],
    description: "Zhipu's flagship model. Free tier proxied via mainland endpoints.",
  },
  {
    id: "yi-lightning",
    name: "Yi-Lightning",
    provider: "01.AI",
    tier: "free",
    contextK: 16,
    capability: ["chat"],
    description: "01.AI's fast model. Free for chat workloads.",
  },
  {
    id: "minimax-m2",
    name: "MiniMax M2",
    provider: "MiniMax",
    tier: "free",
    contextK: 200,
    capability: ["chat", "reasoning"],
    description: "MiniMax reasoning model. Free with daily quota.",
  },
];

export function getPaidModels() {
  return MODELS.filter((m) => m.tier === "paid");
}

export function getFreeModels() {
  return MODELS.filter((m) => m.tier === "free");
}
