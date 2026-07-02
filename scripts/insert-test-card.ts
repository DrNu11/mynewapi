/**
 * 一次性脚本: 在 data/cards.db 里插入一张 unused 测试卡密用于本地 video smoke test。
 * 不改任何源码,跑完即用。
 */
import { insertCard } from '../lib/db';

const now = Math.floor(Date.now() / 1000);
const code = 'DE-TEST-VIDE-0010';

const id = insertCard({
  code,
  plan: '1d',
  plan_days: 1,
  category: 'deepseek',
  rph: 60,
  rph_bonus: 0,
  rph_bonus_reason: null,
  rph_bonus_at: null,
  claimed_at: null,
  video_quota: 1,
  video_bonus_quota: 0,
  pool: 'local-smoke-test',
  status: 'unused',
  created_at: now,
  activated_at: null,
  expires_at: null,
  newapi_user_id: null,
  newapi_token_id: null,
  newapi_token_key: null,
  activator_ip: null,
  disable_reason: null,
  notes: 'manual local smoke test card',
} as any);

console.log(`inserted card id=${id} code=${code}`);