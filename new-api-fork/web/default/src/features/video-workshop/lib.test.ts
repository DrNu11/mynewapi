import { describe, expect, it } from 'bun:test'
import type { ApiKey } from '@/features/keys/types'
import {
  getVideoUrl,
  isVideoTaskDone,
  tokenSupportsVideoModel,
  videoModelRequiresReference,
} from './lib'

const token = {
  id: 1,
  status: 1,
  expired_time: -1,
  unlimited_quota: true,
  remain_quota: 0,
  model_limits_enabled: true,
  model_limits: 'MiniMax-Hailuo-2.3',
} as ApiKey

describe('video workshop helpers', () => {
  it('checks model limits', () => {
    expect(tokenSupportsVideoModel(token, 'MiniMax-Hailuo-2.3')).toBe(true)
    expect(tokenSupportsVideoModel(token, 'MiniMax-Hailuo-2.3-Fast')).toBe(
      false
    )
  })

  it('recognizes terminal tasks and result URLs', () => {
    expect(
      isVideoTaskDone({ id: '1', status: 'completed', progress: 100 })
    ).toBe(true)
    expect(
      isVideoTaskDone({ id: '1', status: 'in_progress', progress: 50 })
    ).toBe(false)
    expect(
      getVideoUrl({
        id: '1',
        status: 'completed',
        progress: 100,
        metadata: { url: '/v1/videos/1/content' },
      })
    ).toBe('/v1/videos/1/content')
  })

  it('requires a first frame for the fast model', () => {
    expect(videoModelRequiresReference('MiniMax-Hailuo-2.3-Fast')).toBe(true)
    expect(videoModelRequiresReference('MiniMax-Hailuo-2.3')).toBe(false)
  })
})
