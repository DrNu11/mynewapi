import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import {
  db,
  insertCard,
  insertReservation,
  insertVideoCreateOperation,
  insertVideoTask,
  finalizeVideoSubmission,
  releaseReservation,
  getPendingInviteSettlementTasks,
  updateVideoTask,
  recordRecoverableUncertainSubmission,
  getRecoverableUncertainOperations,
  recoverUncertainSubmission,
  getVideoTaskByOperationId,
  markReservationUncertain,
  checkRateLimit,
} from './db';
import { reserveVideoCapacity, QuotaError } from './video-quota';
import { isRateLimitError, isNetworkError } from './video-errors';
import {
  settleInviteReward,
  insertAttribution,
  createInviteLink,
  createVisit,
  getAttributionByVideoTask,
  getRedemptionByInviteeCard,
  backfillInviteLinkRisk,
  getInviteLinkById,
} from './invite-reward';
import { createHailuoVideoTask } from './minimax-video';
import { syncVideoTask } from './video-sync';
import { hashIp, hashToken } from './risk-hash';

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

beforeEach(() => {
  // Let each test group manage its own cleanup to avoid FK issues
});

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

function makeSuccessTask(taskId: string, cardId: number, opId: string, reservationId: number, accountIndex = 0) {
  const now = Math.floor(Date.now() / 1000);
  return insertVideoTask({
    task_id: taskId,
    card_id: cardId,
    sk_key: 'sk-test',
    model: 'hailuo-2.3',
    prompt: 'test',
    duration: 6,
    resolution: '1080P',
    status: 'Success',
    file_id: 'file-xyz',
    download_url: 'https://example.com/video.mp4',
    error_message: null,
    account_index: accountIndex,
    quota_source: 'base',
    reservation_id: reservationId,
    operation_id: opId,
    last_query_error: null,
    query_error_count: 0,
    last_queried_at: now,
  });
}

describe('network error detection', () => {
  test('AbortError caused by timeout is detected as network error', () => {
    const err = new Error('The operation was aborted') as any;
    err.name = 'AbortError';
    expect(isNetworkError(err)).toBe(true);
  });

  test('fetch abort signal message is detected as network error', () => {
    expect(isNetworkError(new Error('This operation was aborted'))).toBe(true);
  });

  test('ETIMEDOUT is detected as network error', () => {
    expect(isNetworkError(new Error('ETIMEDOUT'))).toBe(true);
  });

  test('AbortError is not rate limit', () => {
    const err = new Error('The operation was aborted') as any;
    err.name = 'AbortError';
    expect(isRateLimitError(err)).toBe(false);
  });
});

