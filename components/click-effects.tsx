'use client';

import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  el: HTMLDivElement;
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#a78bfa', // indigo/violet
  '#06b6d4', '#22d3ee', '#67e8f9', // cyan
  '#f59e0b', '#fbbf24', '#fde68a', // amber
  '#ec4899', '#f472b6', '#f9a8d4', // pink
];

function createParticle(x: number, y: number): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = 60 + Math.random() * 140;
  const maxLife = 400 + Math.random() * 400;
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 40,
    life: maxLife,
    maxLife,
    size: 4 + Math.random() * 8,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    el: document.createElement('div'),
  };
}

export default function ClickEffects() {
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerDown = (e: PointerEvent) => {
      // 忽略交互元素内的点击（按钮、输入框、链接等）
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      const role = target.getAttribute('role');
      const isInteractive =
        tag === 'button' ||
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        tag === 'a' ||
        role === 'button' ||
        target.closest('button, a, input, textarea, select, [role="button"]');
      if (isInteractive) return;

      // 每 80ms 最多触发一次
      const now = performance.now();
      if ((container as any).__lastBurst && now - (container as any).__lastBurst < 80) return;
      (container as any).__lastBurst = now;

      const count = 10 + Math.floor(Math.random() * 12);
      for (let i = 0; i < count; i++) {
        const p = createParticle(e.clientX, e.clientY);
        p.el.className = 'click-particle';
        p.el.style.cssText = `
          position: fixed;
          left: ${p.x}px;
          top: ${p.y}px;
          width: ${p.size}px;
          height: ${p.size}px;
          border-radius: 50%;
          background: ${p.color};
          pointer-events: none;
          z-index: 99999;
          will-change: transform, opacity;
          box-shadow: 0 0 ${p.size * 2}px ${p.color}66;
        `;
        container.appendChild(p.el);
        particlesRef.current.push(p);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, { passive: true });

    const animate = () => {
      const dt = Math.min(32, 16); // cap delta
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          p.el.remove();
          particles.splice(i, 1);
          continue;
        }
        const t = p.life / p.maxLife;
        p.x += p.vx * (dt / 1000);
        p.y += p.vy * (dt / 1000);
        p.vy += 200 * (dt / 1000); // gravity
        const scale = 0.3 + t * 0.7;
        const opacity = t;
        p.el.style.transform = `translate(${p.x - parseFloat(p.el.style.left)}px, ${p.y - parseFloat(p.el.style.top)}px) scale(${scale})`;
        p.el.style.opacity = String(opacity);
        p.el.style.left = `${p.x}px`;
        p.el.style.top = `${p.y}px`;
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      cancelAnimationFrame(rafRef.current);
      for (const p of particlesRef.current) p.el.remove();
      particlesRef.current = [];
    };
  }, []);

  return <div ref={containerRef} aria-hidden="true" />;
}
