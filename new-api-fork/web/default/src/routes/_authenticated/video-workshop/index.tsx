import { createFileRoute, redirect } from '@tanstack/react-router'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'
import { VideoWorkshop } from '@/features/video-workshop'

export const Route = createFileRoute('/_authenticated/video-workshop/')({
  beforeLoad: () => {
    if (!isSidebarModuleEnabled('chat', 'video_workshop')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: VideoWorkshop,
})
