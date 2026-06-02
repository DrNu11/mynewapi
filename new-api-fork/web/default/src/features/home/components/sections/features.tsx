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
import {
  LifeBuoy,
  Network,
  PlugZap,
  ReceiptText,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { AnimateInView } from '@/components/animate-in-view'

interface FeaturesProps {
  className?: string
}

export function Features(_props: FeaturesProps) {
  const features: Array<{
    id: string
    title: string
    desc: string
    icon: LucideIcon
    className: string
  }> = [
    {
      id: 'access',
      title: '极速接入',
      desc: 'OpenAI 兼容协议，base URL 一改即用。Codex、Claude Code、SDK 与 CLI 工具都能无缝切换。',
      icon: PlugZap,
      className: 'lg:col-span-2 lg:min-h-[320px]',
    },
    {
      id: 'ecosystem',
      title: '全生态覆盖',
      desc: '聚合 Claude、GPT、Gemini、DeepSeek、Qwen 等主流模型，一个密钥覆盖从原型到生产的完整工作流。',
      icon: Network,
      className: 'lg:col-span-2 lg:min-h-[320px]',
    },
    {
      id: 'billing',
      title: '价格透明',
      desc: '按 Token 精确计费，明细随时可查。',
      icon: ReceiptText,
      className: 'lg:col-span-1 lg:min-h-[280px]',
    },
    {
      id: 'reliability',
      title: '7×24 服务',
      desc: '多通道调度、失败自动切换与人工支持同时在线，问题不拖到第二天。',
      icon: ShieldCheck,
      className: 'lg:col-span-3 lg:min-h-[280px]',
    },
  ]

  return (
    <section className='relative z-10 bg-[#000000] px-6 pt-14 pb-24 md:pt-16 md:pb-32'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent'
      />
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mb-12 max-w-2xl md:mb-16'>
          <p className='mb-4 text-sm font-medium tracking-normal text-[#86868B] uppercase'>
            DESIGNED FOR FLOW
          </p>
          <h2 className='text-3xl leading-tight font-semibold tracking-normal text-[#F5F5F7] md:text-5xl'>
            不打断创造力的接口基础设施
          </h2>
          <p className='mt-5 text-base leading-7 text-[#86868B] md:text-lg'>
            体验上克制，能力上完整。把模型、计费、稳定性和支持都收进一个安静可靠的控制面。
          </p>
        </AnimateInView>

        <div className='grid grid-cols-1 gap-6 lg:grid-cols-4'>
          {features.map((f, i) => (
            <AnimateInView
              key={f.id}
              delay={i * 100}
              animation='fade-up'
              className={`nassa-glass-card group flex min-h-[280px] flex-col justify-between p-7 md:p-9 ${f.className}`}
            >
              <div className='nassa-card-icon flex size-12 items-center justify-center text-[#F5F5F7]'>
                <f.icon className='size-7' strokeWidth={1.5} />
              </div>
              <div>
                <h3 className='text-xl font-medium text-[#F5F5F7]'>
                  {f.title}
                </h3>
                <p className='mt-3 max-w-xl text-sm leading-7 text-[#86868B]'>
                  {f.desc}
                </p>
              </div>
            </AnimateInView>
          ))}
        </div>

        <AnimateInView
          delay={450}
          className='mt-6 flex items-center gap-3 text-sm text-[#86868B]'
        >
          <LifeBuoy className='size-4 text-[#F5F5F7]' strokeWidth={1.5} />
          专为高频开发、AI 编程和团队落地设计。
        </AnimateInView>
      </div>
    </section>
  )
}