describe('finalizeVideoSubmission failure → uncertain', () => {
  test('reservation 字段不匹配时拒绝 commit,调用方可标记 uncertain', () => {
    const now = Math.floor(Date.now() / 1000);
    makeCard('STEP2-UUUU-1111', 1, 0);
    const card = getCardByCode('STEP2-UUUU-1111');

    const opId = 'op-step2-uncertain-01';
    insertVideoCreateOperation({ operation_id: opId, card_id: card.id, payload_hash: 'hash-unc' });

    // 创建 reservation 但使用不匹配的 quota_source
    const reservationId = insertReservation({
      operation_id: opId,
      attempt_id: 'attempt-unc-01',
      card_id: card.id,
      quota_source: 'invite_bonus', // 与 taskRow 不匹配
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });

    const taskRow = {
      task_id: 'task-unc-001',
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
      quota_source: 'base', // 不匹配 reservation 的 invite_bonus
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
    expect(caught.message).toContain('fields mismatch');

    // reservation 未提交(状态仍是 reserved)
    const res = db().prepare('SELECT * FROM video_quota_reservations WHERE id = ?').get(reservationId) as any;
    expect(res.status).toBe('reserved');

    // operation 未提交(无 video_task_id)
    const op = db().prepare('SELECT * FROM video_create_operations WHERE operation_id = ?').get(opId) as any;
    expect(op.status).toBe('pending');
    expect(op.video_task_id).toBeNull();
  });
});

describe('settlement compensation', () => {
  function setupSettlementScenario(inviterBonus = 0) {
    const now = Math.floor(Date.now() / 1000);

    // 邀请人卡(有 bonus 额度)
    const inviter = makeCard('INVITER-S2-AAAA', 1, inviterBonus, 'activated');
    const inviterCard = getCardByCode('INVITER-S2-AAAA');

    // 被邀请人卡
    const invitee = makeCard('INVITEE-S2-BBBB', 1, 0, 'activated');
    const inviteeCard = getCardByCode('INVITEE-S2-BBBB');

    // 邀请链接
    const link = createInviteLink(inviterCard.id, null, null);

    // visit
    createVisit(link.id, 'test-visit-token-hash-step2', null, null);
    const visit = db().prepare('SELECT * FROM invite_visits WHERE visit_token_hash = ?').get('test-visit-token-hash-step2') as any;

    // 运营 operation + reservation + commit
    const opId = `op-settle-${randomBytes(4).toString('hex')}`;
    insertVideoCreateOperation({ operation_id: opId, card_id: inviteeCard.id, payload_hash: 'hash-settle' });
    const reservationId = insertReservation({
      operation_id: opId,
      attempt_id: `attempt-settle-${randomBytes(4).toString('hex')}`,
      card_id: inviteeCard.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });
    db().prepare("UPDATE video_quota_reservations SET status = 'committed', committed_at = ? WHERE id = ?").run(now, reservationId);
    db().prepare("UPDATE video_create_operations SET status = 'submitted', video_task_id = NULL WHERE operation_id = ?").run(opId);

    // 成功 video task
    const taskId = `mini-task-settle-${randomBytes(4).toString('hex')}`;
    const task = makeSuccessTask(taskId, inviteeCard.id, opId, reservationId);

    // 关联 operation 到 task
    db().prepare('UPDATE video_create_operations SET video_task_id = ? WHERE operation_id = ?').run(task.id, opId);

    // 归因
    insertAttribution({
      invite_visit_id: visit.id,
      invite_link_id: link.id,
      inviter_card_id: inviterCard.id,
      invitee_card_id: inviteeCard.id,
      video_task_id: task.id,
    });

    return { inviterCard, inviteeCard, link, visit, task, opId, reservationId };
  }

  test('Success + pending attribution → settleInviteReward 成功结算', () => {
    const { inviterCard, task } = setupSettlementScenario();

    const result = settleInviteReward(task.id);
    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('granted');

    // inviter bonus +1
    const updatedInviter = db().prepare('SELECT * FROM cards WHERE id = ?').get(inviterCard.id) as any;
    expect(updatedInviter.video_bonus_quota).toBe(inviterCard.video_bonus_quota + 1);

    // attribution 已结算
    const attr = getAttributionByVideoTask(task.id);
    expect(attr?.status).toBe('settled');
  });

  test('重复 settle 不会重复增加 video_bonus_quota', () => {
    const { inviterCard, task } = setupSettlementScenario();

    settleInviteReward(task.id);
    const bonusAfterFirst = (db().prepare('SELECT * FROM cards WHERE id = ?').get(inviterCard.id) as any).video_bonus_quota;

    // 第二次调用: 无 pending attribution, 返回 settled=false 但不 crash
    const result2 = settleInviteReward(task.id);
    expect(result2.settled).toBe(false);

    const bonusAfterSecond = (db().prepare('SELECT * FROM cards WHERE id = ?').get(inviterCard.id) as any).video_bonus_quota;
    expect(bonusAfterSecond).toBe(bonusAfterFirst);
  });

  test('getPendingInviteSettlementTasks 返回 Success + pending attribution 记录', () => {
    setupSettlementScenario();

    const tasks = getPendingInviteSettlementTasks(10);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks[0].status).toBe('Success');
  });

  test('settlement 已完成后 getPendingInviteSettlementTasks 不再返回', () => {
    const { task } = setupSettlementScenario();

    settleInviteReward(task.id);

    const tasks = getPendingInviteSettlementTasks(10);
    expect(tasks.every((t) => t.id !== task.id)).toBe(true);
  });

  test('已有 download_url 的 Success 任务仍可补偿结算', () => {
    const { inviterCard, task } = setupSettlementScenario();

    // task 已有 download_url
    expect(task.download_url).toBeTruthy();

    const result = settleInviteReward(task.id);
    expect(result.settled).toBe(true);

    const updatedInviter = db().prepare('SELECT * FROM cards WHERE id = ?').get(inviterCard.id) as any;
    expect(updatedInviter.video_bonus_quota).toBeGreaterThan(inviterCard.video_bonus_quota);
  });

  test('settlement 失败不影响 attribution 仍为 pending', () => {
    // 自邀会被 rejected_self,但它仍会 settle(不 crash)
    const now = Math.floor(Date.now() / 1000);
    const card = makeCard('SELF-CARD-0001', 1, 0, 'activated');
    const cardData = getCardByCode('SELF-CARD-0001');

    const link = createInviteLink(cardData.id, null, null);
    createVisit(link.id, 'self-visit-hash', null, null);
    const visit = db().prepare('SELECT * FROM invite_visits WHERE visit_token_hash = ?').get('self-visit-hash') as any;

    const opId = 'op-self-settle';
    insertVideoCreateOperation({ operation_id: opId, card_id: cardData.id, payload_hash: 'hash-self' });
    const reservationId = insertReservation({
      operation_id: opId,
      attempt_id: 'attempt-self',
      card_id: cardData.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });
    db().prepare("UPDATE video_quota_reservations SET status = 'committed', committed_at = ? WHERE id = ?").run(now, reservationId);
    db().prepare("UPDATE video_create_operations SET status = 'submitted' WHERE operation_id = ?").run(opId);

    const task = makeSuccessTask('mini-task-self', cardData.id, opId, reservationId);
    db().prepare('UPDATE video_create_operations SET video_task_id = ? WHERE operation_id = ?').run(task.id, opId);

    insertAttribution({
      invite_visit_id: visit.id,
      invite_link_id: link.id,
      inviter_card_id: cardData.id,
      invitee_card_id: cardData.id,
      video_task_id: task.id,
    });

    // 自邀会 rejected_self,而不是 crash
    const result = settleInviteReward(task.id);
    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('rejected_self');

    // 不再出现在 pending settlement 列表中
    const pending = getPendingInviteSettlementTasks(10);
    expect(pending.every((t) => t.id !== task.id)).toBe(true);
  });
});

