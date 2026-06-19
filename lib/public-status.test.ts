import { describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  calculatePublicStatus,
  classifyPublicService,
  formatLatencyMs,
  formatTokenCount,
  getPublicStatusSnapshot,
} from './public-status';

describe('classifyPublicService', () => {
  test('classifies GPT models', () => {
    expect(classifyPublicService('gpt-4o')).toBe('gpt');
  });

  test('classifies Claude models', () => {
    expect(classifyPublicService('claude-sonnet-4')).toBe('claude');
  });

  test('classifies DeepSeek models', () => {
    expect(classifyPublicService('deepseek-v4-pro')).toBe('deepseek');
  });

  test('does not expose MiniMax in public status', () => {
    expect(classifyPublicService('minimax-m2.7')).toBeNull();
    expect(classifyPublicService('hailuo-2.3')).toBeNull();
  });
});

describe('calculatePublicStatus', () => {
  test('healthy when success rate is at least 98 and failures are below 10', () => {
    expect(
      calculatePublicStatus({
        successRate1h: 98,
        successRate24h: 99,
        consecutiveFailures: 9,
        requests1h: 100,
        requests24h: 1000,
      }),
    ).toBe('healthy');
  });

  test('degraded when success rate is between 95 and 98', () => {
    expect(
      calculatePublicStatus({
        successRate1h: 97.99,
        successRate24h: 99,
        consecutiveFailures: 0,
        requests1h: 100,
        requests24h: 1000,
      }),
    ).toBe('degraded');
  });

  test('degraded when consecutive failures are 10 to 49', () => {
    expect(
      calculatePublicStatus({
        successRate1h: 99,
        successRate24h: 99,
        consecutiveFailures: 10,
        requests1h: 100,
        requests24h: 1000,
      }),
    ).toBe('degraded');
  });

  test('outage when success rate is below 95', () => {
    expect(
      calculatePublicStatus({
        successRate1h: 94.99,
        successRate24h: 99,
        consecutiveFailures: 0,
        requests1h: 100,
        requests24h: 1000,
      }),
    ).toBe('outage');
  });

  test('outage when consecutive failures are at least 50', () => {
    expect(
      calculatePublicStatus({
        successRate1h: 99,
        successRate24h: 99,
        consecutiveFailures: 50,
        requests1h: 100,
        requests24h: 1000,
      }),
    ).toBe('outage');
  });

  test('no_data when both recent windows have no requests', () => {
    expect(
      calculatePublicStatus({
        successRate1h: null,
        successRate24h: null,
        consecutiveFailures: 0,
        requests1h: 0,
        requests24h: 0,
      }),
    ).toBe('no_data');
  });
});

describe('public status formatting helpers', () => {
  test('formats token counts', () => {
    expect(formatTokenCount(null)).toBe('—');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1200)).toBe('1.2K');
    expect(formatTokenCount(1_400_000)).toBe('1.4M');
    expect(formatTokenCount(1_400_000_000)).toBe('1.4B');
  });

  test('formats latency values', () => {
    expect(formatLatencyMs(null)).toBe('—');
    expect(formatLatencyMs(999)).toBe('999ms');
    expect(formatLatencyMs(1200)).toBe('1.2s');
  });
});

describe('getPublicStatusSnapshot schema downgrade', () => {
  test('request_logs without model does not throw and returns no_data', async () => {
    await withTempStatusDb((db, nowSec) => {
      db.exec('CREATE TABLE request_logs (id INTEGER PRIMARY KEY, ts INTEGER, status INTEGER)');
      db.prepare('INSERT INTO request_logs (ts, status) VALUES (?, ?)').run(nowSec, 200);
    }, async (snapshot) => {
      expect(snapshot.services.every((service) => service.status === 'no_data')).toBe(true);
    });
  });

  test('request_logs without status does not throw and returns no_data', async () => {
    await withTempStatusDb((db, nowSec) => {
      db.exec('CREATE TABLE request_logs (id INTEGER PRIMARY KEY, ts INTEGER, model TEXT)');
      db.prepare('INSERT INTO request_logs (ts, model) VALUES (?, ?)').run(nowSec, 'gpt-4o');
    }, async (snapshot) => {
      const gpt = snapshot.services.find((service) => service.key === 'gpt');
      expect(gpt?.status).toBe('no_data');
      expect(gpt?.requests24h).toBe(0);
    });
  });

  test('conversation_logs without token fields keeps tokens24h null', async () => {
    await withTempStatusDb(
      (_db) => undefined,
      async (snapshot) => {
        const gpt = snapshot.services.find((service) => service.key === 'gpt');
        expect(gpt?.tokens24h).toBeNull();
        expect(gpt?.p95LatencyMs).toBe(123);
      },
      (db, nowSec) => {
        db.exec('CREATE TABLE conversation_logs (ts INTEGER, model TEXT, duration_ms INTEGER)');
        db.prepare('INSERT INTO conversation_logs (ts, model, duration_ms) VALUES (?, ?, ?)').run(
          nowSec,
          'gpt-4o',
          123,
        );
      },
    );
  });

  test('conversation_logs without duration fields keeps latency null', async () => {
    await withTempStatusDb(
      (_db) => undefined,
      async (snapshot) => {
        const gpt = snapshot.services.find((service) => service.key === 'gpt');
        expect(gpt?.tokens24h).toBe(345);
        expect(gpt?.avgLatencyMs).toBeNull();
        expect(gpt?.p95LatencyMs).toBeNull();
      },
      (db, nowSec) => {
        db.exec('CREATE TABLE conversation_logs (ts INTEGER, model TEXT, total_tokens INTEGER)');
        db.prepare('INSERT INTO conversation_logs (ts, model, total_tokens) VALUES (?, ?, ?)').run(
          nowSec,
          'gpt-4o',
          345,
        );
      },
    );
  });
});

async function withTempStatusDb(
  setupCards: (db: Database.Database, nowSec: number) => void,
  assertSnapshot: (snapshot: Awaited<ReturnType<typeof getPublicStatusSnapshot>>) => Promise<void>,
  setupAudit?: (db: Database.Database, nowSec: number) => void,
) {
  const oldDbPath = process.env.DB_PATH;
  const oldDataDir = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nassa-public-status-'));
  const cardsPath = path.join(dir, 'cards.db');
  const auditPath = path.join(dir, 'audit.db');
  const nowMs = Date.UTC(2026, 5, 19, 1, 0, 0);
  const nowSec = Math.floor(nowMs / 1000);

  try {
    const cardsDb = new Database(cardsPath);
    setupCards(cardsDb, nowSec);
    cardsDb.close();

    if (setupAudit) {
      const auditDb = new Database(auditPath);
      setupAudit(auditDb, nowSec);
      auditDb.close();
    }

    process.env.DB_PATH = cardsPath;
    process.env.DATA_DIR = dir;
    await assertSnapshot(await getPublicStatusSnapshot(nowMs));
  } finally {
    if (oldDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = oldDbPath;
    if (oldDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = oldDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
