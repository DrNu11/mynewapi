import { t } from 'i18next'
import type { ApiKey } from '@/features/keys/types'
import type { VideoModelId, VideoTask } from './types'

export function tokenSupportsVideoModel(
  token: ApiKey,
  model: VideoModelId
): boolean {
  if (!token.model_limits_enabled) return true
  return (token.model_limits ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(model)
}

export function getVideoTokenUnavailableReason(
  token: ApiKey,
  model: VideoModelId,
  nowSeconds = Math.floor(Date.now() / 1000)
): string | undefined {
  if (token.status !== 1) return t('API key is disabled')
  if (token.expired_time !== -1 && token.expired_time <= nowSeconds) {
    return t('API key has expired')
  }
  if (!token.unlimited_quota && token.remain_quota <= 0) {
    return t('API key quota is exhausted')
  }
  if (!tokenSupportsVideoModel(token, model)) {
    return t('API key does not support {{model}}', { model })
  }
  return undefined
}

export function isVideoTaskDone(task: VideoTask): boolean {
  return ['completed', 'failed'].includes(task.status)
}

export function getVideoUrl(task: VideoTask): string | undefined {
  return task.metadata?.url
}

export function videoModelRequiresReference(model: VideoModelId): boolean {
  return model === 'MiniMax-Hailuo-2.3-Fast'
}
