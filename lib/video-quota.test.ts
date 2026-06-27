import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';

import {
  db,
  insertCard,
  insertReservation,
  insertVideoCreateOperation,
  commitReservation,
  releaseReservation,
  getVideoQuotaUsedBySource,
  countReservedBySource,
} from './db';
import { reserveVideoCapacity, QuotaError } from './video-quota';
import { finalizeVideoSubmission } from './db';
import { isRateLimitError, isNetworkError } from './video-errors';

function cleanupTables() {
  db().exec('DELETE FROM invite_reward_ledger');
  db().exec('DELETE FROM invite_redemptions');
  db().exec('DELETE FROM invite_attributions');
  db().exec('DELETE FROM invite_visits');
  db().exec('DELETE FROM invite_links');
  db().exec('DELETE FROM video_quota_reservations');
  db().exec('DELETE FROM video_create_operations');
  db().exec('DELETE FROM video_tasks');
  db().exec('DELETE FROM cards');
}

afterEach(() => {
  cleanupTables();
});

afterAll(() => {
  const p = process.env.DB_PATH;
  if (p && existsSync(p)) unlinkSync(p);
});

function makeCard(code: string, videoQuota = 1, bonusQuota = 0, status = 'unused') {
  const now = Math.floor(Date.now() / 1000);
  return insertCard({
    code,
    plan: '7d',
    plan_days: 7,
    category: 'deepseek',
    rph: 0,
    rph_bonus: 0,
    rph_bonus_reason: null,
    rph_bonus_at: null,
    video_quota: videoQuota,
    video_bonus_quota: bonusQuota,
    pool: null,
    status: status as any,
    created_at: now,
    activated_at: null,
    expires_at: null,
    claimed_at: null,
    newapi_user_id: null,
    newapi_token_id: null,
    newapi_token_key: null,
    activator_ip: null,
    disable_reason: null,
    notes: null,
  });
}

function getCardByCode(code: string) {
  return db().prepare('SELECT * FROM cards WHERE code = ?').get(code) as any;
}

// ---- error classification helpers (imported from lib/video-errors.ts) ----

