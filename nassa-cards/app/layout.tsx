import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NassaAPI 激活中心',
  description: '输入卡密激活,享受 GPT-5、DeepSeek、Codex 不限量调用',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
