/**
 * MiniMax 视频生成错误分类 — 供 API 路由和测试共享使用。
 */
export function isRateLimitError(e: unknown): boolean {
  const msg = (e as any)?.message || String(e);
  return (
    (e as any)?.httpStatus === 429 ||
    (e as any)?.apiStatusCode === 1004 ||
    msg.includes('rate') ||
    msg.includes('Rate') ||
    msg.includes('limit') ||
    msg.includes('quota') ||
    msg.includes('Quota') ||
    msg.includes('exceeded')
  );
}

export function isNetworkError(e: unknown): boolean {
  const msg = (e as any)?.message || String(e);
  return (
    msg.includes('timeout') ||
    msg.includes('Timeout') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('abort') ||
    msg.includes('AbortError') ||
    (e as any)?.name === 'AbortError'
  );
}
