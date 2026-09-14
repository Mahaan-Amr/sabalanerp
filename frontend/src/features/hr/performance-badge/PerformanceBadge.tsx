"use client";

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { FaInfoCircle } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpField, ErpInlineState, ErpPressable, ErpSheet, ErpTextarea } from '@/components/erp';
import { personnelPerformanceAPI } from '@/lib/api';
import { dateFa } from '@/features/hr/hrUi';
import { performanceBadgePresentation, type PerformanceBadgeSummary } from './performanceBadgeModel';

export function PerformanceBadge({ badge, onAppeal }: { badge: PerformanceBadgeSummary; compact?: boolean; onAppeal?: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [appealText, setAppealText] = useState('');
  const [appealPending, setAppealPending] = useState(false);
  const [appealError, setAppealError] = useState('');
  const presentation = performanceBadgePresentation(badge);
  return <>
    <ErpPressable
      type="button"
      onClick={(event) => { event.stopPropagation(); setOpen(true); }}
      aria-label={`سطح عملکرد: ${presentation.labelFa}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-2 py-1 text-right dark:border-[var(--sds-border-strong)]"
    >
      <span className="relative block h-9 w-9 shrink-0" aria-hidden="true">
        <Image src={presentation.lightAsset} alt="" fill sizes="36px" style={{ filter: presentation.imageFilter }} className="object-contain dark:hidden" unoptimized />
        <Image src={presentation.darkAsset} alt="" fill sizes="36px" style={{ filter: presentation.imageFilter }} className="hidden object-contain dark:block" unoptimized />
      </span>
      <span className="text-xs font-bold text-[var(--sds-text-primary)]">{presentation.labelFa}</span>
      <span className="sr-only">{presentation.meaningFa}</span>
    </ErpPressable>
    <ErpSheet open={open} onClose={() => setOpen(false)} title="خلاصه سطح عملکرد" presentation="modal">
      <div className="space-y-4" dir="rtl">
        <ErpCard className="flex items-center gap-4 p-4">
          <span className="relative block h-20 w-20 shrink-0" aria-hidden="true">
            <Image src={presentation.lightAsset} alt="" fill sizes="80px" style={{ filter: presentation.imageFilter }} className="object-contain dark:hidden" unoptimized />
            <Image src={presentation.darkAsset} alt="" fill sizes="80px" style={{ filter: presentation.imageFilter }} className="hidden object-contain dark:block" unoptimized />
          </span>
          <div><ErpBadge tone={presentation.tone}>{presentation.labelFa}</ErpBadge><p className="mt-2 text-sm leading-7 text-[var(--sds-text-secondary)]">{presentation.meaningFa}</p></div>
        </ErpCard>
        {badge.officialResult === false && <ErpCard className="p-4"><p className="font-bold">بدون نتیجه رسمی</p><p className="mt-2 text-sm leading-7 text-[var(--sds-text-secondary)]">نشان «همراه» تا ثبت نخستین نتیجه معتبر نمایش داده می‌شود و در تصمیم‌های رسمی یا تحلیل رقابتی محاسبه نمی‌شود.</p></ErpCard>}
        {badge.details && <>
          {badge.details.status === 'PENDING_APPEAL' && <ErpInlineState kind="stale" title="این نتیجه پیشنهادی است و هنوز Badge رسمی را تغییر نداده است." />}
          {badge.details.periodLabelFa && <ErpCard className="p-3"><p className="text-xs text-[var(--sds-text-muted)]">دوره ارزیابی</p><p className="mt-1 text-sm font-bold">{badge.details.periodLabelFa}</p></ErpCard>}
          <dl className="grid gap-3 sm:grid-cols-3">
            {[['امتیاز کل', badge.details.score], ['رفتاری', badge.details.behavioralScore], ['عملکردی', badge.details.performanceScore]].map(([label, value]) => <ErpCard key={label} className="p-3"><dt className="text-xs text-[var(--sds-text-muted)]">{label}</dt><dd className="mt-1 text-lg font-black">{value ?? '—'}</dd></ErpCard>)}
          </dl>
          <div className="space-y-2"><p className="font-bold">جزئیات عوامل</p>{badge.details.factors.map((factor) => <ErpCard key={factor.code} className="p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-bold">{factor.titleFa}</p><p className="mt-1 text-xs text-[var(--sds-text-muted)]">مقدار: {factor.actual} {factor.unitFa} · هدف: {factor.target} · نمونه: {(factor.sampleCount ?? 1).toLocaleString('fa-IR')}</p>{factor.sourceReference && <p className="mt-1 text-xs text-[var(--sds-text-muted)]">مرجع: {factor.sourceReference}</p>}</div><ErpBadge tone="neutral">{factor.score ?? '—'}</ErpBadge></div></ErpCard>)}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <ErpCard className="p-3"><p className="text-xs text-[var(--sds-text-muted)]">خلاصه ناشناس نظرسنجی</p><p className="mt-1 font-bold">{badge.details.surveyAggregateScore ?? '—'}</p></ErpCard>
            <ErpCard className="p-3"><p className="text-xs text-[var(--sds-text-muted)]">نقطه قوت</p><p className="mt-1 text-sm font-bold">{badge.details.strength?.titleFa ?? '—'}</p></ErpCard>
            <ErpCard className="p-3"><p className="text-xs text-[var(--sds-text-muted)]">زمینه بهبود</p><p className="mt-1 text-sm font-bold">{badge.details.improvement?.titleFa ?? '—'}</p></ErpCard>
          </div>
          {badge.details.appeal && <ErpCard className="space-y-3 p-4">
            <p className="font-bold">اعتراض به نتیجه پیشنهادی</p>
            {badge.details.appeal.deadline && <p className="text-sm text-[var(--sds-text-secondary)]">مهلت ثبت: {dateFa(badge.details.appeal.deadline)}</p>}
            {badge.details.appeal.submittedAt ? <ErpInlineState kind="success" title="اعتراض شما ثبت شده و در انتظار رسیدگی است." /> : badge.details.appeal.canSubmit && onAppeal ? <>
              {appealError && <ErpInlineState kind="error" title={appealError} />}
              <ErpField label="شرح اعتراض" required><ErpTextarea rows={3} value={appealText} onChange={(event) => setAppealText(event.target.value)} /></ErpField>
              <ErpButton label="ثبت اعتراض" disabled={appealPending || appealText.trim().length < 8} onClick={() => void (async () => {
                setAppealPending(true); setAppealError('');
                try { await onAppeal(appealText); setAppealText(''); }
                catch (error: any) { setAppealError(error.response?.data?.message || 'ثبت اعتراض انجام نشد.'); }
                finally { setAppealPending(false); }
              })()} />
            </> : null}
            {badge.details.appeal.resolution && <p className="text-sm leading-7 text-[var(--sds-text-secondary)]">نتیجه رسیدگی: {badge.details.appeal.resolution}</p>}
          </ErpCard>}
        </>}
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
  const load = () => {
    let active = true;
    personnelPerformanceAPI.personalBadge()
      .then((response) => { if (active) setBadge(response.data.badge ?? null); })
      .catch(() => { if (active) setBadge(null); });
    return () => { active = false; };
  };
  useEffect(() => {
    return load();
  }, []);
  return badge ? <PerformanceBadge badge={badge} onAppeal={async (text) => {
    const evaluationId = badge.details?.evaluationId;
    if (!evaluationId) return;
    await personnelPerformanceAPI.appealSimpleEvaluation(evaluationId, text);
    personnelPerformanceAPI.personalBadge().then((response) => setBadge(response.data.badge ?? null));
  }} /> : null;
}
