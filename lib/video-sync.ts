/**
 * 视频任务状态同步 — 前端轮询和后台 reconcile 共用。
 */
import {
  getVideoTaskByTaskId,
  updateVideoTask,
  type VideoTask,
} from '@/lib/db';
import {
  queryHailuoVideoTask,
  retrieveHailuoFile,
} from '@/lib/minimax-video';
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
    if (task.status === 'Success' && !task.download_url) {
      // 补拉下载地址
      return { task: await pullDownloadUrl(task), settled: false };
    }
    // 已成功: 尝试结算奖励(如果尚未结算)
    if (task.status === 'Success') {
      try { settleInviteReward(task.id); } catch {}
    }
    return { task, settled: false };
  }

  try {
    const remote = await queryHailuoVideoTask(taskId, task.account_index);

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
        error_message: remote.status,
        last_queried_at: Math.floor(Date.now() / 1000),
      });
      return { task: getVideoTaskByTaskId(taskId)!, settled: true };
    }

    // 上游成功
    if (remote.status.toLowerCase().includes('success')) {
      let downloadUrl: string | null = null;
      if (remote.fileId) {
        try {
          const file = await retrieveHailuoFile(remote.fileId, task.account_index);
          downloadUrl = file.downloadUrl;
        } catch {}
      }
      updateVideoTask(taskId, {
        status: 'Success',
        file_id: remote.fileId,
        download_url: downloadUrl,
        last_queried_at: Math.floor(Date.now() / 1000),
      });
      const updated = getVideoTaskByTaskId(taskId)!;
      // 结算邀请奖励
      try { settleInviteReward(updated.id); } catch {}
      return { task: updated, settled: true };
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
  if (!task.file_id) return task;
  try {
    const file = await retrieveHailuoFile(task.file_id, task.account_index);
    updateVideoTask(task.task_id, { download_url: file.downloadUrl });
    task.download_url = file.downloadUrl;
  } catch (e: any) {
    updateVideoTask(task.task_id, {
      last_query_error: `补拉下载地址失败: ${e?.message || e}`,
      last_queried_at: Math.floor(Date.now() / 1000),
    });
  }
  return getVideoTaskByTaskId(task.task_id)!;
}
