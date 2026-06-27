/**
 * 视频任务状态同步 — 前端轮询和后台 reconcile 共用。
 */
import {
  getVideoTaskByTaskId,
  updateVideoTask,
  type VideoTask,
} from '@/lib/db';
import { queryVideoTask } from '@/lib/video-provider';
import { settleInviteReward } from '@/lib/invite-reward';

export interface SyncResult {
  task: VideoTask;
  settled: boolean;
}

export async function syncVideoTask(taskId: string): Promise<SyncResult> {
  const task = getVideoTaskByTaskId(taskId);
  if (!task) throw new Error(`任务 ${taskId} 不存在`);

  const terminalStatuses = ['Success', 'Failed', 'Cancelled'];
  if (terminalStatuses.includes(task.status)) {
    // 先幂等结算奖励,不因 download_url 补拉卡住
    if (task.status === 'Success') {
      try {
        settleInviteReward(task.id);
      } catch (e) {
        console.error('[invite-reward] settlement failed', e);
      }
    }
    // 再按需补拉下载地址
    let current = task;
    if (task.status === 'Success' && !task.download_url) {
      current = await pullDownloadUrl(task);
    }
    return { task: current, settled: task.status === 'Success' };
  }

  try {
    const remote = await queryVideoTask(taskId, task.account_index);

    // 上游处理中
    if (remote.status === 'Processing' || remote.status === 'Submitted' || remote.status === 'Queued') {
      updateVideoTask(taskId, {
        status: remote.status,
        last_queried_at: Math.floor(Date.now() / 1000),
      });
      return { task: getVideoTaskByTaskId(taskId)!, settled: false };
    }

    // 上游明确失败
    const failedStatuses = ['Fail', 'Failed', 'Error', 'Cancelled'];
    if (failedStatuses.some((s) => remote.status.toLowerCase().includes(s.toLowerCase()))) {
      updateVideoTask(taskId, {
        status: 'Failed',
        error_message: remote.errorMessage || remote.status,
        last_queried_at: Math.floor(Date.now() / 1000),
      });
      return { task: getVideoTaskByTaskId(taskId)!, settled: true };
    }

    // 上游成功
    if (remote.status.toLowerCase().includes('success')) {
      updateVideoTask(taskId, {
        status: 'Success',
        file_id: remote.fileId,
        download_url: remote.downloadUrl,
        last_queried_at: Math.floor(Date.now() / 1000),
      });
      const updated = getVideoTaskByTaskId(taskId)!;
      // 结算邀请奖励 — 允许失败,记录日志供下一轮 reconcile 重试
      try {
        settleInviteReward(updated.id);
        return { task: updated, settled: true };
      } catch (e) {
        console.error('[invite-reward] settlement failed', e);
        return { task: updated, settled: false };
      }
    }

    // 未知状态,仅更新 last_queried_at
    updateVideoTask(taskId, {
      last_queried_at: Math.floor(Date.now() / 1000),
    });
    return { task: getVideoTaskByTaskId(taskId)!, settled: false };
  } catch (e: any) {
    // 查询临时异常: 主状态不变,记录诊断字段
    const now = Math.floor(Date.now() / 1000);
    updateVideoTask(taskId, {
      last_query_error: e?.message || '查询视频任务失败',
      query_error_count: task.query_error_count + 1,
      last_queried_at: now,
    });
    return { task: getVideoTaskByTaskId(taskId)!, settled: false };
  }
}

async function pullDownloadUrl(task: VideoTask): Promise<VideoTask> {
  try {
    const remote = await queryVideoTask(task.task_id, task.account_index);
    if (remote.downloadUrl) {
      updateVideoTask(task.task_id, {
        file_id: remote.fileId,
        download_url: remote.downloadUrl,
      });
    }
  } catch (e: any) {
    console.error('[video-sync] pull download url failed', e);
    updateVideoTask(task.task_id, {
      last_query_error: `补拉下载地址失败: ${e?.message || e}`,
      last_queried_at: Math.floor(Date.now() / 1000),
    });
  }
  return getVideoTaskByTaskId(task.task_id)!;
}
