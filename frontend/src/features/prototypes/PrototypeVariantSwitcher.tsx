'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaArrowLeft, FaArrowRight } from 'react-icons/fa';
import { ErpIconButton } from '@/components/erp';

type PrototypeVariant = { key: string; label: string };

export default function PrototypeVariantSwitcher({ variants, current, parameter, onChange }: {
  variants: PrototypeVariant[];
  current: string;
  parameter: string;
  onChange: (key: string) => void;
}) {
  const router = useRouter();
  const move = (offset: number) => {
    const currentIndex = Math.max(0, variants.findIndex((variant) => variant.key === current));
    const next = variants[(currentIndex + offset + variants.length) % variants.length];
    const url = new URL(window.location.href);
    url.searchParams.set(parameter, next.key);
    onChange(next.key);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const active = variants.find((variant) => variant.key === current) || variants[0];
  return (
    <div className="fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[var(--sds-border-strong)] bg-[var(--sds-surface-raised)] p-2 shadow-xl" aria-label="تعویض طرح نمونه آزمایشی">
      <ErpIconButton label="طرح قبلی" icon={FaArrowRight} onClick={() => move(-1)} variant="ghost" />
      <span className="min-w-40 text-center text-sm font-semibold text-[var(--sds-text-primary)]">{active.key} — {active.label}</span>
      <ErpIconButton label="طرح بعدی" icon={FaArrowLeft} onClick={() => move(1)} variant="ghost" />
    </div>
  );
}
