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
import { fetchTokenKey, getApiKeys } from '@/features/keys/api'
import type { ApiKey } from '@/features/keys/types'
import { getImageSize, normalizeBearerKey, parseGeneratedImages } from './lib'
import type {
  GeneratedImage,
  ImageGenerationInput,
  ImageGenerationResponse,
} from './types'

const PAGE_SIZE = 100
const MAX_TOKEN_PAGES = 10

export async function getAllApiKeys(): Promise<ApiKey[]> {
  const first = await getApiKeys({ p: 1, size: PAGE_SIZE })
  if (!first.success)
    throw new Error(first.message || t('Failed to load API keys'))

  const items = [...(first.data?.items ?? [])]
  const total = first.data?.total ?? items.length
  const pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_TOKEN_PAGES)

  for (let page = 2; page <= pages; page += 1) {
    const response = await getApiKeys({ p: page, size: PAGE_SIZE })
    if (!response.success) {
      throw new Error(
        response.message || t('Failed to load API key page {{page}}', { page })
      )
    }
    items.push(...(response.data?.items ?? []))
  }

  return items
}

export async function getTokenBearer(tokenId: number): Promise<string> {
  const response = await fetchTokenKey(tokenId)
  const key = response.data?.key
  if (!response.success || !key) {
    throw new Error(
      response.message || t('Failed to read the selected API key')
    )
  }
  return normalizeBearerKey(key)
}

function buildJsonBody(input: ImageGenerationInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt.trim(),
    n: input.count,
    quality: input.quality,
    response_format: 'b64_json',
  }
  const size = getImageSize(input.model, input.ratio)
  if (size) body.size = size
  return body
}

function buildEditBody(input: ImageGenerationInput): FormData {
  const form = new FormData()
  form.set('model', input.model)
  form.set('prompt', input.prompt.trim())
  form.set('n', String(input.count))
  form.set('quality', input.quality)
  form.set('response_format', 'b64_json')
  const size = getImageSize(input.model, input.ratio)
  if (size) form.set('size', size)
  if (input.referenceImage) form.set('image', input.referenceImage)
  return form
}

export async function createWorkshopImages(
  input: ImageGenerationInput,
  signal?: AbortSignal
): Promise<GeneratedImage[]> {
  const bearer = await getTokenBearer(input.tokenId)
  const editing = Boolean(input.referenceImage)
  const response = await fetch(
    editing ? '/v1/images/edits' : '/v1/images/generations',
    {
      method: 'POST',
      headers: editing
        ? { Authorization: `Bearer ${bearer}` }
        : {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
          },
      body: editing
        ? buildEditBody(input)
        : JSON.stringify(buildJsonBody(input)),
      signal,
    }
  )

  const payload = (await response
    .json()
    .catch(() => ({}))) as ImageGenerationResponse
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error?.message ||
        t('Image generation failed (HTTP {{status}})', {
          status: response.status,
        })
    )
  }

  const images = parseGeneratedImages(payload)
  if (images.length === 0) {
    throw new Error(t('The API returned no displayable images'))
  }
  return images
}
