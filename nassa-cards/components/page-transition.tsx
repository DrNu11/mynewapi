'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [transitionStage, setTransitionStage] = useState<'enter' | 'idle'>('idle');
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (pathname === prevPathname.current) return;
    // Exit animation
    setTransitionStage('enter');
    const t = setTimeout(() => {
      setDisplayChildren(children);
      prevPathname.current = pathname;
      // Enter animation triggered via key change
      requestAnimationFrame(() => {
        setTransitionStage('idle');
      });
    }, 180);
    return () => clearTimeout(t);
  }, [pathname, children]);

  return (
    <div
      className={`page-transition ${transitionStage === 'enter' ? 'page-transition--enter' : ''}`}
    >
      {displayChildren}
    </div>
  );
}
