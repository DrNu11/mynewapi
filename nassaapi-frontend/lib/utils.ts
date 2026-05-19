import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 拿到面向公网用户的 origin（含协议+域名）。
 * 处理 Cloudflare Flexible 模式下 origin 看到的是 HTTP 但实际访客是 HTTPS 的情况。
 *
 * 优先级：
 *   1. X-Forwarded-Proto + Host header（CF / nginx 等反代会带）
 *   2. fallback 到 req.url 自身
 *
 * 例：CF 转发 https://redeem.nassaapi.xyz/api/x → 这函数返回 https://redeem.nassaapi.xyz
 */
export function getPublicOrigin(req: Request): string {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const proto = forwardedProto?.split(",")[0].trim() || url.protocol.replace(":", "");
  const host = req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}
