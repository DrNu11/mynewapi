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
  Gauge,
  KeyRound,
  Network,
  ReceiptText,
  Route,
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
      icon: Route,
      className: 'lg:col-span-7 lg:min-h-[380px]',
    },
    {
      id: 'ecosystem',
      title: '全生态覆盖',
      desc: 'Claude、GPT、Gemini、DeepSeek、Qwen 等模型统一收束，一个密钥覆盖从原型到生产的完整工作流。',
      icon: Network,
      className: 'lg:col-span-5 lg:min-h-[380px]',
    },
    {
      id: 'billing',
      title: '价格透明',
      desc: '按 Token 精确计费，消耗明细清晰可查。每一次请求、每一笔成本都有迹可循。',
      icon: ReceiptText,
      className: 'lg:col-span-4 lg:min-h-[300px]',
    },
    {
      id: 'reliability',
      title: '稳定调度',
      desc: '多通道策略、失败切换和可观测日志同时在线，让高频开发保持连续。',
      icon: Gauge,
      className: 'lg:col-span-4 lg:min-h-[300px]',
    },
    {
      id: 'control',
      title: '一把密钥',
      desc: '团队、工具和自动化任务可以共用同一套接入方式，权限与成本仍然保持可控。',
      icon: KeyRound,
      className: 'lg:col-span-4 lg:min-h-[300px]',
    },
  ]

  return (
    <section className='relative z-10 bg-[#000000] px-6 pt-8 pb-24 md:pt-10 md:pb-32'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent'
      />
      <div className='mx-auto max-w-7xl'>
        <AnimateInView className='mb-12 max-w-6xl md:mb-16'>
          <p className='mb-4 text-sm font-medium tracking-[0.18em] text-[#86868B] uppercase'>
            DESIGNED FOR FLOW
          </p>
          <h2 className='text-3xl leading-tight font-semibold tracking-normal text-[#F5F5F7] sm:text-4xl md:text-6xl'>
            不打断创造力的接口基础设施
          </h2>
          <p className='mt-6 max-w-4xl text-base leading-7 text-[#86868B] md:text-xl md:leading-8'>
            体验上克制，能力上完整。把模型、计费、稳定性和支持都收进一个安静可靠的控制面。
          </p>
        </AnimateInView>

        <div className='grid grid-cols-1 gap-6 lg:grid-cols-12'>
          {features.map((f, i) => (
            <AnimateInView
              key={f.id}
              delay={i * 100}
              animation='fade-up'
              className={`nassa-glass-card group flex min-h-[300px] flex-col justify-between p-7 md:p-10 ${f.className}`}
            >
              <div className='nassa-card-icon flex size-12 items-center justify-center text-[#F5F5F7] md:size-14'>
                <f.icon className='size-7 md:size-8' strokeWidth={1.5} />
              </div>
              <div>
                <h3 className='text-xl font-medium tracking-normal text-[#F5F5F7] md:text-2xl'>
                  {f.title}
                </h3>
                <p className='mt-3 max-w-xl text-sm leading-7 text-[#86868B] md:text-[15px]'>
                  {f.desc}
                </p>
              </div>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  )
}
