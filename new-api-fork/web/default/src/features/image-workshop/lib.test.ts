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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  getImageAspectRatio,
  getImageSize,
  normalizeBearerKey,
  parseGeneratedImages,
} from './lib'

describe('image workshop request helpers', () => {
  test('maps standard and 4K ratios to the expected request sizes', () => {
    assert.equal(getImageSize('gpt-image-2', '16:9'), '1536x864')
    assert.equal(getImageSize('gpt-image-2-4k', '16:9'), '4096x2304')
    assert.equal(getImageSize('gpt-image-2', 'auto'), undefined)
  })

  test('normalizes API keys without duplicating the sk prefix', () => {
    assert.equal(normalizeBearerKey('plain-key'), 'sk-plain-key')
    assert.equal(normalizeBearerKey('sk-ready-key'), 'sk-ready-key')
  })

  test('parses base64 and URL image responses and ignores empty records', () => {
    const images = parseGeneratedImages({
      created: 123,
      data: [
        { b64_json: 'YWJj' },
        { url: 'https://example.test/image.png' },
        {},
      ],
    })

    assert.deepEqual(images, [
      {
        id: '123-0',
        src: 'data:image/png;base64,YWJj',
        revisedPrompt: undefined,
      },
      {
        id: '123-1',
        src: 'https://example.test/image.png',
        revisedPrompt: undefined,
      },
    ])
  })

  test('returns the selected display aspect ratio', () => {
    assert.equal(getImageAspectRatio('9:16'), '9 / 16')
  })
})
