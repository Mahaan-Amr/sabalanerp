'use client';

import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaArrowLeft, FaArrowRight } from 'react-icons/fa';
import { ErpIconButton } from '@/components/erp';

type PrototypeVariant = {
  key: string;
  name: string;
};

export function PrototypeSwitcher({ variants, current }: { variants: PrototypeVariant[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const cycle = useCallback((direction: -1 | 1) => {
    const currentIndex = Math.max(0, variants.findIndex((variant) => variant.key === current));
    const nextIndex = (currentIndex + direction + variants.length) % variants.length;
    const params = new URLSearchParams(searchParams.toString());
    params.set('variant', variants[nextIndex].key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [current, pathname, router, searchParams, variants]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') cycle(-1);
      if (event.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cycle]);

  if (process.env.NODE_ENV === 'production') return null;

  const active = variants.find((variant) => variant.key === current) ?? variants[0];

  return (
    <div className="fixed bottom-4 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--sds-border-strong)] bg-[var(--sds-surface-raised)] px-2 py-1.5 shadow-xl" dir="ltr">
      <ErpIconButton label="طرح قبلی" icon={FaArrowLeft} onClick={() => cycle(-1)} />
      <p className="sds-text-primary min-w-44 text-center text-xs font-bold" dir="rtl">
        {active.key} — {active.name}
      </p>
      <ErpIconButton label="طرح بعدی" icon={FaArrowRight} onClick={() => cycle(1)} />
    </div>
  );
}
