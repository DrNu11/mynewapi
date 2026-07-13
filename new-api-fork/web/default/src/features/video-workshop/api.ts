import { t } from 'i18next'
import { getAllApiKeys, getTokenBearer } from '@/features/image-workshop/api'
import { getVideoUrl, isVideoTaskDone } from './lib'
import type { VideoGenerationInput, VideoTask } from './types'

export { getAllApiKeys }

const POLL_INTERVAL_MS = 5000
const MAX_POLLS = 360

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () =>
      reject(new Error(t('Failed to read reference image')))
    reader.readAsDataURL(file)
  })
}

async function readTaskResponse(response: Response): Promise<VideoTask> {
  const payload = (await response.json().catch(() => ({}))) as VideoTask & {
    task_id?: string
    error?: { message?: string; code?: string }
  }
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error?.message ||
        t('Video request failed (HTTP {{status}})', { status: response.status })
    )
  }
  const id = payload.id || payload.task_id
  if (!id) throw new Error(t('The API returned no video task ID'))
  return { ...payload, id }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

export async function createWorkshopVideo(
  input: VideoGenerationInput,
  onProgress: (task: VideoTask) => void,
  signal?: AbortSignal
): Promise<VideoTask> {
  const bearer = await getTokenBearer(input.tokenId)
  const metadata: Record<string, unknown> = {
    prompt_optimizer: true,
    fast_pretreatment: input.model.endsWith('-Fast'),
  }
  if (input.referenceImage) {
    metadata.first_frame_image = await fileToDataUrl(input.referenceImage)
  }

  const submitted = await readTaskResponse(
    await fetch('/v1/videos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt.trim(),
        duration: input.duration,
        size: input.resolution,
        metadata,
      }),
      signal,
    })
  )
  onProgress(submitted)

  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    if (isVideoTaskDone(submitted)) return submitted
    await wait(POLL_INTERVAL_MS, signal)
    const task = await readTaskResponse(
      await fetch(`/v1/videos/${encodeURIComponent(submitted.id)}`, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal,
      })
    )
    onProgress(task)
    if (task.status === 'failed') {
      throw new Error(task.error?.message || t('Video generation failed'))
    }
    if (task.status === 'completed') {
      if (!getVideoUrl(task)) {
        task.metadata = {
          ...task.metadata,
          url: `/v1/videos/${encodeURIComponent(task.id)}/content`,
        }
      }
      return task
    }
  }
  throw new Error(t('Video generation timed out'))
}
