/**
 * New API 后端客户端 - 用于调用管理员 API。
 *
 * 必须设置以下环境变量：
 *   NEWAPI_BASE_URL    - 例如 https://api.nassaapi.xyz
 *   NEWAPI_ADMIN_TOKEN - 管理员的 access_token（在 New API 后台 → 个人设置 生成）
 *   NEWAPI_ADMIN_USER_ID - 管理员的用户 ID（数字，例如 1）
 */

interface NewApiConfig {
  baseUrl: string;
  adminToken: string;
  adminUserId: number;
}

function getConfig(): NewApiConfig {
  const baseUrl = process.env.NEWAPI_BASE_URL;
  const adminToken = process.env.NEWAPI_ADMIN_TOKEN;
  const adminUserIdRaw = process.env.NEWAPI_ADMIN_USER_ID;

  if (!baseUrl) throw new Error("NEWAPI_BASE_URL 未设置");
  if (!adminToken) throw new Error("NEWAPI_ADMIN_TOKEN 未设置");
  if (!adminUserIdRaw) throw new Error("NEWAPI_ADMIN_USER_ID 未设置");

  const adminUserId = Number.parseInt(adminUserIdRaw, 10);
  if (Number.isNaN(adminUserId)) {
    throw new Error("NEWAPI_ADMIN_USER_ID 必须是数字");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    adminToken,
    adminUserId,
  };
}

interface NewApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

/**
 * 调用 New API 管理员接口创建兑换码（POST /api/redemption/）
 *
 * @returns 兑换码字符串数组（长度 = count）
 */
export async function createRedemptions(input: {
  name: string;
  /** 額度，按 New API 内部单位（默认 1 USD = 500000） */
  quota: number;
  /** 创建多少张码，1-100 */
  count: number;
  /** Unix 秒级时间戳，0 = 永不过期 */
  expiredTime?: number;
}): Promise<string[]> {
  const cfg = getConfig();

  const body = {
    name: input.name,
    quota: input.quota,
    count: input.count,
    expired_time: input.expiredTime ?? 0,
  };

  const res = await fetch(`${cfg.baseUrl}/api/redemption/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: cfg.adminToken,
      "New-Api-User": String(cfg.adminUserId),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `New API 返回 HTTP ${res.status}: ${text.slice(0, 200)}`
    );
  }

  const json = (await res.json()) as NewApiResponse<string[]>;
  if (!json.success) {
    throw new Error(`New API 创建兑换码失败: ${json.message ?? "unknown"}`);
  }
  if (!json.data || !Array.isArray(json.data) || json.data.length === 0) {
    throw new Error("New API 返回数据为空");
  }
  return json.data;
}

/**
 * 把 USD 金额转换为 New API 内部 quota 单位。
 * 默认比率：1 USD = 500000 quota（与 New API 默认 QuotaPerUnit 一致）。
 * 可通过 NEWAPI_QUOTA_PER_UNIT 环境变量覆盖。
 */
export function usdToQuota(usd: number): number {
  const ratio = Number.parseInt(
    process.env.NEWAPI_QUOTA_PER_UNIT ?? "500000",
    10
  );
  return Math.round(usd * ratio);
}

export function quotaToUsd(quota: number): number {
  const ratio = Number.parseInt(
    process.env.NEWAPI_QUOTA_PER_UNIT ?? "500000",
    10
  );
  return quota / ratio;
}
