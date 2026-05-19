import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '模型健康检查 · Model Health Check',
  description: 'Nassa API 模型状态监控面板',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-white text-slate-900 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
