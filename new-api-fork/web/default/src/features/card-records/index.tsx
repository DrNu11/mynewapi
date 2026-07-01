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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  formatLogQuota,
  formatTimestampToDate,
  formatTokens,
} from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionPageLayout } from '@/components/layout'
import { queryCardRecords } from './api'
import type { CardRecordsData } from './types'

const DEFAULT_PAGE_SIZE = 20

export function CardRecords() {
  const { t } = useTranslation()
  const [cardCode, setCardCode] = useState('')
  const [submittedCardCode, setSubmittedCardCode] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<CardRecordsData | null>(null)

  const totalPages = useMemo(() => {
    const total = data?.records.total ?? 0
    return Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE))
  }, [data?.records.total])

  async function runQuery(nextPage = 1, code = cardCode) {
    const normalized = code.trim()
    if (!normalized) {
      setError(t('Please enter card code'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await queryCardRecords({
        card_code: normalized,
        page: nextPage,
        page_size: DEFAULT_PAGE_SIZE,
      })
      if (!result.success) {
        const message = result.message || t('Query failed')
        setError(message)
        setData(null)
        toast.error(message)
        return
      }
      setData(result.data ?? null)
      setSubmittedCardCode(normalized)
      setPage(nextPage)
      if ((result.data?.records.total ?? 0) === 0) {
        setError(t('No card records found'))
      }
    } catch {
      const message = t('Query failed')
      setError(message)
      setData(null)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const records = data?.records.items ?? []

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Card Records')}</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        {t(
          'Enter a weekly or monthly card code to view model call records for the corresponding NewAPI token. Only cards under your account are supported.'
        )}
      </SectionPageLayout.Description>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>{t('Query card records')}</CardTitle>
              <CardDescription>
                {t('Only weekly and monthly cards are supported.')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className='flex flex-col gap-3 sm:flex-row'
                onSubmit={(event) => {
                  event.preventDefault()
                  void runQuery(1)
                }}
              >
                <Input
                  value={cardCode}
                  onChange={(event) => setCardCode(event.target.value)}
                  placeholder={t('Please enter card code')}
                  className='font-mono'
                />
                <Button type='submit' disabled={loading}>
                  {loading ? t('Loading...') : t('Query Records')}
                </Button>
              </form>
              {error && (
                <div className='text-muted-foreground mt-3 text-sm'>
                  {error}
                </div>
              )}
            </CardContent>
          </Card>

          {data?.card && (
            <Card>
              <CardHeader>
                <CardTitle className='flex flex-wrap items-center gap-2'>
                  <span className='font-mono'>{data.card.code_masked}</span>
                  <Badge variant='outline'>{data.card.plan}</Badge>
                  <Badge variant='outline'>{data.card.status}</Badge>
                </CardTitle>
                <CardDescription>
                  {t('Activated at')}:{' '}
                  {formatTimestampToDate(data.card.activated_at)}
                  {' · '}
                  {t('Expires at')}:{' '}
                  {formatTimestampToDate(data.card.expires_at)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className='rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('Time')}</TableHead>
                        <TableHead>{t('Model')}</TableHead>
                        <TableHead>{t('Status')}</TableHead>
                        <TableHead>{t('Input Tokens')}</TableHead>
                        <TableHead>{t('Output Tokens')}</TableHead>
                        <TableHead>{t('Cost')}</TableHead>
                        <TableHead>{t('Request ID')}</TableHead>
                        <TableHead>{t('Error Summary')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            className='text-muted-foreground h-24 text-center'
                          >
                            {t('No card records found')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        records.map((record, index) => (
                          <TableRow key={`${record.request_id_short}-${index}`}>
                            <TableCell className='font-mono text-xs'>
                              {formatTimestampToDate(record.created_at)}
                            </TableCell>
                            <TableCell>{record.model_name || '-'}</TableCell>
                            <TableCell>{record.status || '-'}</TableCell>
                            <TableCell>
                              {formatTokens(record.prompt_tokens)}
                            </TableCell>
                            <TableCell>
                              {formatTokens(record.completion_tokens)}
                            </TableCell>
                            <TableCell>
                              {formatLogQuota(record.quota)}
                            </TableCell>
                            <TableCell className='font-mono text-xs'>
                              {record.request_id_short || '-'}
                            </TableCell>
                            <TableCell className='max-w-[260px] truncate'>
                              {record.error_summary || '-'}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className='mt-4 flex items-center justify-between gap-3'>
                  <div className='text-muted-foreground text-sm'>
                    {t('Page {{current}} of {{total}}', {
                      current: page,
                      total: totalPages,
                    })}
                  </div>
                  <div className='flex gap-2'>
                    <Button
                      variant='outline'
                      disabled={loading || page <= 1}
                      onClick={() => void runQuery(page - 1, submittedCardCode)}
                    >
                      {t('Previous')}
                    </Button>
                    <Button
                      variant='outline'
                      disabled={loading || page >= totalPages}
                      onClick={() => void runQuery(page + 1, submittedCardCode)}
                    >
                      {t('Next')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
