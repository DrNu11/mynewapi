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
import type { ApiKey } from '@/features/keys/types'

export const IMAGE_MODEL_IDS = ['gpt-image-2', 'gpt-image-2-4k'] as const
export type ImageModelId = (typeof IMAGE_MODEL_IDS)[number]

export const IMAGE_QUALITY_IDS = ['auto', 'low', 'medium', 'high'] as const
export type ImageQuality = (typeof IMAGE_QUALITY_IDS)[number]

export type ImageRatioId =
  'auto' | '1:1' | '16:9' | '9:16' | '4:5' | '3:2' | '2:3' | '4:3'

export type ImageRatio = {
  id: ImageRatioId
  label: string
  hint: string
  width: number
  height: number
}

export type ImageGenerationInput = {
  tokenId: number
  model: ImageModelId
  prompt: string
  ratio: ImageRatioId
  quality: ImageQuality
  count: number
  referenceImage?: File | null
}

export type GeneratedImage = {
  id: string
  src: string
  revisedPrompt?: string
}

export type ImageGenerationResponse = {
  created?: number
  data?: Array<{
    b64_json?: string
    url?: string
    revised_prompt?: string
  }>
  usage?: Record<string, unknown>
  error?: {
    message?: string
    code?: string
    param?: string | null
  }
}

export type WorkshopToken = ApiKey & {
  usable: boolean
  unavailableReason?: string
}