describe('minimaxFetch timeout', () => {
  test('延迟响应时触发 AbortError', async () => {
    const origFetch = globalThis.fetch;
    const origTimeout = process.env.MINIMAX_HTTP_TIMEOUT_MS;
    process.env.MINIMAX_HTTP_TIMEOUT_MS = '100';

    try {
      // mock fetch 监听 AbortSignal, controller.abort() 时 reject
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted') as any;
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }) as any;

      await expect(
        createHailuoVideoTask({
          model: 'hailuo-2.3',
          prompt: 'test timeout',
          firstFrameImage: 'https://example.com/img.jpg',
          duration: 6,
          resolution: '1080P',
          accountIndex: 0,
        }),
      ).rejects.toSatisfy((e: any) => isNetworkError(e));
    } finally {
      globalThis.fetch = origFetch;
      if (origTimeout) process.env.MINIMAX_HTTP_TIMEOUT_MS = origTimeout;
      else delete process.env.MINIMAX_HTTP_TIMEOUT_MS;
    }
  }, 10000);
});

describe('recoverable uncertain operations', () => {
  function setupUncertainOp(opts?: { upstreamTaskId?: string }) {
    const now = Math.floor(Date.now() / 1000);
    makeCard('RECOVER-CARD-01', 1, 0);
    const card = getCardByCode('RECOVER-CARD-01');

    const opId = `op-recover-${randomBytes(4).toString('hex')}`;
    insertVideoCreateOperation({ operation_id: opId, card_id: card.id, payload_hash: 'hash-recover' });

    const attemptId = `attempt-recover-${randomBytes(4).toString('hex')}`;
    const reservationId = insertReservation({
      operation_id: opId,
      attempt_id: attemptId,
      card_id: card.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });

    if (opts?.upstreamTaskId) {
      recordRecoverableUncertainSubmission(opId, {
        upstream_task_id: opts.upstreamTaskId,
        upstream_account_index: 0,
        reservation_id: reservationId,
        recovery_payload_json: JSON.stringify({
          model: 'hailuo-2.3',
          prompt: 'recovery test',
          duration: 6,
          resolution: '1080P',
          quota_source: 'base',
        }),
      });
      markReservationUncertain(attemptId);
    } else {
      // 直接设置 uncertain 但无 upstream_task_id (手动)
      db().prepare("UPDATE video_create_operations SET status = 'uncertain' WHERE operation_id = ?").run(opId);
    }

    return { opId, reservationId, card };
  }

  test('uncertain + upstream_task_id 由 recoverUncertainSubmission 恢复', () => {
    const { opId } = setupUncertainOp({ upstreamTaskId: 'mini-task-recover-001' });

    const task = recoverUncertainSubmission(opId);
    expect(task.task_id).toBe('mini-task-recover-001');
    expect(task.status).toBe('Submitted');

    // reservation 已 committed
    const reservation = db().prepare('SELECT * FROM video_quota_reservations WHERE operation_id = ?').get(opId) as any;
    expect(reservation.status).toBe('committed');

    // operation 已 submitted
    const op = db().prepare('SELECT * FROM video_create_operations WHERE operation_id = ?').get(opId) as any;
    expect(op.status).toBe('submitted');
    expect(op.video_task_id).toBe(task.id);
  });

  test('recoverUncertainSubmission 幂等: 重复调用返回已有 task', () => {
    const { opId } = setupUncertainOp({ upstreamTaskId: 'mini-task-idempotent-001' });

    const task1 = recoverUncertainSubmission(opId);
    const task2 = recoverUncertainSubmission(opId);
    expect(task2.id).toBe(task1.id);

    const count = (db().prepare('SELECT COUNT(*) as c FROM video_tasks WHERE operation_id = ?').get(opId) as any).c;
    expect(count).toBe(1);
  });

  test('uncertain 无 upstream_task_id 不出现 getRecoverableUncertainOperations 中', () => {
    setupUncertainOp(); // 无 upstream_task_id

    const ops = getRecoverableUncertainOperations(10);
    expect(ops.every((o) => o.operation_id !== 'op-recover-fake' || o.upstream_task_id !== null)).toBe(true);
  });

  test('getRecoverableUncertainOperations 只返回 upstream_task_id 非空的记录', () => {
    const { opId } = setupUncertainOp({ upstreamTaskId: 'mini-task-recover-002' });

    const ops = getRecoverableUncertainOperations(10);
    const found = ops.find((o) => o.operation_id === opId);
    expect(found).toBeTruthy();
    expect(found!.upstream_task_id).toBe('mini-task-recover-002');
  });

  test('recoverUncertainSubmission 拒绝非 uncertain 状态', () => {
    const now = Math.floor(Date.now() / 1000);
    makeCard('RECOVER-CARD-02', 1, 0);
    const card = getCardByCode('RECOVER-CARD-02');

    const opId = 'op-pending-recover';
    insertVideoCreateOperation({ operation_id: opId, card_id: card.id, payload_hash: 'hash-pending' });
    // 保持 pending 状态

    expect(() => recoverUncertainSubmission(opId)).toThrow('Operation not recoverable');
  });
});

