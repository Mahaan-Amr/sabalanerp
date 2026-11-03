'use client';

import React from 'react';
import type { ActionAvailabilityV2, PartnerActionV2, PartnerManagementProfileViewV2, PartnerManagementWorkspaceViewV2 } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpFieldView, ErpMetricGrid, ErpSection, ErpSummaryGrid } from '@/components/erp';
import { OnboardingGates } from './OnboardingGates';
import { actionPresentation } from './availability';

export type ManagementChoice = { action: PartnerActionV2; profile?: PartnerManagementProfileViewV2;
  transfer?: PartnerManagementWorkspaceViewV2['transfers'][number]; outcome?: 'APPROVE' | 'REJECT' };
export const actionLabels: Partial<Record<PartnerActionV2, string>> = {
  PROFILE_CREATE: 'ایجاد پروفایل', IDENTITY_VERIFY: 'تأیید هویت', PROFILE_ACTIVATE: 'فعال‌سازی',
  PROFILE_SUSPEND: 'تعلیق همکاری', PROFILE_TERMINATE: 'خاتمه همکاری',
  COMMERCIAL_TERMS_MANAGE: 'تغییر شرایط تجاری', CREDIT_TERMS_MANAGE: 'تغییر شرایط اعتبار',
  RESPONDER_ASSIGN: 'تعیین پاسخ‌دهنده', RESPONDER_REASSIGN: 'تغییر پاسخ‌دهنده',
  PROFILE_CONVERSION_MANAGE: 'تعیین تکلیف تبدیل', CUSTOMER_TRANSFER_DECIDE: 'تصمیم انتقال مشتری',
};

function ProjectedAction({ action, actions, now, disabled, onClick, label }: {
  action: PartnerActionV2; actions: readonly ActionAvailabilityV2[]; now: number; disabled: boolean; onClick: () => void; label?: string;
}) {
  const state = actionPresentation(actions, action, now);
  if (!state || !actionLabels[action]) return null;
  return <div className="space-y-2">
    <ErpButton label={label || actionLabels[action]!} disabled={disabled || !state.enabled} onClick={onClick}
      tone={action === 'PROFILE_TERMINATE' ? 'danger' : 'primary'} variant="outline" />
    {state.reason && <p className="sds-text-secondary text-sm" role="status">{state.reason}</p>}
  </div>;
}

export function ManagementView({ view, now, disabled, onChoose }: {
  view: PartnerManagementWorkspaceViewV2; now: number; disabled: boolean; onChoose: (choice: ManagementChoice) => void;
}) {
  return <div className="min-w-0 space-y-5" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3"><ErpBadge tone="info">{view.personaLabel}</ErpBadge>
      <ProjectedAction action="PROFILE_CREATE" actions={view.actions} now={now} disabled={disabled}
        onClick={() => onChoose({ action: 'PROFILE_CREATE' })} />
    </div>
    {view.profiles.length === 0 && view.transfers.length === 0 && <ErpEmptyState title="اقدامی در دسترس نیست." description="فقط موارد در محدوده مجاز شما نمایش داده می‌شوند." />}
    {view.profiles.length > 0 && <ErpMetricGrid items={[
      { label: 'پروفایل‌های این صفحه', value: view.profiles.length },
      { label: 'در انتظار تکمیل', value: view.profiles.filter(item => item.profile.status === 'PENDING').length, tone: 'warning' },
      { label: 'فعال', value: view.profiles.filter(item => item.profile.status === 'ACTIVE').length, tone: 'success' },
    ]} />}
    {view.profiles.map(item => {
      const action = (name: PartnerActionV2) => <ProjectedAction action={name} actions={item.actions} now={now} disabled={disabled}
        onClick={() => onChoose({ action: name, profile: item })} />;
      return <ErpSection key={item.profile.profileId} title={item.displayName}>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <OnboardingGates profile={item.profile} />
          <div className="min-w-0 space-y-4">
            {item.identity && <ErpCard className="space-y-4 p-4"><h3 className="font-bold">هویت همکاری</h3>
              <ErpSummaryGrid items={[{ label: 'نام قانونی', value: item.identity.legalName }, { label: 'نوع شخص', value: item.identity.personType === 'LEGAL' ? 'حقوقی' : 'حقیقی' },
                { label: 'تلفن', value: item.identity.phone }, { label: 'نشانی', value: item.identity.address }]} />
              {action('IDENTITY_VERIFY')}
            </ErpCard>}
            {item.commercialTerms && <ErpCard className="space-y-3 p-4"><ErpFieldView label="شرایط تجاری" value={item.commercialTerms.summary} />{action('COMMERCIAL_TERMS_MANAGE')}</ErpCard>}
            {item.creditTerms && <ErpCard className="space-y-3 p-4"><ErpFieldView label="اعتبار و پرداخت به سبلان" value={item.creditTerms.summary} />{action('CREDIT_TERMS_MANAGE')}</ErpCard>}
            {item.responder && <ErpCard className="space-y-3 p-4"><ErpFieldView label="پاسخ‌دهنده قیمت" value={item.responder.displayName || 'تعیین نشده'} />
              <div className="flex flex-wrap gap-3">{action('RESPONDER_ASSIGN')}{action('RESPONDER_REASSIGN')}</div>
            </ErpCard>}
            {item.conversion && <ErpCard className="space-y-3 p-4"><h3 className="font-bold">تبدیل کاربر داخلی</h3>
              <p className="sds-text-secondary">{item.conversion.irreversible ? 'بازگشت این کاربر به شخصیت داخلی ممکن نیست.' : item.conversion.started ? 'تبدیل در حال بررسی است.' : 'تبدیل هنوز آغاز نشده است.'}</p>
              {item.conversion.blockers.length > 0 && <ul className="list-inside list-disc space-y-2">{item.conversion.blockers.map(blocker => <li key={blocker.id}>{blocker.label}</li>)}</ul>}
              {action('PROFILE_CONVERSION_MANAGE')}
            </ErpCard>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">{action('PROFILE_ACTIVATE')}{action('PROFILE_SUSPEND')}{action('PROFILE_TERMINATE')}</div>
      </ErpSection>;
    })}
    {view.transfers.length > 0 && <ErpSection title="تصمیم‌های انتقال مشتری">
      <div className="grid gap-4 lg:grid-cols-2">{view.transfers.map(transfer => <ErpCard key={transfer.transferId} className="space-y-4 p-4">
        <h3 className="font-bold">{transfer.match.displayName}</h3>
        <ErpSummaryGrid items={[{ label: 'نوع شخص', value: transfer.match.personType === 'LEGAL' ? 'حقوقی' : 'حقیقی' },
          { label: 'شهر', value: transfer.match.city }, { label: 'نشانه تطبیق', value: <span dir="ltr">{transfer.match.maskedWitness}</span> }]} />
        <p className="sds-text-secondary text-sm">سوابق قراردادها، مسئولیت پروژه‌ها و اعتبار فروش منتقل نمی‌شوند.</p>
        <div className="flex flex-wrap gap-3">{(['APPROVE', 'REJECT'] as const).map(outcome => <ProjectedAction key={outcome} action="CUSTOMER_TRANSFER_DECIDE"
          label={outcome === 'APPROVE' ? 'تأیید انتقال' : 'رد انتقال'} actions={transfer.actions} now={now} disabled={disabled}
          onClick={() => onChoose({ action: 'CUSTOMER_TRANSFER_DECIDE', transfer, outcome })} />)}</div>
      </ErpCard>)}</div>
    </ErpSection>}
  </div>;
}
