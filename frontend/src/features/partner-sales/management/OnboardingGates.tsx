'use client';

import React from 'react';
import type { PartnerProfileView } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpCard, ErpStatus } from '@/components/erp';

export const profileLabels: Record<PartnerProfileView['status'], string> = {
  PENDING: 'در انتظار تکمیل', ACTIVE: 'فعال', SUSPENDED: 'معلق', TERMINATED: 'خاتمه‌یافته',
};
const gates = [
  ['identityVerified', 'تأیید هویت', 'منابع انسانی'],
  ['commercialTermsReady', 'شرایط تجاری', 'مدیریت فروش'],
  ['creditTermsReady', 'اعتبار و پرداخت', 'حسابداری'],
  ['responderReady', 'پاسخ‌دهنده قیمت', 'مدیریت فروش'],
  ['conversionCleared', 'تعیین تکلیف کارهای داخلی', 'مسئول تبدیل'],
  ['cohortReady', 'آمادگی شروع همکاری', 'مسئول انتشار'],
] as const;

/** Consumes only the identity-safe gate projection; readiness is never a grant. */
export function OnboardingGates({ profile }: { profile: PartnerProfileView }) {
  return <ErpCard className="p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold">شرایط فعال‌سازی</h2>
      <ErpBadge tone={profile.status === 'ACTIVE' ? 'success' : 'warning'}>{profileLabels[profile.status]}</ErpBadge>
    </div>
    <ul className="mt-4 space-y-3">
      {gates.map(([key, label, owner]) => <li key={key} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--sds-border-subtle)] pb-3 last:border-0">
        <div><span className="font-semibold">{label}</span><p className="sds-text-secondary text-sm">{owner}</p></div>
        <ErpStatus label={profile[key] ? 'تکمیل شده' : 'در انتظار تکمیل'} tone={profile[key] ? 'success' : 'warning'} />
      </li>)}
    </ul>
  </ErpCard>;
}