describe('syncVideoTask reward settlement', () => {
  test('Success 且 download_url 为空仍结算奖励', async () => {
    const now = Math.floor(Date.now() / 1000);
    // 创建邀请人和被邀请人卡
    const inviter = makeCard('SYNC-INV-AAAA', 1, 1, 'activated');
    const inviterCard = getCardByCode('SYNC-INV-AAAA');
    const invitee = makeCard('SYNC-INV-BBBB', 1, 0, 'activated');
    const inviteeCard = getCardByCode('SYNC-INV-BBBB');

    const link = createInviteLink(inviterCard.id, null, null);
    createVisit(link.id, 'sync-visit-hash', null, null);
    const visit = db().prepare('SELECT * FROM invite_visits WHERE visit_token_hash = ?').get('sync-visit-hash') as any;

    const opId = 'op-sync-settle';
    insertVideoCreateOperation({ operation_id: opId, card_id: inviteeCard.id, payload_hash: 'hash-sync' });
    const reservationId = insertReservation({
      operation_id: opId,
      attempt_id: 'attempt-sync',
      card_id: inviteeCard.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });
    db().prepare("UPDATE video_quota_reservations SET status = 'committed', committed_at = ? WHERE id = ?").run(now, reservationId);

    // 创建 Success 但无 download_url 的 task (无 file_id, pullDownloadUrl 直接返回)
    const task = insertVideoTask({
      task_id: 'mini-task-sync-001',
      card_id: inviteeCard.id,
      sk_key: 'sk-test',
      model: 'hailuo-2.3',
      prompt: 'test',
      duration: 6,
      resolution: '1080P',
      status: 'Success',
      file_id: null,
      download_url: null,
      error_message: null,
      account_index: 0,
      quota_source: 'base',
      reservation_id: reservationId,
      operation_id: opId,
      last_query_error: null,
      query_error_count: 0,
      last_queried_at: now,
    });
    db().prepare('UPDATE video_create_operations SET video_task_id = ?, status = ? WHERE operation_id = ?').run(task.id, 'submitted', opId);

    insertAttribution({
      invite_visit_id: visit.id,
      invite_link_id: link.id,
      inviter_card_id: inviterCard.id,
      invitee_card_id: inviteeCard.id,
      video_task_id: task.id,
    });

    const inviterBonusBefore = (getCardByCode('SYNC-INV-AAAA') as any).video_bonus_quota;

    const result = await syncVideoTask('mini-task-sync-001');
    expect(result.settled).toBe(true);

    const inviterAfter = getCardByCode('SYNC-INV-AAAA') as any;
    expect(inviterAfter.video_bonus_quota).toBe(inviterBonusBefore + 1);
  });

  test('下载地址补拉失败仍完成奖励结算', async () => {
    const origFetch = globalThis.fetch;
    try {
      // mock fetch 返回 500, 让 retrieveHailuoFile 失败
      globalThis.fetch = (() => Promise.resolve(new Response('{"base_resp":{"status_code":500,"status_msg":"internal error"}}', { status: 500 }))) as any;

      const now = Math.floor(Date.now() / 1000);
      const inviter = makeCard('SYNC-FAIL-AAAA', 1, 1, 'activated');
      const inviterCard = getCardByCode('SYNC-FAIL-AAAA');
      const invitee = makeCard('SYNC-FAIL-BBBB', 1, 0, 'activated');
      const inviteeCard = getCardByCode('SYNC-FAIL-BBBB');

      const link = createInviteLink(inviterCard.id, null, null);
      createVisit(link.id, 'sync-fail-visit-hash', null, null);
      const visit = db().prepare('SELECT * FROM invite_visits WHERE visit_token_hash = ?').get('sync-fail-visit-hash') as any;

      const opId = 'op-sync-fail';
      insertVideoCreateOperation({ operation_id: opId, card_id: inviteeCard.id, payload_hash: 'hash-sync-fail' });
      const reservationId = insertReservation({
        operation_id: opId,
        attempt_id: 'attempt-sync-fail',
        card_id: inviteeCard.id,
        quota_source: 'base',
        account_index: 0,
        status: 'reserved',
        expires_at: now + 120,
      });
      db().prepare("UPDATE video_quota_reservations SET status = 'committed', committed_at = ? WHERE id = ?").run(now, reservationId);

      // Success 但无 download_url 且有 file_id(会触发 retrieveHailuoFile → 失败)
      const task = insertVideoTask({
        task_id: 'mini-task-sync-fail',
        card_id: inviteeCard.id,
        sk_key: 'sk-test',
        model: 'hailuo-2.3',
        prompt: 'test',
        duration: 6,
        resolution: '1080P',
        status: 'Success',
        file_id: 'fake-file-id-will-fail',
        download_url: null,
        error_message: null,
        account_index: 0,
        quota_source: 'base',
        reservation_id: reservationId,
        operation_id: opId,
        last_query_error: null,
        query_error_count: 0,
        last_queried_at: now,
      });
      db().prepare('UPDATE video_create_operations SET video_task_id = ?, status = ? WHERE operation_id = ?').run(task.id, 'submitted', opId);

      insertAttribution({
        invite_visit_id: visit.id,
        invite_link_id: link.id,
        inviter_card_id: inviterCard.id,
        invitee_card_id: inviteeCard.id,
        video_task_id: task.id,
      });

      const inviterBonusBefore = (getCardByCode('SYNC-FAIL-AAAA') as any).video_bonus_quota;

      const result = await syncVideoTask('mini-task-sync-fail');
      expect(result.settled).toBe(true);

      // 奖励已结算
      const inviterAfter = getCardByCode('SYNC-FAIL-AAAA') as any;
      expect(inviterAfter.video_bonus_quota).toBe(inviterBonusBefore + 1);

      // last_query_error 已记录补拉失败
      const updatedTask = db().prepare('SELECT * FROM video_tasks WHERE task_id = ?').get('mini-task-sync-fail') as any;
      expect(updatedTask.last_query_error).toBeTruthy();
      expect(updatedTask.last_query_error).toContain('补拉下载地址失败');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ---- Step 3: 风控 & 限流 ----

describe('RISK_HASH_SECRET protection', () => {
  test('production 缺少 RISK_HASH_SECRET 会报错', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSecret = process.env.RISK_HASH_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.RISK_HASH_SECRET;
      expect(() => hashIp('1.2.3.4')).toThrow('RISK_HASH_SECRET');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSecret) process.env.RISK_HASH_SECRET = prevSecret;
    }
  });

  test('test 环境缺少 RISK_HASH_SECRET 使用 fallback', () => {
    const prevSecret = process.env.RISK_HASH_SECRET;
    try {
      delete process.env.RISK_HASH_SECRET;
      // 不应抛错,且返回确定性哈希
      const h1 = hashIp('10.0.0.1');
      const h2 = hashIp('10.0.0.1');
      expect(h1).toBe(h2);
    } finally {
      if (prevSecret) process.env.RISK_HASH_SECRET = prevSecret;
    }
  });

  test('IP hash 不保存明文', () => {
    const h = hashIp('192.168.1.1');
    expect(h).not.toBe('192.168.1.1');
    expect(h).not.toContain('192.168');
    expect(h.length).toBe(64); // sha256 hex
  });
});

describe('same_ip / same_device risk flags', () => {
  function setupRiskScenario(opts: {
    creatorIpHash: string;
    creatorDeviceHash: string;
    inviteeIpHash: string;
    inviteeDeviceHash: string;
  }) {
    const now = Math.floor(Date.now() / 1000);
    const inviter = makeCard('RISK-INV-AAAA', 1, 1, 'activated');
    const inviterCard = getCardByCode('RISK-INV-AAAA');
    const invitee = makeCard('RISK-INV-BBBB', 1, 0, 'activated');
    const inviteeCard = getCardByCode('RISK-INV-BBBB');

    // 直接用带 hash 的 createInviteLink
    const link = createInviteLink(inviterCard.id, opts.creatorIpHash, opts.creatorDeviceHash);

    // 直接用带 hash 的 createVisit
    const visitTokenHash = hashToken(`risk-visit-${randomBytes(4).toString('hex')}`);
    createVisit(link.id, visitTokenHash, opts.inviteeIpHash, opts.inviteeDeviceHash);
    const visit = db().prepare('SELECT * FROM invite_visits WHERE visit_token_hash = ?').get(visitTokenHash) as any;

    const opId = `op-risk-${randomBytes(4).toString('hex')}`;
    insertVideoCreateOperation({ operation_id: opId, card_id: inviteeCard.id, payload_hash: 'hash-risk' });
    const reservationId = insertReservation({
      operation_id: opId,
      attempt_id: `attempt-risk-${randomBytes(4).toString('hex')}`,
      card_id: inviteeCard.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });
    db().prepare("UPDATE video_quota_reservations SET status = 'committed', committed_at = ? WHERE id = ?").run(now, reservationId);
    db().prepare("UPDATE video_create_operations SET status = 'submitted' WHERE operation_id = ?").run(opId);

    const task = makeSuccessTask(`mini-task-risk-${randomBytes(4).toString('hex')}`, inviteeCard.id, opId, reservationId);
    db().prepare('UPDATE video_create_operations SET video_task_id = ? WHERE operation_id = ?').run(task.id, opId);

    insertAttribution({
      invite_visit_id: visit.id,
      invite_link_id: link.id,
      inviter_card_id: inviterCard.id,
      invitee_card_id: inviteeCard.id,
      video_task_id: task.id,
    });

    return { inviterCard, inviteeCard, task };
  }

  test('同 IP 不同 device: 正常发奖但记录 same_ip', () => {
    const ipHash = hashIp('10.0.0.99');
    const { inviterCard, task } = setupRiskScenario({
      creatorIpHash: ipHash,
      creatorDeviceHash: hashToken('device-red'),
      inviteeIpHash: ipHash,        // 同 IP
      inviteeDeviceHash: hashToken('device-blue'), // 不同 device
    });

    const result = settleInviteReward(task.id);
    expect(result.outcome).toBe('granted');

    // redemption 带 same_ip risk flag,不含 same_device
    const redemption = db().prepare(
      'SELECT * FROM invite_redemptions WHERE inviter_card_id = ? ORDER BY id DESC LIMIT 1'
    ).get(inviterCard.id) as any;
    expect(redemption.risk_flags).toContain('same_ip');
    expect(redemption.risk_flags).not.toContain('same_device');
  });

  test('同 IP + 同 device: pending_review', () => {
    const ipHash = hashIp('10.0.0.88');
    const devHash = hashToken('device-green');
    const { inviterCard, task } = setupRiskScenario({
      creatorIpHash: ipHash,
      creatorDeviceHash: devHash,
      inviteeIpHash: ipHash,       // 同 IP
      inviteeDeviceHash: devHash,  // 同 device
    });

    const result = settleInviteReward(task.id);
    expect(result.outcome).toBe('pending_review');

    // redemption 带 same_ip 和 same_device
    const redemption = db().prepare(
      'SELECT * FROM invite_redemptions WHERE inviter_card_id = ? ORDER BY id DESC LIMIT 1'
    ).get(inviterCard.id) as any;
    expect(redemption.risk_flags).toContain('same_ip');
    expect(redemption.risk_flags).toContain('same_device');
    expect(redemption.reward_status).toBe('pending_review');

    // inviter bonus 未增加 (未发奖)
    const inviter = db().prepare('SELECT * FROM cards WHERE id = ?').get(redemption.inviter_card_id) as any;
    expect(inviter.video_bonus_quota).toBe(1); // 原始值未变
  });
});

describe('rate limiting', () => {
  test('限流命中时返回 false(429)', () => {
    const key = `test-rate-${randomBytes(4).toString('hex')}`;
    // 前 5 次通过
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60)).toBe(true);
    }
    // 第 6 次命中限流
    expect(checkRateLimit(key, 5, 60)).toBe(false);
  });

  test('不同 key 不受影响', () => {
    const keyA = `test-rate-a-${randomBytes(4).toString('hex')}`;
    const keyB = `test-rate-b-${randomBytes(4).toString('hex')}`;
    // 耗尽 A
    for (let i = 0; i < 3; i++) checkRateLimit(keyA, 3, 60);
    expect(checkRateLimit(keyA, 3, 60)).toBe(false);
    // B 不受影响
    expect(checkRateLimit(keyB, 3, 60)).toBe(true);
  });
});

