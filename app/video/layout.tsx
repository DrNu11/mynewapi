import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Nassa Video Playground',
  description: 'NassaAPI 海螺视频生成工作台',
};

export default function VideoLayout({ children }: { children: ReactNode }) {
  return children;
}
