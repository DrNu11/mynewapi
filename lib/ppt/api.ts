import type { NextRequest } from 'next/server';

export function apiKeyFromRequest(req: NextRequest, body?: { apiKey?: unknown }): string {
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const headerKey = req.headers.get('x-api-key') || '';
  const bodyKey = typeof body?.apiKey === 'string' ? body.apiKey : '';
  return (bearer || headerKey || bodyKey).trim();
}

export function validateSkKey(sk: string): string | null {
  if (!sk) return '缺少 API Key';
  if (!sk.startsWith('sk-')) return '请输入正确的 API Key (以 sk- 开头)';
  if (sk.length > 512) return 'API Key 长度异常';
  return null;
}

