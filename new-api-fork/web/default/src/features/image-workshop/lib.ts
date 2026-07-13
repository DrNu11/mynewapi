/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { t } from 'i18next'
import type { ApiKey } from '@/features/keys/types'
import type {
  GeneratedImage,
  ImageGenerationResponse,
  ImageModelId,
  ImageRatio,
  ImageRatioId,
} from './types'

export const IMAGE_RATIOS: ImageRatio[] = [
  { id: 'auto', label: 'Auto', hint: '由模型决定', width: 1, height: 1 },
  { id: '1:1', label: '1:1', hint: '头像 / 方图', width: 1, height: 1 },
  { id: '16:9', label: '16:9', hint: '横幅 / 桌面', width: 16, height: 9 },
  { id: '9:16', label: '9:16', hint: '手机 / 封面', width: 9, height: 16 },
  { id: '4:5', label: '4:5', hint: '社交媒体', width: 4, height: 5 },
  { id: '3:2', label: '3:2', hint: '摄影横图', width: 3, height: 2 },
  { id: '2:3', label: '2:3', hint: '海报竖图', width: 2, height: 3 },
  { id: '4:3', label: '4:3', hint: '演示配图', width: 4, height: 3 },
]

const STANDARD_SIZES: Record<Exclude<ImageRatioId, 'auto'>, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x864',
  '9:16': '864x1536',
  '4:5': '1024x1280',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '4:3': '1365x1024',
}

const FOUR_K_SIZES: Record<Exclude<ImageRatioId, 'auto'>, string> = {
  '1:1': '4096x4096',
  '16:9': '4096x2304',
  '9:16': '2304x4096',
  '4:5': '3277x4096',
  '3:2': '4096x2731',
  '2:3': '2731x4096',
  '4:3': '4096x3072',
}

export function getImageSize(
  model: ImageModelId,
  ratio: ImageRatioId
): string | undefined {
  if (ratio === 'auto') return undefined
  return model === 'gpt-image-2-4k'
    ? FOUR_K_SIZES[ratio]
    : STANDARD_SIZES[ratio]
}

export function tokenSupportsModel(
  token: ApiKey,
  model: ImageModelId
): boolean {
  if (!token.model_limits_enabled) return true
  return (token.model_limits ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(model)
}

export function getTokenUnavailableReason(
  token: ApiKey,
  model: ImageModelId,
  nowSeconds = Math.floor(Date.now() / 1000)
): string | undefined {
  if (token.status !== 1) return t('API key is disabled')
  if (token.expired_time !== -1 && token.expired_time <= nowSeconds) {
    return t('API key has expired')
  }
  if (!token.unlimited_quota && token.remain_quota <= 0) {
    return t('API key quota is exhausted')
  }
  if (!tokenSupportsModel(token, model)) {
    return t('API key does not support {{model}}', { model })
  }
  return undefined
}

export function normalizeBearerKey(key: string): string {
  return key.startsWith('sk-') ? key : `sk-${key}`
}

export function parseGeneratedImages(
  response: ImageGenerationResponse
): GeneratedImage[] {
  return (response.data ?? []).flatMap((item, index) => {
    const src = item.b64_json
      ? `data:image/png;base64,${item.b64_json}`
      : item.url
    if (!src) return []
    return [
      {
        id: `${response.created ?? Date.now()}-${index}`,
        src,
        revisedPrompt: item.revised_prompt,
      },
    ]
  })
}

export function getImageAspectRatio(ratio: ImageRatioId): string {
  const item = IMAGE_RATIOS.find((candidate) => candidate.id === ratio)
  return `${item?.width ?? 1} / ${item?.height ?? 1}`
}
