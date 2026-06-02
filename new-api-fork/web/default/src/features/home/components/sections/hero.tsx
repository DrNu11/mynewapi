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
    <section className='relative z-10 flex min-h-[720px] flex-col items-center justify-center overflow-hidden bg-[#000000] px-6 pt-32 pb-20 text-center md:min-h-[820px] md:pt-40 md:pb-28'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] bg-[radial-gradient(ellipse_64%_42%_at_50%_0%,rgba(114,102,255,0.16),rgba(0,0,0,0)_72%)]'
      />
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-[16%] top-40 -z-10 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent'
      />
      <div
        aria-hidden
        className='pointer-events-none absolute top-40 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-[#7C6DFF]/8 blur-[120px]'
      />

      <div className='mx-auto flex max-w-5xl flex-col items-center'>
        <p
          className='landing-animate-fade-up text-sm font-medium tracking-[0.18em] text-[#86868B] uppercase opacity-0'
          style={{ animationDelay: '0ms' }}
        >
          PRO-LEVEL AI PROXY
        </p>
        <h1
          className='landing-animate-fade-up mt-5 text-7xl leading-[0.92] font-semibold tracking-normal text-[#F5F5F7] opacity-0 sm:text-8xl md:text-9xl lg:text-[10rem]'
          style={{ animationDelay: '100ms' }}
        >
          NassaAPI
        </h1>
        <p
          className='landing-animate-fade-up mt-7 max-w-2xl text-2xl leading-snug tracking-normal text-[#86868B] opacity-0 md:text-4xl'
          style={{ animationDelay: '200ms' }}
        >
          让 AI 编程触手可及
        </p>
        <p
          className='landing-animate-fade-up mt-5 max-w-2xl text-[15px] leading-7 text-[#86868B] opacity-0 md:text-lg md:leading-8'
          style={{ animationDelay: '300ms' }}
        >
          支持 Claude、GPT、Gemini 与主流模型，统一 OpenAI 兼容协议，给 Codex、Claude Code 与团队研发一条安静稳定的高速通道。
        </p>
        <div
          className='landing-animate-fade-up mt-11 flex flex-col items-center gap-5 opacity-0 sm:flex-row'
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
                className='group inline-flex h-12 items-center justify-center rounded-full px-2 text-[15px] font-medium text-[#F5F5F7] transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white'
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