describe('error classification helpers', () => {
  test('detects HTTP 429 as rate limit', () => {
    const err = new Error('Too Many Requests') as any;
    err.httpStatus = 429;
    expect(isRateLimitError(err)).toBe(true);
  });

  test('detects apiStatusCode 1004 as rate limit', () => {
    const err = new Error('Rate limit exceeded') as any;
    err.apiStatusCode = 1004;
    expect(isRateLimitError(err)).toBe(true);
  });

  test('detects rate keyword in message', () => {
    expect(isRateLimitError(new Error('Rate exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('quota limit'))).toBe(true);
    expect(isRateLimitError(new Error('Quota exceeded'))).toBe(true);
  });

  test('regular error is not rate limit', () => {
    expect(isRateLimitError(new Error('Invalid parameter'))).toBe(false);
  });

  test('detects ETIMEDOUT as network error', () => {
    expect(isNetworkError(new Error('ETIMEDOUT'))).toBe(true);
  });

  test('detects AbortError by name', () => {
    const err = new Error('The operation was aborted') as any;
    err.name = 'AbortError';
    expect(isNetworkError(err)).toBe(true);
  });

  test('detects ECONNRESET as network error', () => {
    expect(isNetworkError(new Error('ECONNRESET'))).toBe(true);
  });

  test('rate limit is not network error', () => {
    expect(isNetworkError(new Error('rate limit'))).toBe(false);
  });
});

describe('reserveVideoCapacity', () => {
  test('首次预占应成功并返回 reservation', () => {
    makeCard('TEST-AAAA-BBBB-CCCC', 1, 0);
    const card = getCardByCode('TEST-AAAA-BBBB-CCCC');

    const result = reserveVideoCapacity({
      operationId: 'op-test-001',
      cardId: card.id,
      payloadHash: 'abc123',
    });

    expect(result.quotaSource).toBe('base');
    expect(result.accountIndex).toBeGreaterThanOrEqual(0);
    expect(result.attemptId).toBeTruthy();
    expect(result.reservationId).toBeGreaterThan(0);
  });

  test('activated 卡仍可使用尚未消耗的基础视频额度', () => {
    makeCard('TEST-ACTV-BASE-0001', 1, 0, 'activated');
    const card = getCardByCode('TEST-ACTV-BASE-0001');

    const result = reserveVideoCapacity({
      operationId: 'op-activated-base-01',
      cardId: card.id,
      payloadHash: 'activated-base',
    });

    expect(result.quotaSource).toBe('base');
  });

  test('同卡最后 1 次额度,第二次 reserve 应失败', () => {
    makeCard('TEST-AAAA-BBBB-DDDD', 1, 0);
    const card = getCardByCode('TEST-AAAA-BBBB-DDDD');

    reserveVideoCapacity({ operationId: 'op-concurrent-01', cardId: card.id, payloadHash: 'hash1' });

    let caught: any = null;
    try {
      reserveVideoCapacity({ operationId: 'op-concurrent-02', cardId: card.id, payloadHash: 'hash2' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(QuotaError);
    expect(caught.code).toBe('CARD_QUOTA_EXHAUSTED');
    expect(caught.httpStatus).toBe(429);
  });

  test('operation 旧 attempt released 后可以创建新 attempt', () => {
    makeCard('TEST-AAAA-BBBB-EEEE', 1, 0);
    const card = getCardByCode('TEST-AAAA-BBBB-EEEE');

    const r1 = reserveVideoCapacity({ operationId: 'op-reuse-01', cardId: card.id, payloadHash: 'hash-reuse' });
    releaseReservation(r1.attemptId, 'rate_limited');

    const r2 = reserveVideoCapacity({ operationId: 'op-reuse-01', cardId: card.id, payloadHash: 'hash-reuse' });

    expect(r2.attemptId).not.toBe(r1.attemptId);
    expect(r2.reservationId).not.toBe(r1.reservationId);
  });

  test('相同 operation_id 不同 payload_hash 应拒绝', () => {
    makeCard('TEST-AAAA-BBBB-FFFF', 2, 0);
    const card = getCardByCode('TEST-AAAA-BBBB-FFFF');

    reserveVideoCapacity({ operationId: 'op-conflict-01', cardId: card.id, payloadHash: 'hash-a' });

    let caught: any = null;
    try {
      reserveVideoCapacity({ operationId: 'op-conflict-01', cardId: card.id, payloadHash: 'hash-b' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(QuotaError);
    expect(caught.code).toBe('IDEMPOTENT_CONFLICT');
  });

  test('已 submitted 的 operation 应拒绝重复', () => {
    makeCard('TEST-AAAA-BBBB-JJJJ', 2, 0);
    const card = getCardByCode('TEST-AAAA-BBBB-JJJJ');

    const r = reserveVideoCapacity({ operationId: 'op-done-01', cardId: card.id, payloadHash: 'hash-d' });
    // 模拟 submitted 状态
    db().prepare("UPDATE video_create_operations SET status = 'submitted' WHERE operation_id = ?").run('op-done-01');

    let caught: any = null;
    try {
      reserveVideoCapacity({ operationId: 'op-done-01', cardId: card.id, payloadHash: 'hash-d' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(QuotaError);
    expect(caught.code).toBe('DUPLICATE_OPERATION');
  });
});

describe('finalizeVideoSubmission', () => {
  test('原子提交 task + reservation + operation', () => {
    const now = Math.floor(Date.now() / 1000);
    makeCard('TEST-AAAA-BBBB-GGGG', 1, 0);
    const card = getCardByCode('TEST-AAAA-BBBB-GGGG');

    const opId = 'op-finalize-01';
    insertVideoCreateOperation({ operation_id: opId, card_id: card.id, payload_hash: 'hash-f' });

    const reservationId = insertReservation({
      operation_id: opId,
      attempt_id: 'attempt-finalize-01',
      card_id: card.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });

    const task = finalizeVideoSubmission({
      task_id: 'task-finalize-001',
      card_id: card.id,
      sk_key: 'sk-test',
      model: 'hailuo-2.3',
      prompt: 'test prompt',
      duration: 6,
      resolution: '1080P',
      status: 'Submitted',
      file_id: null,
      download_url: null,
      error_message: null,
      account_index: 0,
      quota_source: 'base',
      reservation_id: reservationId,
      operation_id: opId,
      last_query_error: null,
      query_error_count: 0,
      last_queried_at: null,
    }, reservationId);

    expect(task.id).toBeGreaterThan(0);
    expect(task.task_id).toBe('task-finalize-001');

    const reservation = db().prepare('SELECT * FROM video_quota_reservations WHERE id = ?').get(reservationId) as any;
    expect(reservation.status).toBe('committed');

    const op = db().prepare('SELECT * FROM video_create_operations WHERE operation_id = ?').get(opId) as any;
    expect(op.status).toBe('submitted');
    expect(op.video_task_id).toBe(task.id);
  });

  test('幂等: 重复调用返回已有 task,不创建新 task', () => {
    const now = Math.floor(Date.now() / 1000);
    makeCard('TEST-AAAA-BBBB-HHHH', 1, 0);
    const card = getCardByCode('TEST-AAAA-BBBB-HHHH');

    const opId = 'op-idempotent-01';
    insertVideoCreateOperation({ operation_id: opId, card_id: card.id, payload_hash: 'hash-i' });

    const reservationId = insertReservation({
      operation_id: opId,
      attempt_id: 'attempt-idempotent-01',
      card_id: card.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });

    const taskRow = {
      task_id: 'task-idempotent-001',
      card_id: card.id,
      sk_key: 'sk-test',
      model: 'hailuo-2.3',
      prompt: 'test',
      duration: 6,
      resolution: '1080P',
      status: 'Submitted',
      file_id: null,
      download_url: null,
      error_message: null,
      account_index: 0,
      quota_source: 'base',
      reservation_id: reservationId,
      operation_id: opId,
      last_query_error: null,
      query_error_count: 0,
      last_queried_at: null,
    };

    const task1 = finalizeVideoSubmission(taskRow, reservationId);
    const task2 = finalizeVideoSubmission(taskRow, reservationId);

    expect(task2.id).toBe(task1.id);
    const count = (db().prepare('SELECT COUNT(*) as c FROM video_tasks WHERE operation_id = ?').get(opId) as any).c;
    expect(count).toBe(1);
  });

  test('reservation 已 committed 时再次 finalize 应失败', () => {
    const now = Math.floor(Date.now() / 1000);
    makeCard('TEST-AAAA-BBBB-IIII', 1, 0);
    const card = getCardByCode('TEST-AAAA-BBBB-IIII');

    const opId = 'op-committed-01';
    insertVideoCreateOperation({ operation_id: opId, card_id: card.id, payload_hash: 'hash-c' });

    const reservationId = insertReservation({
      operation_id: opId,
      attempt_id: 'attempt-committed-01',
      card_id: card.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });

    commitReservation(reservationId);

    const taskRow = {
      task_id: 'task-committed-001',
      card_id: card.id,
      sk_key: 'sk-test',
      model: 'hailuo-2.3',
      prompt: 'test',
      duration: 6,
      resolution: '1080P',
      status: 'Submitted',
      file_id: null,
      download_url: null,
      error_message: null,
      account_index: 0,
      quota_source: 'base',
      reservation_id: reservationId,
      operation_id: opId,
      last_query_error: null,
      query_error_count: 0,
      last_queried_at: null,
    };

    let caught: any = null;
    try {
      finalizeVideoSubmission(taskRow, reservationId);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.message).toContain('not in reserved state');
  });

  test('使用其他 operation 的 reservation 应拒绝并保持原状态', () => {
    const now = Math.floor(Date.now() / 1000);
    makeCard('TEST-AAAA-BBBB-KKKK', 1, 0);
    const card = getCardByCode('TEST-AAAA-BBBB-KKKK');

    const opIdA = 'op-cross-a';
    const opIdB = 'op-cross-b';
    insertVideoCreateOperation({ operation_id: opIdA, card_id: card.id, payload_hash: 'hash-a' });
    insertVideoCreateOperation({ operation_id: opIdB, card_id: card.id, payload_hash: 'hash-b' });

    const reservationId = insertReservation({
      operation_id: opIdA,
      attempt_id: 'attempt-cross-01',
      card_id: card.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });

    const taskRow = {
      task_id: 'task-cross-001',
      card_id: card.id,
      sk_key: 'sk-test',
      model: 'hailuo-2.3',
      prompt: 'test',
      duration: 6,
      resolution: '1080P',
      status: 'Submitted',
      file_id: null,
      download_url: null,
      error_message: null,
      account_index: 0,
      quota_source: 'base',
      reservation_id: reservationId,
      operation_id: opIdB, // mismatched — reservation belongs to opIdA
      last_query_error: null,
      query_error_count: 0,
      last_queried_at: null,
    };

    let caught: any = null;
    try {
      finalizeVideoSubmission(taskRow, reservationId);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.message).toContain('fields mismatch');

    // 没有新增 video_tasks
    const taskCount = (db().prepare('SELECT COUNT(*) as c FROM video_tasks WHERE operation_id = ?').get(opIdB) as any).c;
    expect(taskCount).toBe(0);

    // reservation 状态保持 reserved
    const reservation = db().prepare('SELECT * FROM video_quota_reservations WHERE id = ?').get(reservationId) as any;
    expect(reservation.status).toBe('reserved');
  });
});

describe('baseAvailable logic (quota route)', () => {
  function canUseVideoQuota(status: string): boolean {
    return status === 'unused' || status === 'activated';
  }

  function computeBaseRemaining(cardId: number, videoQuota: number, status: string): number {
    if (!canUseVideoQuota(status)) return 0;
    const now = Math.floor(Date.now() / 1000);
    const used = getVideoQuotaUsedBySource(cardId, 'base');
    const reserved = countReservedBySource(cardId, 'base', now);
    return Math.max(0, videoQuota - used - reserved);
  }

  test('unused 卡 video_quota=1 used=0 reserved=0 → remaining=1', () => {
    makeCard('TEST-QUOTA-UUUU', 1, 0, 'unused');
    const card = getCardByCode('TEST-QUOTA-UUUU');
    expect(computeBaseRemaining(card.id, card.video_quota, card.status)).toBe(1);
  });

  test('activated 卡 video_quota=1 used=0 reserved=0 → remaining=1', () => {
    makeCard('TEST-QUOTA-AAAA', 1, 0, 'activated');
    const card = getCardByCode('TEST-QUOTA-AAAA');
    expect(computeBaseRemaining(card.id, card.video_quota, card.status)).toBe(1);
  });

  test('activated 卡 video_quota=1 used=1 reserved=0 → remaining=0', () => {
    makeCard('TEST-QUOTA-BBBB', 1, 0, 'activated');
    const card = getCardByCode('TEST-QUOTA-BBBB');
    // a video_task row with quota_source='base' counts as used
    db().prepare(`INSERT INTO video_tasks (card_id, sk_key, status, task_id, model, prompt, duration, resolution, quota_source, query_error_count, created_at, updated_at)
      VALUES (?, 'sk-test', 'Success', 'task-test-used', 'hailuo-2.3', 'test', 6, '1080P', 'base', 0, 1, 1)`)
      .run(card.id);
    expect(computeBaseRemaining(card.id, card.video_quota, card.status)).toBe(0);
  });

  test('activated 卡 video_quota=1 used=0 reserved=1 → remaining=0', () => {
    makeCard('TEST-QUOTA-CCCC', 1, 0, 'activated');
    const card = getCardByCode('TEST-QUOTA-CCCC');
    const now = Math.floor(Date.now() / 1000);
    insertReservation({
      operation_id: 'op-test-reserved',
      attempt_id: 'attempt-test-reserved',
      card_id: card.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });
    expect(computeBaseRemaining(card.id, card.video_quota, card.status)).toBe(0);
  });

  test('非 unused/activated 状态 (disabled) → remaining=0', () => {
    makeCard('TEST-QUOTA-DDDD', 1, 0, 'disabled');
    const card = getCardByCode('TEST-QUOTA-DDDD');
    expect(computeBaseRemaining(card.id, card.video_quota, card.status)).toBe(0);
  });
});
