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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNotificationStore } from '@/stores/notification-store'
import { useAuthStore } from '@/stores/auth-store'
import {
  acknowledgeUserWarning,
  getNotice,
  getUserWarnings,
} from '@/lib/api'
import { useStatus } from '@/hooks/use-status'

type NotificationTab = 'notice' | 'announcements' | 'warnings'

function hashString(input: string): string {
  let hash = 0
  if (!input) return '0'

  for (let i = 0; i < input.length; i += 1) {
    const chr = input.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }

  return hash.toString(36)
}

/**
 * Generate a unique key for an announcement
 * Prefer backend id, fall back to a content hash so edits register
 */
function getAnnouncementKey(item: Record<string, unknown>): string {
  if (!item) return ''

  if (item.id !== undefined && item.id !== null) {
    return `id:${item.id}`
  }

  const fingerprint = JSON.stringify({
    publishDate: (item?.publishDate as string) || '',
    content: ((item?.content as string) || '').trim(),
    extra: ((item?.extra as string) || '').trim(),
    type: (item?.type as string) || '',
    title: ((item?.title as string) || '').trim(),
    link: ((item?.link as string) || '').trim(),
  })
  return `hash:${hashString(fingerprint)}`
}

/**
 * Hook to manage notifications (Notice + Announcements)
 * Provides unread counts and read status management
 */
export function useNotifications() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<NotificationTab>('notice')
  const lastAutoOpenedWarningRef = useRef('')
  const authUser = useAuthStore((state) => state.auth.user)

  // Fetch Notice from API
  const {
    data: noticeResponse,
    isLoading: noticeLoading,
    refetch: refetchNotice,
  } = useQuery({
    queryKey: ['notice'],
    queryFn: getNotice,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Fetch Announcements from status
  const { status, loading: statusLoading } = useStatus()
  const announcementsEnabled = status?.announcements_enabled ?? false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const announcements: Record<string, unknown>[] = announcementsEnabled
    ? ((status?.announcements || []) as Record<string, unknown>[]).slice(0, 20)
    : []

  const {
    data: userWarningsResponse,
    isLoading: userWarningsLoading,
    refetch: refetchUserWarnings,
  } = useQuery({
    queryKey: ['user-warnings', authUser?.id],
    queryFn: getUserWarnings,
    enabled: Boolean(authUser?.id),
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60,
  })

  const userWarnings = userWarningsResponse?.success
    ? userWarningsResponse.data || []
    : []

  // Notification store
  const {
    lastReadNotice,
    markNoticeRead,
    markAnnouncementsRead,
    isAnnouncementRead,
    isNoticeClosed,
    setClosedUntilDate,
  } = useNotificationStore()

  // Extract notice content
  const noticeContent = noticeResponse?.success
    ? (noticeResponse.data || '').trim()
    : ''

  // Calculate unread counts
  const unreadCounts = useMemo(() => {
    const noticeUnread =
      noticeContent && noticeContent !== lastReadNotice ? 1 : 0

    const announcementsUnread = announcements.filter(
      (item: Record<string, unknown>) => {
        const key = getAnnouncementKey(item)
        return !isAnnouncementRead(key)
      }
    ).length

    return {
      notice: noticeUnread,
      announcements: announcementsUnread,
      warnings: userWarnings.length,
      total: noticeUnread + announcementsUnread + userWarnings.length,
    }
  }, [
    noticeContent,
    lastReadNotice,
    announcements,
    isAnnouncementRead,
    userWarnings.length,
  ])

  const firstWarningKey = userWarnings[0] ? String(userWarnings[0].id) : ''

  useEffect(() => {
    if (!firstWarningKey || dialogOpen) return
    if (lastAutoOpenedWarningRef.current === firstWarningKey) return
    lastAutoOpenedWarningRef.current = firstWarningKey
    setActiveTab('warnings')
    setDialogOpen(true)
  }, [firstWarningKey, dialogOpen])

  // Handle dialog open
  const handleOpenDialog = (tab?: NotificationTab) => {
    // Mark Notice as read when opening dialog
    if (noticeContent) {
      markNoticeRead(noticeContent)
    }

    setActiveTab(tab || (userWarnings.length > 0 ? 'warnings' : 'notice'))
    setDialogOpen(true)
  }

  // Handle tab change - mark announcements as read when switching to that tab
  const handleTabChange = (tab: NotificationTab) => {
    setActiveTab(tab)

    if (tab === 'announcements' && announcements.length > 0) {
      const allKeys = announcements.map((item: Record<string, unknown>) =>
        getAnnouncementKey(item)
      )
      markAnnouncementsRead(allKeys)
    }
  }

  const handleAcknowledgeWarning = async (id: number) => {
    const res = await acknowledgeUserWarning(id)
    if (res?.success) {
      await refetchUserWarnings()
    }
  }

  // Handle "Close Today" action
  const handleCloseToday = () => {
    const today = new Date().toDateString()
    setClosedUntilDate(today)
    setDialogOpen(false)
  }

  return {
    // Data
    notice: noticeContent,
    announcements,
    userWarnings,
    loading: noticeLoading || statusLoading || userWarningsLoading,

    // Unread counts
    unreadCount: unreadCounts.total,
    unreadNoticeCount: unreadCounts.notice,
    unreadAnnouncementsCount: unreadCounts.announcements,
    unreadWarningCount: unreadCounts.warnings,

    // Dialog state
    dialogOpen,
    setDialogOpen,
    activeTab,
    setActiveTab: handleTabChange,

    // Actions
    openDialog: handleOpenDialog,
    closeDialog: () => setDialogOpen(false),
    closeToday: handleCloseToday,
    acknowledgeWarning: handleAcknowledgeWarning,
    refetchNotice,

    // Status
    isNoticeClosed: isNoticeClosed(),
  }
}
