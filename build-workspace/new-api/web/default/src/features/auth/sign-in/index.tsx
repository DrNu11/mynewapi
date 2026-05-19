import { Link, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useStatus } from '@/hooks/use-status'
import { AuthLayout } from '../auth-layout'
import { TermsFooter } from '../components/terms-footer'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { t } = useTranslation()
  const { redirect, expired } = useSearch({ from: '/(auth)/sign-in' })
  const { status } = useStatus()
  const isExpired = expired === true || expired === 'true' || expired === '1'

  return (
    <AuthLayout>
      <section className='relative overflow-hidden rounded-[2.25rem] border border-white/12 bg-white/[0.055] p-6 shadow-[0_40px_140px_rgba(0,0,0,0.65)] backdrop-blur-2xl sm:p-8'>
        <div className='pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent' />
        <div className='pointer-events-none absolute -top-24 left-1/2 h-48 w-64 -translate-x-1/2 rounded-full bg-white/10 blur-3xl' />
        <div className='pointer-events-none absolute -right-20 top-8 h-52 w-52 rounded-full bg-blue-500/12 blur-3xl' />

        <div className='relative space-y-7'>
          <div className='space-y-4 text-center'>
            <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-[1.35rem] border border-white/15 bg-gradient-to-b from-white/24 to-white/7 shadow-2xl shadow-white/10 backdrop-blur-xl'>
              <span className='h-5 w-5 rounded-full border-2 border-white/90 shadow-[0_0_30px_rgba(255,255,255,0.45)]' />
            </div>
            <div className='space-y-2'>
              <h2 className='text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl'>
                {t('Sign in')}
              </h2>
              {!status?.self_use_mode_enabled && (
                <p className='text-sm leading-6 text-white/55'>
                  {t("Don't have an account?")}{' '}
                  <Link
                    to='/sign-up'
                    className='font-semibold text-white transition-colors hover:text-white/75'
                  >
                    {t('Sign up')}
                  </Link>
                </p>
              )}
            </div>
          </div>

          {isExpired ? (
            <div className='rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm font-medium text-amber-100 shadow-sm'>
              {t('Session expired!')}
            </div>
          ) : null}

          <UserAuthForm redirectTo={redirect} />

          <TermsFooter
            variant='sign-in'
            status={status}
            className='text-center text-xs text-white/38'
          />
        </div>
      </section>
    </AuthLayout>
  )
}
