"use client";

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { FaInfoCircle } from 'react-icons/fa';
import { ErpBadge, ErpCard, ErpPressable, ErpSheet } from '@/components/erp';
import { personnelPerformanceAPI } from '@/lib/api';
import { dateFa } from '@/features/hr/hrUi';
import { performanceBadgePresentation, type PerformanceBadgeSummary } from './performanceBadgeModel';

export function PerformanceBadge({ badge }: { badge: PerformanceBadgeSummary; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const presentation = performanceBadgePresentation(badge);
  return <>
    <ErpPressable
      type="button"
      onClick={(event) => { event.stopPropagation(); setOpen(true); }}
      aria-label={`سطح عملکرد: ${presentation.labelFa}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-2 py-1 text-right dark:border-[var(--sds-border-strong)]"
    >
      <span className="relative block h-9 w-9 shrink-0" aria-hidden="true">
        <Image src={presentation.lightAsset} alt="" fill sizes="36px" className="object-contain dark:hidden" unoptimized />
        <Image src={presentation.darkAsset} alt="" fill sizes="36px" className="hidden object-contain dark:block" unoptimized />
      </span>
      <span className="text-xs font-bold text-[var(--sds-text-primary)]">{presentation.labelFa}</span>
      <span className="sr-only">{presentation.meaningFa}</span>
    </ErpPressable>
    <ErpSheet open={open} onClose={() => setOpen(false)} title="خلاصه سطح عملکرد" presentation="modal">
      <div className="space-y-4" dir="rtl">
        <ErpCard className="flex items-center gap-4 p-4">
          <span className="relative block h-20 w-20 shrink-0" aria-hidden="true">
            <Image src={presentation.lightAsset} alt="" fill sizes="80px" className="object-contain dark:hidden" unoptimized />
            <Image src={presentation.darkAsset} alt="" fill sizes="80px" className="hidden object-contain dark:block" unoptimized />
          </span>
          <div><ErpBadge tone={presentation.tone}>{presentation.labelFa}</ErpBadge><p className="mt-2 text-sm leading-7 text-[var(--sds-text-secondary)]">{presentation.meaningFa}</p></div>
        </ErpCard>
        {(badge.newestMeasurementTo || badge.nextReviewAt) && <dl className="grid gap-3 sm:grid-cols-2">
          {badge.newestMeasurementTo && <ErpCard className="p-3"><dt className="text-xs text-[var(--sds-text-muted)]">پایان تازه‌ترین بازه سنجش</dt><dd className="mt-1 text-sm font-bold">{dateFa(badge.newestMeasurementTo)}</dd></ErpCard>}
          {badge.nextReviewAt && <ErpCard className="p-3"><dt className="text-xs text-[var(--sds-text-muted)]">بازبینی بعدی محاسبه</dt><dd className="mt-1 text-sm font-bold">{dateFa(badge.nextReviewAt)}</dd></ErpCard>}
        </dl>}
        {badge.nextReviewAt && <p className="flex items-start gap-2 text-xs leading-6 text-[var(--sds-text-muted)]"><FaInfoCircle className="mt-1 shrink-0" aria-hidden="true" />نتیجه مصوب تازه می‌تواند پیش از این تاریخ سطح را تغییر دهد.</p>}
      </div>
    </ErpSheet>
  </>;
}

export function PersonalPerformanceBadge() {
  const [badge, setBadge] = useState<PerformanceBadgeSummary | null>(null);
  useEffect(() => {
    let active = true;
    personnelPerformanceAPI.personalBadge()
      .then((response) => { if (active) setBadge(response.data.badge ?? null); })
      .catch(() => { if (active) setBadge(null); });
    return () => { active = false; };
  }, []);
  return badge ? <PerformanceBadge badge={badge} /> : null;
}
