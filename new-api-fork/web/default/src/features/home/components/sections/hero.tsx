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
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  return (
    <section className='relative z-10 flex min-h-[640px] flex-col items-center justify-center overflow-hidden bg-[#000000] px-6 pt-28 pb-16 text-center md:min-h-[760px] md:pt-40 md:pb-24'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(ellipse_70%_48%_at_50%_0%,rgba(130,116,255,0.18),rgba(0,0,0,0)_68%)]'
      />
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-[12%] top-36 -z-10 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent'
      />

      <div className='mx-auto flex max-w-5xl flex-col items-center'>
        <p
          className='landing-animate-fade-up text-sm font-medium tracking-normal text-[#86868B] uppercase opacity-0'
          style={{ animationDelay: '0ms' }}
        >
          PRO-LEVEL AI PROXY
        </p>
        <h1
          className='landing-animate-fade-up mt-5 text-[clamp(4.5rem,13vw,10rem)] leading-[0.9] font-semibold tracking-normal text-[#F5F5F7] opacity-0'
          style={{ animationDelay: '100ms' }}
        >
          NassaAPI
        </h1>
        <p
          className='landing-animate-fade-up mt-6 max-w-2xl text-xl leading-relaxed tracking-normal text-[#86868B] opacity-0 md:text-3xl'
          style={{ animationDelay: '200ms' }}
        >
          让 AI 编程触手可及
        </p>
        <p
          className='landing-animate-fade-up mt-4 max-w-xl text-sm leading-7 text-[#86868B] opacity-0 md:text-base'
          style={{ animationDelay: '300ms' }}
        >
          支持 Claude、GPT、Gemini 与全主流模型，统一 OpenAI 兼容协议，面向开发者的高性能中转网关。
        </p>
        <div
          className='landing-animate-fade-up mt-10 flex flex-col items-center gap-5 opacity-0 sm:flex-row'
          style={{ animationDelay: '400ms' }}
        >
          {props.isAuthenticated ? (
            <Link
              to='/dashboard'
              className='hig-primary-action inline-flex h-12 items-center justify-center rounded-full bg-[#F5F5F7] px-7 text-[15px] font-medium text-[#000000]'
            >
              进入控制台
            </Link>
          ) : (
            <>
              <Link
                to='/sign-up'
                className='hig-primary-action inline-flex h-12 items-center justify-center rounded-full bg-[#F5F5F7] px-7 text-[15px] font-medium text-[#000000]'
              >
                开始使用
              </Link>
              <Link
                to='/pricing'
                className='group inline-flex h-12 items-center justify-center rounded-full px-2 text-[15px] font-medium text-[#F5F5F7]'
              >
                了解更多
                <ArrowRight className='ml-1.5 size-4 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5' />
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
