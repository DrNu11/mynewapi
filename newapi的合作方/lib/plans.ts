// Mock 套餐数据 — 后续替换为从后端拉取
//
// 合作方明确:
//   - 充值有两条路线(双轨):
//     1) 直接充美金 → 余额自由配模型(pay-as-you-go)
//     2) 包时套餐(D/W/M)→ 不限量某模型
//   - 套餐展示 + 充值入口要在统一页面(不要分开),让鬼佬看着踏实

export type PlanPeriod = "day" | "week" | "month";

export type Plan = {
  id: string;
  modelId: string;       // 套餐绑定的模型(对应 lib/models.ts 的 id)
  modelName: string;     // 展示名
  period: PlanPeriod;
  priceUSD: number;      // 价格
  rphLimit: number;      // 每小时请求数上限
  highlight?: boolean;   // 推荐套餐
  features: string[];
};

export const PLANS: Plan[] = [
  // Sonnet — 包月畅用最受欢迎
  {
    id: "sonnet-day",
    modelId: "claude-sonnet-4-6",
    modelName: "Claude Sonnet 4.6",
    period: "day",
    priceUSD: 4.99,
    rphLimit: 60,
    features: ["24h unlimited chat", "60 req/h", "Standard support"],
  },
  {
    id: "sonnet-week",
    modelId: "claude-sonnet-4-6",
    modelName: "Claude Sonnet 4.6",
    period: "week",
    priceUSD: 19.99,
    rphLimit: 60,
    features: ["7-day unlimited chat", "60 req/h", "Standard support"],
  },
  {
    id: "sonnet-month",
    modelId: "claude-sonnet-4-6",
    modelName: "Claude Sonnet 4.6",
    period: "month",
    priceUSD: 49.99,
    rphLimit: 60,
    highlight: true,
    features: ["30-day unlimited chat", "60 req/h", "Priority support"],
  },

  // GPT-5.5
  {
    id: "gpt55-day",
    modelId: "gpt-5.5",
    modelName: "GPT-5.5",
    period: "day",
    priceUSD: 3.99,
    rphLimit: 200,
    features: ["24h unlimited chat", "200 req/h"],
  },
  {
    id: "gpt55-month",
    modelId: "gpt-5.5",
    modelName: "GPT-5.5",
    period: "month",
    priceUSD: 39.99,
    rphLimit: 200,
    highlight: true,
    features: ["30-day unlimited chat", "200 req/h", "Priority support"],
  },

  // DeepSeek
  {
    id: "deepseek-day",
    modelId: "deepseek-v4-pro",
    modelName: "DeepSeek V4 Pro",
    period: "day",
    priceUSD: 1.99,
    rphLimit: 500,
    features: ["24h unlimited chat", "500 req/h"],
  },
  {
    id: "deepseek-month",
    modelId: "deepseek-v4-pro",
    modelName: "DeepSeek V4 Pro",
    period: "month",
    priceUSD: 14.99,
    rphLimit: 500,
    features: ["30-day unlimited chat", "500 req/h"],
  },
];

// 充值面额(直接充美金,余额自由配)
export const TOPUP_AMOUNTS = [10, 20, 40, 100, 200, 500];
