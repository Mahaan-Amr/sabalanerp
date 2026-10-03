'use client';

import React, { useState } from 'react';
import type { ActionAvailabilityV2, PartnerActionV2, PartnerManagementProfileViewV2, PartnerManagementWorkspaceViewV2 } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpFieldView, ErpInlineState, ErpMetricGrid, ErpSection, ErpSummaryGrid, ErpSheet } from '@/components/erp';
import { actionPresentation } from './availability';

export type ManagementChoice = { action: PartnerActionV2; profile?: PartnerManagementProfileViewV2;
  transfer?: PartnerManagementWorkspaceViewV2['transfers'][number]; outcome?: 'APPROVE' | 'REJECT' };
export const actionLabels: Partial<Record<PartnerActionV2, string>> = {
  PROFILE_CREATE: 'ایجاد پروفایل', IDENTITY_VERIFY: 'تأیید هویت', PROFILE_ACTIVATE: 'فعال‌سازی',
  PROFILE_SUSPEND: 'تعلیق همکاری', PROFILE_TERMINATE: 'غیرفعال‌سازی همکاری',
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
  const [selectedProfile, setSelectedProfile] = useState<string>();
  return <div className="min-w-0 space-y-5" dir="rtl">
    {view.profiles.length === 0 && view.transfers.length === 0 && <ErpEmptyState title="اقدامی در دسترس نیست." description="فقط موارد در محدوده مجاز شما نمایش داده می‌شوند." />}
    {view.profiles.length > 0 && <ErpMetricGrid items={[
      { label: 'همکاران این صفحه', value: view.profiles.length },
      { label: 'در انتظار تکمیل', value: view.profiles.filter(item => item.profile.status === 'PENDING').length, tone: 'warning' },
      { label: 'فعال', value: view.profiles.filter(item => item.profile.status === 'ACTIVE' && item.accountActive !== false).length, tone: 'success' },
    ]} />}
    {view.profiles.map(item => {
      const action = (name: PartnerActionV2) => <ProjectedAction action={name} actions={item.actions} now={now} disabled={disabled}
        onClick={() => { setSelectedProfile(undefined); onChoose({ action: name, profile: item }); }} />;
      const accountInactive = item.accountActive === false;
      const status = accountInactive ? 'حساب غیرفعال یا حذف‌شده' : ({ ACTIVE: 'فعال', SUSPENDED: 'معلق', TERMINATED: 'همکاری غیرفعال', PENDING: 'در انتظار تکمیل' }[item.profile.status]);
      return <ErpCard key={item.profile.profileId} className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold">{item.displayName === 'Deleted User' ? 'حساب حذف‌شده' : item.displayName}</h3>
          <ErpBadge tone={item.profile.status === 'ACTIVE' && !accountInactive ? 'success' : 'neutral'}>{status}</ErpBadge>
        </div>
        {item.responder && <ErpFieldView label="پاسخ‌دهنده قیمت" value={item.responder.displayName || 'تعیین نشده'} />}
        <ErpButton label="مشاهده جزئیات" variant="outline" onClick={() => setSelectedProfile(item.profile.profileId)} />
        <ErpSheet title={`جزئیات همکاری — ${item.displayName === 'Deleted User' ? 'حساب حذف‌شده' : item.displayName}`} presentation="modal"
          open={selectedProfile === item.profile.profileId} onClose={() => setSelectedProfile(undefined)} pending={disabled}>
        {accountInactive ? <ErpInlineState kind="stale" title="حساب کاربری فعال نیست؛ این بخش فقط سوابق همکاری را نمایش می‌دهد." /> : <>

        <div className="flex flex-wrap gap-3">{action('IDENTITY_VERIFY')}{action('COMMERCIAL_TERMS_MANAGE')}{action('CREDIT_TERMS_MANAGE')}</div>
        <div className="min-w-0">
          <div className="min-w-0 space-y-4">
            {item.responder && <ErpCard className="space-y-3 p-4"><ErpFieldView label="پاسخ‌دهنده قیمت" value={item.responder.displayName || 'تعیین نشده'} />
              <div className="flex flex-wrap gap-3">{action('RESPONDER_ASSIGN')}
                <ProjectedAction action="RESPONDER_REASSIGN" actions={item.responder.pendingInquiries.flatMap(inquiry => inquiry.actions)}
                  now={now} disabled={disabled} onClick={() => { setSelectedProfile(undefined); onChoose({ action: 'RESPONDER_REASSIGN', profile: item }); }} />
              </div>
            </ErpCard>}
            {item.conversion?.started && item.conversion.blockers.length > 0 && <ErpCard className="space-y-3 p-4"><h3 className="font-bold">تبدیل کاربر داخلی</h3>
              <p className="sds-text-secondary">{item.conversion.irreversible ? 'بازگشت این کاربر به شخصیت داخلی ممکن نیست.' : item.conversion.started ? 'تبدیل در حال بررسی است.' : 'تبدیل هنوز آغاز نشده است.'}</p>
              {item.conversion.blockers.length > 0 && <ul className="list-inside list-disc space-y-2">{item.conversion.blockers.map(blocker => <li key={blocker.id}>{blocker.label}</li>)}</ul>}
              {action('PROFILE_CONVERSION_MANAGE')}
            </ErpCard>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">{action('PROFILE_ACTIVATE')}{action('PROFILE_SUSPEND')}{action('PROFILE_TERMINATE')}</div>
        {item.lifecycleBlockers.map(blocker => <div className="mt-3" key={`${blocker.action}:${blocker.code}`}>
          <ErpInlineState kind="stale" title={`${blocker.title} — ${blocker.detail} مسئول پیگیری: ${blocker.owner}. اقدام بعدی: ${blocker.nextStep}`} />
        </div>)}
        </>}
        </ErpSheet>
      </ErpCard>;
    })}
    {view.transfers.length > 0 && <ErpSection title="درخواست‌های انتقال مشتری">
      <div className="grid gap-4 lg:grid-cols-2">{view.transfers.map(transfer => <ErpCard key={transfer.transferId} className="space-y-4 p-4">
        <h3 className="font-bold">{transfer.match.displayName}</h3>
        <ErpSummaryGrid items={[{ label: 'نوع شخص', value: transfer.match.personType === 'LEGAL' ? 'حقوقی' : 'حقیقی' },
          { label: 'شهر', value: transfer.match.city }, { label: 'نشانه تطبیق', value: <span dir="ltr">{transfer.match.maskedWitness}</span> }]} />
        <ErpSummaryGrid items={[
          { label: 'مالک فعلی', value: transfer.currentOwner || '—' },
          { label: 'فروشنده مقصد', value: transfer.requester || '—' },
          { label: 'زمان درخواست', value: transfer.requestedAt ? new Date(transfer.requestedAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }) : '—' },
          { label: 'وضعیت', value: ({ PENDING: 'در انتظار بررسی', APPROVED: 'تأییدشده', REJECTED: 'ردشده', CANCELLED: 'لغوشده' }[transfer.status || 'PENDING']) },
        ]} />
        {transfer.requestReason && <ErpFieldView label="دلیل درخواست" value={transfer.requestReason} />}
        {transfer.decisionReason && <ErpFieldView label="دلیل تصمیم" value={transfer.decisionReason} />}
        {transfer.approvalBlockers?.map((blocker, index) => <div key={index} className="space-y-2">
          <ErpInlineState kind="stale" title={`${blocker.label} مسئول پیگیری: ${blocker.owner}`} />
          {blocker.href && <ErpButton label="رسیدگی به پرونده" href={blocker.href} variant="outline" />}
        </div>)}

        <div className="flex flex-wrap gap-3">{(['APPROVE', 'REJECT'] as const).map(outcome => <ProjectedAction key={outcome} action="CUSTOMER_TRANSFER_DECIDE"
          label={outcome === 'APPROVE' ? 'تأیید انتقال' : 'رد انتقال'} actions={transfer.actions} now={now} disabled={disabled || (outcome === 'APPROVE' && Boolean(transfer.approvalBlockers?.length))}
          onClick={() => onChoose({ action: 'CUSTOMER_TRANSFER_DECIDE', transfer, outcome })} />)}</div>
      </ErpCard>)}</div>
    </ErpSection>}
  </div>;
}
