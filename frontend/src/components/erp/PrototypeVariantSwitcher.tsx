'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ErpIconButton, ErpCard } from '@/components/erp';
import { FaArrowLeft, FaArrowRight } from 'react-icons/fa';

/** Throwaway comparison control. Never rendered in production. */
export default function PrototypeVariantSwitcher({ variants, current }: { variants: { key: string; label: string }[]; current: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const index = Math.max(0, variants.findIndex(row => row.key === current));
  function cycle(offset: number) {
    const query = new URLSearchParams(params.toString());
    query.set('variant', variants[(index + offset + variants.length) % variants.length].key);
    router.replace(`${path}?${query}`, { scroll: false });
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable], [role="dialog"]') || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowRight' ? 1 : -1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  if (process.env.NODE_ENV === 'production') return null;
  return <div className="fixed bottom-4 left-1/2 z-40 w-max max-w-[calc(100%-2rem)] -translate-x-1/2" dir="ltr">
    <ErpCard tone="primary" className="flex items-center gap-2 p-2">
      <ErpIconButton label="طرح قبلی" icon={FaArrowLeft} onClick={() => cycle(-1)} />
      <span className="min-w-0 text-center text-sm" dir="rtl">{current} · {variants[index].label}</span>
      <ErpIconButton label="طرح بعدی" icon={FaArrowRight} onClick={() => cycle(1)} />
    </ErpCard>
  </div>;
}
