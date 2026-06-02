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
import { ArrowRight, BookOpen } from 'lucide-react'
import { useState } from 'react'

const DOCS_URL = 'https://docs.nassaapi.xyz'

const API_PROTOCOLS = [
  {
    id: 'chat',
    label: 'Chat',
    endpoint: '/v1/chat/completions',
    request: [
      'curl -X POST "/v1/chat/completions" \\',
      '-H "Authorization: Bearer sk-••••" \\',
      '-d \'{"model":"DeepSeek"}\'',
    ],
    response: [
      '{ "choices": [',
      '"content": "已路由到最佳通道"',
      '], "total_tokens": 27 }',
    ],
    latency: '142 MS',
    tokens: '27 TOKENS',
    cost: 'COST $0.00081',
    stream: 'STREAM · SSE',
  },
  {
    id: 'responses',
    label: 'Responses',
    endpoint: '/v1/responses',
    request: [
      'curl -X POST "/v1/responses" \\',
      '-H "Authorization: Bearer sk-••••" \\',
      '-d \'{"model":"DeepSeek"}\'',
    ],
    response: [
      '{ "output": [',
      '"text": "统一响应协议已接入"',
      '], "status": "completed" }',
    ],
    latency: '118 MS',
    tokens: '31 TOKENS',
    cost: 'COST $0.00093',
    stream: 'JSON',
  },
  {
    id: 'claude',
    label: 'Claude',
    endpoint: '/v1/messages',
    request: [
      'curl -X POST "/v1/messages" \\',
      '-H "anthropic-version: 2023-06-01" \\',
      '-d \'{"model":"DeepSeek"}\'',
    ],
    response: [
      '{ "content": [',
      '"text": "Claude 协议兼容成功"',
      '], "stop_reason": "end_turn" }',
    ],
    latency: '156 MS',
    tokens: '34 TOKENS',
    cost: 'COST $0.00102',
    stream: 'STREAM · SSE',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    endpoint: '/v1beta/models/gemini:generateContent',
    request: [
      'curl -X POST "/v1beta/models/gemini:generateContent" \\',
      '-H "x-goog-api-key: sk-••••" \\',
      '-d \'{"model":"DeepSeek"}\'',
    ],
    response: [
      '{ "candidates": [',
      '"text": "Gemini 协议已转换"',
      '], "finishReason": "STOP" }',
    ],
    latency: '163 MS',
    tokens: '29 TOKENS',
    cost: 'COST $0.00087',
    stream: 'JSON',
  },
] as const

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  const [activeProtocolId, setActiveProtocolId] =
    useState<(typeof API_PROTOCOLS)[number]['id']>('chat')
  const activeProtocol =
    API_PROTOCOLS.find((protocol) => protocol.id === activeProtocolId) ??
    API_PROTOCOLS[0]

  return (
    <section className='relative z-10 flex min-h-[760px] flex-col justify-center overflow-hidden bg-[#000000] px-6 pt-32 pb-20 md:min-h-[840px] md:pt-40 md:pb-28'>
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

      <div className='mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(520px,1fr)] lg:gap-16'>
        <div className='flex flex-col items-center text-center lg:items-start lg:text-left'>
          <p
            className='landing-animate-fade-up text-sm font-medium tracking-[0.18em] text-[#86868B] uppercase opacity-0'
            style={{ animationDelay: '0ms' }}
          >
            PRO-LEVEL AI PROXY
          </p>
          <h1
            className='landing-animate-fade-up mt-5 text-7xl leading-[0.92] font-semibold tracking-normal text-[#F5F5F7] opacity-0 sm:text-8xl md:text-9xl lg:text-[9rem]'
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
              <>
                <Link
                  to='/dashboard'
                  className='hig-primary-action inline-flex h-12 items-center justify-center rounded-full bg-[#F5F5F7] px-7 text-[15px] font-medium text-[#000000]'
                >
                  进入控制台
                </Link>
                <a
                  href={DOCS_URL}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='group inline-flex h-12 items-center justify-center rounded-full px-2 text-[15px] font-medium text-[#F5F5F7] transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white'
                >
                  使用文档
                  <ArrowRight className='ml-1.5 size-4 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5' />
                </a>
              </>
            ) : (
              <>
                <Link
                  to='/sign-up'
                  className='hig-primary-action inline-flex h-12 items-center justify-center rounded-full bg-[#F5F5F7] px-7 text-[15px] font-medium text-[#000000]'
                >
                  开始使用
                </Link>
                <a
                  href={DOCS_URL}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='group inline-flex h-12 items-center justify-center rounded-full px-2 text-[15px] font-medium text-[#F5F5F7] transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white'
                >
                  使用文档
                  <ArrowRight className='ml-1.5 size-4 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5' />
                </a>
              </>
            )}
          </div>
        </div>

        <div
          className='landing-animate-fade-up w-full opacity-0'
          style={{ animationDelay: '500ms' }}
        >
          <div className='nassa-code-demo'>
            <div className='flex items-center justify-between border-b border-white/8 px-5 py-4 text-xs text-[#86868B]'>
              <div className='flex items-center gap-5'>
                {API_PROTOCOLS.map((protocol) => (
                  <button
                    key={protocol.id}
                    type='button'
                    onClick={() => setActiveProtocolId(protocol.id)}
                    className='nassa-protocol-tab'
                    data-active={protocol.id === activeProtocol.id}
                  >
                    {protocol.label}
                  </button>
                ))}
              </div>
              <div className='flex items-center gap-2'>
                <span className='size-2 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.85)]' />
                <span>200 OK</span>
              </div>
            </div>
            <div className='border-b border-white/8 px-5 py-3 font-mono text-sm text-[#F5F5F7]'>
              <span className='rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300'>
                POST
              </span>
              <span className='ml-3 text-[#D6D6DA]'>{activeProtocol.endpoint}</span>
            </div>
            <div key={activeProtocol.id} className='grid md:grid-cols-2'>
              <div className='border-white/8 p-5 md:border-r'>
                <p className='mb-4 text-xs tracking-[0.18em] text-[#86868B] uppercase'>
                  Request
                </p>
                <pre className='nassa-code-lines'>
                  <code>
                    <span className='nassa-typed-line nassa-gradient-text nassa-line-1'>
                      {activeProtocol.request[0]}
                    </span>
                    <span className='nassa-typed-line nassa-line-2 text-[#9CDCFE]'>
                      {activeProtocol.request[1]}
                    </span>
                    <span className='nassa-typed-line nassa-line-3 text-[#CE9178]'>
                      {activeProtocol.request[2]}
                    </span>
                  </code>
                </pre>
              </div>
              <div className='p-5'>
                <p className='mb-4 text-xs tracking-[0.18em] text-[#86868B] uppercase'>
                  Response
                </p>
                <pre className='nassa-code-lines'>
                  <code>
                    <span className='nassa-typed-line nassa-line-4 text-[#D6D6DA]'>
                      {activeProtocol.response[0]}
                    </span>
                    <span className='nassa-typed-line nassa-gradient-text nassa-line-5'>
                      {activeProtocol.response[1]}
                    </span>
                    <span className='nassa-typed-line nassa-line-6 text-[#B5CEA8]'>
                      {activeProtocol.response[2]}
                    </span>
                  </code>
                </pre>
              </div>
            </div>
            <div className='flex items-center justify-between border-t border-white/8 px-5 py-3 font-mono text-xs text-[#86868B]'>
              <span>{activeProtocol.latency}</span>
              <span>{activeProtocol.tokens}</span>
              <span>{activeProtocol.cost}</span>
              <span>{activeProtocol.stream}</span>
            </div>
          </div>
          <a
            href={DOCS_URL}
            target='_blank'
            rel='noopener noreferrer'
            className='group mt-5 inline-flex items-center justify-center gap-2 text-sm font-medium text-[#86868B] transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-[#F5F5F7]'
          >
            <BookOpen className='size-4' strokeWidth={1.5} />
            查看接入文档
            <ArrowRight className='size-4 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5' />
          </a>
        </div>
      </div>
    </section>
  )
}
