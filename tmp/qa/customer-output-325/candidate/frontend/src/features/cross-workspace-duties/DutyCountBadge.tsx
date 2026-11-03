import React from 'react';

export function DutyCountBadge({ count, collapsed }: { count: number; collapsed: boolean }) {
  if (count < 1) return null;
  const displayed = Math.min(count, 99).toLocaleString('fa-IR');
  const accessibleCount = count.toLocaleString('fa-IR');
  return (
    <span
      aria-label={`${accessibleCount} وظیفه بین‌واحدی باز`}
      className={`inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--sds-danger)] px-1.5 text-[11px] font-bold leading-none text-[var(--sds-text-inverse)] ${collapsed ? 'lg:absolute lg:-left-1 lg:-top-1' : ''}`}
    >
      {displayed}
    </span>
  );
}
