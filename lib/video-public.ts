import type { VideoTask } from '@/lib/db';

export interface PublicVideoTask {
  task_id: string;
  model: string;
  prompt: string;
  duration: number;
  resolution: string;
  status: string;
  download_url: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export function toPublicVideoTask(task: VideoTask): PublicVideoTask {
  return {
    task_id: task.task_id,
    model: task.model,
    prompt: task.prompt,
    duration: task.duration,
    resolution: task.resolution,
    status: task.status,
    download_url: task.download_url,
    error_message: task.error_message,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}