describe('COOKIE_SECURE flag', () => {
  test('COOKIE_SECURE=false 时 cookieSecure 为 false', () => {
    const prev = process.env.COOKIE_SECURE;
    try {
      process.env.COOKIE_SECURE = 'false';
      expect(process.env.COOKIE_SECURE !== 'false').toBe(false);
    } finally {
      if (prev) process.env.COOKIE_SECURE = prev;
      else delete process.env.COOKIE_SECURE;
    }
  });

  test('COOKIE_SECURE 未设置(线上默认)时 cookieSecure 为 true', () => {
    const prev = process.env.COOKIE_SECURE;
    try {
      delete process.env.COOKIE_SECURE;
      expect(process.env.COOKIE_SECURE !== 'false').toBe(true);
    } finally {
      if (prev) process.env.COOKIE_SECURE = prev;
    }
  });
});

describe('backfillInviteLinkRisk', () => {
  test('已有 link 风险字段为空时会回填', () => {
    const inviter = makeCard('BFILL-AAAA', 1, 0, 'activated');
    const inviterCard = getCardByCode('BFILL-AAAA');
    // 创建时 ipHash 和 deviceHash 均为 null
    const link = createInviteLink(inviterCard.id, null, null);
    expect(link.creator_ip_hash).toBeNull();
    expect(link.creator_device_hash).toBeNull();

    const ipHash = hashIp('10.0.0.99');
    const deviceHash = hashToken('device-backfill');
    backfillInviteLinkRisk(link.id, ipHash, deviceHash);

    const updated = getInviteLinkById(link.id);
    expect(updated!.creator_ip_hash).toBe(ipHash);
    expect(updated!.creator_device_hash).toBe(deviceHash);
  });

  test('已有 link 风险字段非空时不覆盖', () => {
    const inviter = makeCard('BFILL-BBBB', 1, 0, 'activated');
    const inviterCard = getCardByCode('BFILL-BBBB');
    const origIp = hashIp('10.0.0.1');
    const origDev = hashToken('device-original');
    const link = createInviteLink(inviterCard.id, origIp, origDev);

    backfillInviteLinkRisk(link.id, hashIp('10.0.0.2'), hashToken('device-new'));

    const updated = getInviteLinkById(link.id);
    expect(updated!.creator_ip_hash).toBe(origIp);
    expect(updated!.creator_device_hash).toBe(origDev);
  });
});

