/**
 * OpenClaw config read/write layer.
 *
 * 设计原则:
 * - 原子写:先写 .tmp,fsync,再 rename(避免 partial write 损坏 OpenClaw 配置)
 * - 写前备份:保留最近 N 个 .bak.<timestamp>
 * - 读取时**始终从磁盘读**,不缓存(OpenClaw hot reload 时配置可能被外部改动)
 */

import { promises as fs } from "fs";
import { dirname, join } from "path";

const CONFIG_PATH =
  process.env.OPENCLAW_CONFIG_PATH ||
  "/Users/w/Desktop/newapi/openclaw-admin/data/openclaw.sample.json";

const MAX_BACKUPS = 10;

// ---- Types ----

export type ModelEntry = {
  id: string;
  name: string;
  reasoning?: boolean;
  [k: string]: unknown;
};

export type Provider = {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  models?: ModelEntry[];
  [k: string]: unknown;
};

export type OpenClawConfig = {
  models?: {
    mode?: string;
    providers?: Record<string, Provider>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

// ---- Core IO ----

async function readConfig(): Promise<OpenClawConfig> {
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

async function writeConfigAtomic(cfg: OpenClawConfig): Promise<void> {
  const dir = dirname(CONFIG_PATH);
  const ts = Date.now();
  const tmp = join(dir, `.openclaw.json.tmp.${ts}`);
  const bak = `${CONFIG_PATH}.bak.${ts}`;

  // 1. backup current
  try {
    await fs.copyFile(CONFIG_PATH, bak);
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }

  // 2. write to tmp + fsync
  const data = JSON.stringify(cfg, null, 2);
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(data, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }

  // 3. atomic rename
  await fs.rename(tmp, CONFIG_PATH);

  // 4. prune old backups
  try {
    const files = await fs.readdir(dir);
    const baks = files
      .filter((f) => f.includes("openclaw.json.bak.") || (f.startsWith("openclaw.sample.json.bak.")))
      .map((f) => join(dir, f))
      .sort();
    const toDelete = baks.slice(0, Math.max(0, baks.length - MAX_BACKUPS));
    for (const f of toDelete) {
      await fs.unlink(f).catch(() => { });
    }
  } catch {
    /* ignore */
  }
}

// ---- High-level provider/model ops ----

export type ProviderSummary = {
  name: string;
  baseUrl: string;
  apiKeyTail: string;
  api: string;
  modelCount: number;
};

export async function listProviders(): Promise<ProviderSummary[]> {
  const cfg = await readConfig();
  const providers = cfg.models?.providers || {};
  return Object.entries(providers).map(([name, p]) => ({
    name,
    baseUrl: p.baseUrl || "-",
    apiKeyTail: maskKey(p.apiKey || ""),
    api: p.api || "-",
    modelCount: (p.models || []).length,
  }));
}

export async function getProvider(name: string): Promise<Provider | null> {
  const cfg = await readConfig();
  const p = cfg.models?.providers?.[name];
  if (!p) return null;
  return {
    ...p,
    apiKey: p.apiKey ? maskKey(p.apiKey) : "",
  };
}

export async function getProviderFullKey(name: string): Promise<string> {
  const cfg = await readConfig();
  return cfg.models?.providers?.[name]?.apiKey || "";
}

export async function updateProviderApiKey(name: string, apiKey: string): Promise<void> {
  if (!apiKey || apiKey.length < 4) throw new Error("apiKey 太短,拒绝写入");
  const cfg = await readConfig();
  if (!cfg.models?.providers?.[name]) throw new Error(`provider not found: ${name}`);
  cfg.models.providers[name].apiKey = apiKey;
  await touchMeta(cfg);
  await writeConfigAtomic(cfg);
}

export async function updateProviderBaseUrl(name: string, baseUrl: string): Promise<void> {
  const cfg = await readConfig();
  if (!cfg.models?.providers?.[name]) throw new Error(`provider not found: ${name}`);
  cfg.models.providers[name].baseUrl = baseUrl;
  await touchMeta(cfg);
  await writeConfigAtomic(cfg);
}

export async function createProvider(
  name: string,
  data: { baseUrl: string; apiKey: string; api?: string }
): Promise<void> {
  if (!/^[a-zA-Z0-9_\-.]+$/.test(name)) {
    throw new Error("provider 名只能含 字母/数字/下划线/连字符/点");
  }
  if (!data.baseUrl || !data.apiKey) {
    throw new Error("baseUrl 与 apiKey 必填");
  }
  const cfg = await readConfig();
  if (!cfg.models) cfg.models = {};
  if (!cfg.models.providers) cfg.models.providers = {};
  const providers = cfg.models.providers;
  if (providers[name]) throw new Error(`provider 已存在: ${name}`);
  providers[name] = {
    baseUrl: data.baseUrl,
    apiKey: data.apiKey,
    api: data.api || "openai-completions",
    models: [],
  };
  await touchMeta(cfg);
  await writeConfigAtomic(cfg);
}

export async function deleteProvider(name: string): Promise<void> {
  const cfg = await readConfig();
  const providers = cfg.models?.providers;
  if (!providers || !providers[name]) throw new Error(`provider not found: ${name}`);
  delete providers[name];
  await touchMeta(cfg);
  await writeConfigAtomic(cfg);
}

export async function renameProvider(oldName: string, newName: string): Promise<void> {
  if (!/^[a-zA-Z0-9_\-.]+$/.test(newName)) {
    throw new Error("provider 名只能含 字母/数字/下划线/连字符/点");
  }
  const cfg = await readConfig();
  const providers = cfg.models?.providers;
  if (!providers || !providers[oldName]) throw new Error(`provider not found: ${oldName}`);
  if (providers[newName]) throw new Error(`新名 ${newName} 已存在`);
  providers[newName] = providers[oldName];
  delete providers[oldName];
  await touchMeta(cfg);
  await writeConfigAtomic(cfg);
}

export async function addModel(providerName: string, model: ModelEntry): Promise<void> {
  if (!model.id) throw new Error("model.id 必填");
  const cfg = await readConfig();
  const p = cfg.models?.providers?.[providerName];
  if (!p) throw new Error(`provider not found: ${providerName}`);
  p.models = p.models || [];
  if (p.models.some((m) => m.id === model.id)) {
    throw new Error(`模型 id "${model.id}" 已存在`);
  }
  p.models.push({ id: model.id, name: model.name || model.id, ...(model.reasoning ? { reasoning: true } : {}) });
  await touchMeta(cfg);
  await writeConfigAtomic(cfg);
}

export async function removeModel(providerName: string, modelId: string): Promise<void> {
  const cfg = await readConfig();
  const p = cfg.models?.providers?.[providerName];
  if (!p?.models) throw new Error(`provider not found or no models: ${providerName}`);
  const before = p.models.length;
  p.models = p.models.filter((m) => m.id !== modelId);
  if (p.models.length === before) throw new Error(`model not found: ${modelId}`);
  await touchMeta(cfg);
  await writeConfigAtomic(cfg);
}

export async function updateModel(
  providerName: string,
  modelId: string,
  updates: Partial<ModelEntry>
): Promise<void> {
  const cfg = await readConfig();
  const p = cfg.models?.providers?.[providerName];
  if (!p?.models) throw new Error(`provider not found or no models: ${providerName}`);
  const idx = p.models.findIndex((m) => m.id === modelId);
  if (idx < 0) throw new Error(`model not found: ${modelId}`);
  p.models[idx] = { ...p.models[idx], ...updates, id: updates.id || p.models[idx].id };
  await touchMeta(cfg);
  await writeConfigAtomic(cfg);
}

// ---- Helpers ----

function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 10) return k.slice(0, 2) + "***" + k.slice(-2);
  return k.slice(0, 6) + "..." + k.slice(-4);
}

async function touchMeta(cfg: OpenClawConfig): Promise<void> {
  if (!cfg.meta) (cfg as any).meta = {};
  (cfg as any).meta.lastTouchedAt = new Date().toISOString();
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

// ---- agents.defaults.model(当前默认模型/供应商)----

export type DefaultModel = {
  primary: string; // "<provider>/<model_id>"
  fallbacks: string[];
};

export async function getDefaultModel(): Promise<DefaultModel> {
  const cfg = await readConfig();
  const m = (cfg as any).agents?.defaults?.model || {};
  return {
    primary: typeof m.primary === "string" ? m.primary : "",
    fallbacks: Array.isArray(m.fallbacks) ? m.fallbacks.filter((x: any) => typeof x === "string") : [],
  };
}

export async function setDefaultModel(updates: Partial<DefaultModel>): Promise<DefaultModel> {
  const cfg = await readConfig();
  if (!(cfg as any).agents) (cfg as any).agents = {};
  if (!(cfg as any).agents.defaults) (cfg as any).agents.defaults = {};
  if (!(cfg as any).agents.defaults.model) (cfg as any).agents.defaults.model = {};
  const m = (cfg as any).agents.defaults.model;

  if (typeof updates.primary === "string") {
    if (!updates.primary.includes("/")) {
      throw new Error('primary 必须是 "<provider>/<model_id>" 格式');
    }
    // 校验 provider + model 存在
    const [provName, modelId] = updates.primary.split("/", 2);
    const prov = cfg.models?.providers?.[provName];
    if (!prov) throw new Error(`provider 不存在: ${provName}`);
    if (!(prov.models || []).some((mm) => mm.id === modelId)) {
      throw new Error(`model 不存在于 provider ${provName}: ${modelId}`);
    }
    m.primary = updates.primary;
    // 自动确保 defaults.models 里有这个条目(OpenClaw 期望)
    if (!(cfg as any).agents.defaults.models) (cfg as any).agents.defaults.models = {};
    if (!(cfg as any).agents.defaults.models[updates.primary]) {
      (cfg as any).agents.defaults.models[updates.primary] = { alias: modelId };
    }
  }

  if (Array.isArray(updates.fallbacks)) {
    // 简单校验:都是字符串
    for (const f of updates.fallbacks) {
      if (typeof f !== "string" || !f.includes("/")) {
        throw new Error(`fallback 项格式错误:${f}`);
      }
    }
    m.fallbacks = updates.fallbacks;
  }

  await touchMeta(cfg);
  await writeConfigAtomic(cfg);
  return {
    primary: m.primary || "",
    fallbacks: m.fallbacks || [],
  };
}

// ---- 远程模型清单发现 ----
// 调上游 /v1/models(OpenAI 兼容协议),返回可选模型列表。

export type DiscoveredModel = {
  id: string;
  object?: string;
  owned_by?: string;
  created?: number;
};

export async function discoverModels(
  providerName: string
): Promise<{ models: DiscoveredModel[]; triedUrl: string }> {
  const cfg = await readConfig();
  const p = cfg.models?.providers?.[providerName];
  if (!p) throw new Error(`provider not found: ${providerName}`);
  const baseUrl = (p.baseUrl || "").replace(/\/$/, "");
  const apiKey = p.apiKey || "";
  if (!baseUrl) throw new Error("provider 没设 baseUrl,先在详情页编辑 baseUrl");

  // 候选 URL:
  // - baseUrl 已含 /v1 → {baseUrl}/models
  // - 否则两个都试
  const candidates: string[] = [];
  if (baseUrl.endsWith("/v1")) {
    candidates.push(`${baseUrl}/models`);
  } else {
    candidates.push(`${baseUrl}/v1/models`);
    candidates.push(`${baseUrl}/models`);
  }

  const errors: string[] = [];
  for (const url of candidates) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 10000);
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: ac.signal,
        cache: "no-store",
      });
      clearTimeout(t);
      if (!r.ok) {
        errors.push(`${url} → HTTP ${r.status}`);
        continue;
      }
      const j = await r.json();
      // OpenAI 标准:{ object: "list", data: [{id, ...}, ...] }
      const list = Array.isArray(j) ? j : j?.data || j?.models;
      if (Array.isArray(list)) {
        // 归一化:只要 id
        const models: DiscoveredModel[] = list
          .map((m: any) =>
            typeof m === "string"
              ? { id: m }
              : m && m.id
                ? { id: m.id, object: m.object, owned_by: m.owned_by, created: m.created }
                : null
          )
          .filter((m): m is DiscoveredModel => !!m);
        if (models.length === 0) {
          errors.push(`${url} → 返回空列表`);
          continue;
        }
        return { models, triedUrl: url };
      }
      errors.push(`${url} → 响应格式不识别(期望 {data: [...]})`);
    } catch (e: any) {
      errors.push(`${url} → ${e.message || String(e)}`);
    }
  }
  throw new Error(`所有 endpoint 都失败:\n${errors.join("\n")}`);
}

// 批量添加模型:已存在的跳过,返回真实新增数
export async function addModelsBulk(
  providerName: string,
  ids: string[],
  reasoning: boolean = false
): Promise<{ added: string[]; skipped: string[] }> {
  const cfg = await readConfig();
  const p = cfg.models?.providers?.[providerName];
  if (!p) throw new Error(`provider not found: ${providerName}`);
  p.models = p.models || [];
  const existing = new Set(p.models.map((m) => m.id));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    if (!id || existing.has(id)) {
      skipped.push(id);
      continue;
    }
    p.models.push({ id, name: id, ...(reasoning ? { reasoning: true } : {}) });
    existing.add(id);
    added.push(id);
  }
  if (added.length > 0) {
    await touchMeta(cfg);
    await writeConfigAtomic(cfg);
  }
  return { added, skipped };
}
