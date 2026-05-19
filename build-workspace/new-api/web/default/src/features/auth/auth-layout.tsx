import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useSystemConfig } from '@/hooks/use-system-config'
import { Skeleton } from '@/components/ui/skeleton'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()

  return (
    <div className='relative min-h-svh overflow-hidden bg-[#050505] text-white'>
      <div className='pointer-events-none absolute inset-0'>
        <div className='absolute inset-0 bg-[radial-gradient(circle_at_50%_-18%,rgba(255,255,255,0.2),transparent_34%),linear-gradient(180deg,#111113_0%,#050505_44%,#000_100%)]' />
        <div className='absolute top-[-18rem] left-1/2 h-[52rem] w-[52rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(148,163,184,0.32),transparent_62%)] blur-3xl' />
        <div className='absolute top-24 right-[-14rem] h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.22),transparent_68%)] blur-3xl' />
        <div className='absolute bottom-[-18rem] left-[-10rem] h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.14),transparent_70%)] blur-3xl' />
        <div className='absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.08),transparent_22%,rgba(0,0,0,0.58)_76%,rgba(0,0,0,0.9))]' />
        <div className='absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.026)_1px,transparent_1px)] bg-[size:64px_64px] opacity-30' />
      </div>

      <Link
        to='/'
        className='absolute top-5 left-5 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 shadow-2xl shadow-black/30 backdrop-blur-2xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.1] sm:top-8 sm:left-8'
      >
        <div className='relative h-8 w-8 overflow-hidden rounded-full shadow-sm'>
          {loading ? (
            <Skeleton className='absolute inset-0 rounded-full' />
          ) : (
            <img
              src={logo}
              alt={t('Logo')}
              className='h-8 w-8 object-cover'
            />
          )}
        </div>
        {loading ? (
          <Skeleton className='h-6 w-24' />
        ) : (
          <h1 className='text-base font-semibold tracking-tight text-white sm:text-lg'>
            {systemName}
          </h1>
        )}
      </Link>

      <main className='relative z-10 flex min-h-svh items-center justify-center px-4 py-24 sm:px-6'>
        <div className='w-full max-w-[460px] animate-in fade-in slide-in-from-bottom-4 duration-700'>
          {children}
        </div>
      </main>
    </div>
  )
}
