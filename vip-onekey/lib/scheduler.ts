// Background scheduler — periodically check revert_tasks and revert user.group when due.
// Runs in-process: started by app/api/activate/route.ts on first invocation.
import { listDueRevertTasks, finishRevertTask, markCardExpired } from './db';
import { getUserById, updateUserGroup } from './newapi';

let started = false;
let timer: NodeJS.Timeout | null = null;

const TICK_SECONDS = Number(process.env.REVERT_TICK_SECONDS || 60);

async function tick(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const tasks = listDueRevertTasks(now);
  for (const t of tasks) {
    try {
      const user = await getUserById(t.user_id);
      if (!user) {
        finishRevertTask(t.id, 'skipped', 'user not found');
        continue;
      }
      if (user.group !== t.target_group) {
        // Group changed since activation — don't override admin's manual change.
        finishRevertTask(t.id, 'skipped', `group is ${user.group}, not ${t.target_group}`);
        markCardExpired(t.card_code);
        continue;
      }
      await updateUserGroup(t.user_id, t.original_group);
      finishRevertTask(t.id, 'done');
      markCardExpired(t.card_code);
      console.log(`[revert] user ${t.user_id} (${t.email}) ${t.target_group} -> ${t.original_group}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      finishRevertTask(t.id, 'failed', msg.slice(0, 500));
      console.error(`[revert] task ${t.id} failed:`, msg);
    }
  }
}

export function ensureScheduler(): void {
  if (started) return;
  started = true;
  // Run immediately on startup, then on interval
  tick().catch((e) => console.error('[revert] initial tick error:', e));
  timer = setInterval(() => {
    tick().catch((e) => console.error('[revert] tick error:', e));
  }, TICK_SECONDS * 1000);
  console.log(`[revert] scheduler started (tick=${TICK_SECONDS}s)`);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
