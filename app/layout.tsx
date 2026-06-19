import './globals.css';
import type { Metadata } from 'next';
import ClickEffects from '@/components/click-effects';

export const metadata: Metadata = {
  title: 'NassaAPI 激活中心',
  description: '输入卡密激活,使用 GPT-5、DeepSeek、Codex 套餐额度',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ClickEffects />
        {children}
      </body>
    </html>
  );
}
