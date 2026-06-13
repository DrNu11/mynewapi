import { NextRequest } from 'next/server';

/**
 * 提取可信客户端 IP。
 * 只信任 Nginx 重建的 X-Real-IP,不信任客户端自带的 X-Forwarded-For。
 */
export function clientIp(req: NextRequest): string {
  const xri = req.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}
