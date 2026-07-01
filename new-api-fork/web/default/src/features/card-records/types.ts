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

export type CardRecordItem = {
  created_at: number
  model_name: string
  status: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  quota: number
  request_id_short: string
  error_summary: string
}

export type CardRecordMeta = {
  code_masked: string
  category: string
  plan: string
  plan_days: number
  status: string
  activated_at: number
  expires_at: number
}

export type CardRecordsPage = {
  page: number
  page_size: number
  total: number
  items: CardRecordItem[]
}

export type CardRecordsData = {
  card: CardRecordMeta
  records: CardRecordsPage
}

export type CardRecordsQueryResponse = {
  success: boolean
  message?: string
  data?: CardRecordsData
}
