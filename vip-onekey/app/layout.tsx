import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NassaAPI VIP 一键开通',
  description: '输入卡密 · 立即升级 VIP1 · 0.6 倍率 · 30 天有效',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
