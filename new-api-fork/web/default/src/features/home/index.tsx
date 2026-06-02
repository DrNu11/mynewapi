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
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { Markdown } from '@/components/ui/markdown'
import { PublicLayout } from '@/components/layout'
import { Features, Hero } from './components'
import { useHomePageContent } from './hooks'

export function Home() {
  const { t } = useTranslation()
  const { auth } = useAuthStore()
  const isAuthenticated = !!auth.user
  const { content, isLoaded, isUrl } = useHomePageContent()

  if (!isLoaded) {
    return (
      <PublicLayout
        showMainContainer={false}
        logo={<NassaLogo />}
        siteName='NassaAPI'
        headerProps={{ className: 'nassa-apple-header' }}
      >
        <main className='nassa-apple-home dark flex min-h-screen items-center justify-center bg-[#000000] text-[#86868B]'>
          <div>{t('Loading...')}</div>
        </main>
      </PublicLayout>
    )
  }

  if (content) {
    return (
      <PublicLayout
        showMainContainer={false}
        logo={<NassaLogo />}
        siteName='NassaAPI'
        headerProps={{ className: 'nassa-apple-header' }}
      >
        <main className='nassa-apple-home dark min-h-screen overflow-x-hidden bg-[#000000] text-[#F5F5F7]'>
          {isUrl ? (
            <iframe
              src={content}
              className='h-screen w-full border-none'
              title={t('Custom Home Page')}
            />
          ) : (
            <div className='container mx-auto py-8'>
              <Markdown className='custom-home-content'>{content}</Markdown>
            </div>
          )}
        </main>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout
      showMainContainer={false}
      logo={<NassaLogo />}
      siteName='NassaAPI'
      headerProps={{ className: 'nassa-apple-header' }}
    >
      <div className='nassa-apple-home dark min-h-screen bg-[#000000] text-[#F5F5F7]'>
        <main className='overflow-x-hidden'>
          <Hero isAuthenticated={isAuthenticated} />
          <Features />
        </main>
        <NassaFooter />
      </div>
    </PublicLayout>
  )
}

function NassaFooter() {
  return (
    <footer className='relative z-10 border-t border-white/8 bg-[#000000] px-6 py-10 text-[#86868B]'>
      <div className='mx-auto flex max-w-7xl flex-col gap-6 text-xs sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex items-center gap-3'>
          <NassaLogo />
          <span className='font-medium text-[#F5F5F7]'>NassaAPI</span>
          <span>AI 接口中转站</span>
        </div>
        <p>© {new Date().getFullYear()} NassaAPI. All rights reserved.</p>
      </div>
    </footer>
  )
}

function NassaLogo() {
  return (
    <span
      aria-hidden
      className='flex size-7 items-center justify-center text-base font-semibold text-[#8B5CF6]'
      style={{ color: '#8B5CF6' }}
    >
      N
    </span>
  )
}
