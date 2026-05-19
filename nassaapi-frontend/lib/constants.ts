/**
 * 站点全局配置 - 改这里就能改全站的品牌信息和外链
 */
export const SITE = {
  name: "nassaapi",
  brand: "NassaAPI",
  domain: "nassaapi.xyz",
  tagline: "中国与世界 AI 模型的高性能中转网关",
  description:
    "聚合 OpenAI、Claude、Gemini、DeepSeek、Qwen、智谱等全球主流 AI 模型，统一 OpenAI 兼容协议，按用量计费 / 月度订阅自由切换。",
  apiBaseUrl: "https://api.nassaapi.xyz",
  consoleUrl: "https://api.nassaapi.xyz/console",
  registerUrl: "https://api.nassaapi.xyz/register",
  loginUrl: "https://api.nassaapi.xyz/login",
  docsUrl: "https://api.nassaapi.xyz/docs",
  email: "support@nassaapi.xyz",
  // AGPL 合规：必须保留对上游项目的署名
  poweredBy: {
    label: "Powered by New API",
    href: "https://github.com/QuantumNous/new-api",
  },
  // §13: 修改后的源码必须对客户公开（请把 fork 仓库填到这里）
  modifiedSourceCode: {
    label: "Modified Source Code",
    href: "https://github.com/your-username/new-api-fork", // TODO: 替换为你 fork 后的仓库地址
  },
};

export const NAV_LINKS = [
  { label: "首页", href: "/" },
  { label: "模型", href: "/#models" },
  { label: "定价", href: "/pricing" },
  { label: "文档", href: SITE.docsUrl, external: true },
];

/** 主页用 Trust badges */
export const TRUST_BADGES = [
  "兼容 OpenAI 协议",
  "99.9% 可用性",
  "毫秒级响应",
  "中文支持",
];

/** 主页特性卡片 */
export const FEATURES = [
  {
    icon: "Zap",
    title: "极速响应",
    desc: "全球节点加速，平均首字延迟 < 800ms。流式传输零延迟，长对话不卡顿。",
  },
  {
    icon: "Shield",
    title: "稳定可靠",
    desc: "多通道自动切换，单一上游故障不影响服务。99.9% 月度可用率。",
  },
  {
    icon: "Wallet",
    title: "灵活计费",
    desc: "按 token 用多少付多少，或选月度订阅锁定用量成本，企业可走批量合同。",
  },
  {
    icon: "Plug",
    title: "无缝接入",
    desc: "一个 API Key 打通全部模型，OpenAI 兼容接口，已有代码 5 分钟切换。",
  },
  {
    icon: "Users",
    title: "团队协作",
    desc: "支持子账号、用量统计、权限分组。开发团队、企业部署一键搞定。",
  },
  {
    icon: "Globe",
    title: "全球可达",
    desc: "中国大陆免翻墙直连，海外节点低延迟，自动 fallback 选最快路径。",
  },
];

/** 主页模型展示 */
export const MODELS = [
  {
    family: "OpenAI",
    items: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-preview"],
    color: "from-emerald-500/20 to-emerald-500/0",
    accent: "text-emerald-400",
  },
  {
    family: "Anthropic",
    items: ["claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-opus"],
    color: "from-orange-500/20 to-orange-500/0",
    accent: "text-orange-400",
  },
  {
    family: "Google",
    items: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
    color: "from-sky-500/20 to-sky-500/0",
    accent: "text-sky-400",
  },
  {
    family: "DeepSeek",
    items: ["deepseek-v3", "deepseek-r1", "deepseek-coder"],
    color: "from-violet-500/20 to-violet-500/0",
    accent: "text-violet-400",
  },
  {
    family: "Alibaba",
    items: ["qwen-max", "qwen-plus", "qwen-turbo"],
    color: "from-rose-500/20 to-rose-500/0",
    accent: "text-rose-400",
  },
  {
    family: "Moonshot",
    items: ["kimi-k1.5", "moonshot-v1-128k", "moonshot-v1-32k"],
    color: "from-yellow-500/20 to-yellow-500/0",
    accent: "text-yellow-400",
  },
];

/** 订阅套餐 */
export const PRICING_TIERS = [
  {
    id: "trial",
    name: "Trial",
    description: "新用户尝鲜，14 天有效",
    price: "$1.99",
    priceUnit: "/月",
    quotaLabel: "$3 等值额度",
    features: [
      "$3 等值 API 额度",
      "所有基础模型访问",
      "标准 RPM 限制",
      "邮件支持",
      "14 天有效",
    ],
    cta: "开始体验",
    highlight: false,
  },
  {
    id: "standard",
    name: "Standard",
    description: "适合日常使用、个人开发者",
    price: "$4.99",
    priceUnit: "/月",
    quotaLabel: "$8 等值额度",
    features: [
      "$8 等值 API 额度",
      "所有模型访问",
      "更高 RPM 限制",
      "优先技术支持",
      "用量明细导出",
    ],
    cta: "选择 Standard",
    highlight: true,
    badge: "最受欢迎",
  },
  {
    id: "pro",
    name: "Pro",
    description: "重度用户、AI 应用开发者",
    price: "$14.99",
    priceUnit: "/月",
    quotaLabel: "$30 等值额度",
    features: [
      "$30 等值 API 额度",
      "GPT-4 / Claude 优先通道",
      "高 RPM + 并发额度",
      "1 对 1 对接群",
      "API 用量分析仪表板",
    ],
    cta: "选择 Pro",
    highlight: false,
  },
  {
    id: "team",
    name: "Team",
    description: "团队协作、初创企业",
    price: "$49.99",
    priceUnit: "/月",
    quotaLabel: "$120 等值额度",
    features: [
      "$120 等值 API 额度",
      "5 个子账号",
      "团队用量统计",
      "专属客户经理",
      "可签合同 / 开发票",
    ],
    cta: "联系销售",
    highlight: false,
  },
];

/** FAQ 列表 */
export const FAQS = [
  {
    q: "你们的服务和直接调用 OpenAI / Anthropic 相比有什么优势？",
    a: "三点：1) 中国大陆免翻墙直连，无需 VPN；2) 一个 API Key 同时调 OpenAI、Claude、Gemini、DeepSeek 等所有主流模型，无需开多个海外账号；3) 用量集中计费，可订阅可按量，比单独订阅多个会员便宜。",
  },
  {
    q: "API 是否兼容 OpenAI 官方格式？",
    a: "完全兼容 OpenAI Chat Completions 格式。你只需要把 base_url 从 https://api.openai.com 改成 https://api.nassaapi.xyz/v1，API Key 换成我们的，已有的 OpenAI SDK 代码无需改动即可使用。",
  },
  {
    q: "支持流式响应（streaming）吗？",
    a: "全模型支持 SSE 流式输出，与 OpenAI 官方表现一致。包括对 stream_options、tool calls、function calling 的完整支持。",
  },
  {
    q: "数据是否会被记录或用于训练？",
    a: "我们仅记录用量统计（请求时间、模型、token 数）用于计费，不存储请求和响应的具体内容，不会用于任何模型训练。",
  },
  {
    q: "支持哪些支付方式？",
    a: "支持 Stripe / Creem 信用卡、USDT、支付宝、微信。企业用户可走对公转账并开具增值税发票。",
  },
  {
    q: "出现问题如何获得支持？",
    a: "邮件 support@nassaapi.xyz 24 小时内响应，付费用户进专属客服群，Pro/Team 用户享受 1 对 1 技术对接。",
  },
];