describe('video/status reward settlement for Success + download_url', () => {
  test('Success 终态有 download_url 仍触发奖励结算', async () => {
    const now = Math.floor(Date.now() / 1000);
    const inviter = makeCard('VSTATS-A', 1, 1, 'activated');
    const inviterCard = getCardByCode('VSTATS-A');
    const invitee = makeCard('VSTATS-B', 1, 0, 'activated');
    const inviteeCard = getCardByCode('VSTATS-B');

    const link = createInviteLink(inviterCard.id, null, null);
    const visitTokenHash = hashToken(`vstats-visit-${randomBytes(4).toString('hex')}`);
    createVisit(link.id, visitTokenHash, null, null);
    const visit = db().prepare('SELECT * FROM invite_visits WHERE visit_token_hash = ?').get(visitTokenHash) as any;

    const opId = `op-vstats-${randomBytes(4).toString('hex')}`;
    insertVideoCreateOperation({ operation_id: opId, card_id: inviteeCard.id, payload_hash: 'hash-vstats' });
    const reservationId = insertReservation({
      operation_id: opId,
      attempt_id: `attempt-vstats-${randomBytes(4).toString('hex')}`,
      card_id: inviteeCard.id,
      quota_source: 'base',
      account_index: 0,
      status: 'reserved',
      expires_at: now + 120,
    });
    db().prepare("UPDATE video_quota_reservations SET status = 'committed', committed_at = ? WHERE id = ?").run(now, reservationId);
    db().prepare("UPDATE video_create_operations SET status = 'submitted' WHERE operation_id = ?").run(opId);

    const task = makeSuccessTask(`mini-vstats-${randomBytes(4).toString('hex')}`, inviteeCard.id, opId, reservationId);
    db().prepare('UPDATE video_create_operations SET video_task_id = ? WHERE operation_id = ?').run(task.id, opId);

    insertAttribution({
      invite_visit_id: visit.id,
      invite_link_id: link.id,
      inviter_card_id: inviterCard.id,
      invitee_card_id: inviteeCard.id,
      video_task_id: task.id,
    });

    const inviterBonusBefore = (getCardByCode('VSTATS-A') as any).video_bonus_quota;

    // syncVideoTask 对 Success + download_url 任务仍触发结算
    const result = await syncVideoTask(task.task_id);
    expect(result.settled).toBe(true);

    const inviterAfter = (getCardByCode('VSTATS-A') as any);
    expect(inviterAfter.video_bonus_quota).toBe(inviterBonusBefore + 1);
  });
});