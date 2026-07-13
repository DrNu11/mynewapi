import type { ApiKey } from '@/features/keys/types'

export const VIDEO_MODEL_IDS = [
  'MiniMax-Hailuo-2.3',
  'MiniMax-Hailuo-2.3-Fast',
] as const

export type VideoModelId = (typeof VIDEO_MODEL_IDS)[number]
export type VideoDuration = 6 | 10
export type VideoResolution = '768P' | '1080P'

export type VideoGenerationInput = {
  tokenId: number
  model: VideoModelId
  prompt: string
  duration: VideoDuration
  resolution: VideoResolution
  referenceImage?: File | null
}

export type VideoTask = {
  id: string
  model?: string
  status: string
  progress: number
  metadata?: { url?: string }
  error?: { message?: string; code?: string }
}

export type VideoWorkshopToken = ApiKey & {
  usable: boolean
  unavailableReason?: string
}
