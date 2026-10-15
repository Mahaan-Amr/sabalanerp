'use client';

import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ErpButton, ErpCard } from '@/components/erp';

export default function PrototypeSwitcher({ variants, current }: { variants: { key: string; name: string }[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const index = Math.max(0, variants.findIndex(row => row.key === current));
  const cycle = useCallback((offset: number) => {
    const next = new URLSearchParams(search.toString());
    next.set('variant', variants[(index + offset + variants.length) % variants.length].key);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }, [index, pathname, router, search, variants]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable], [role="combobox"], [aria-modal="true"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowRight' ? 1 : -1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [cycle]);
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES !== '1') return null;
  return <div className="fixed bottom-4 inset-x-3 z-40 mx-auto w-fit max-w-[calc(100%-1.5rem)]" dir="ltr">
    <ErpCard className="flex items-center gap-2 p-2" tone="info">
      <ErpButton label="←" title="طرح قبلی" onClick={() => cycle(-1)} tone="info" />
      <span className="px-2 text-center text-sm font-semibold" dir="rtl" aria-live="polite">{current} · {variants[index].name}<span className="block text-xs font-normal sds-text-secondary">مقایسه طرح‌ها · کلیدهای ← →</span></span>
      <ErpButton label="→" title="طرح بعدی" onClick={() => cycle(1)} tone="info" />
    </ErpCard>
  </div>;
}
