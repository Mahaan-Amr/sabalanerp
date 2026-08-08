'use client';
import { useEffect, useState } from 'react';
import {
  FaBalanceScale,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaFileInvoice,
  FaHistory,
  FaMoneyCheckAlt,
  FaReceipt,
  FaSync,
  FaUserClock,
  FaUserPlus,
} from 'react-icons/fa';
import {
  ErpActionGrid,
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
} from '@/components/erp';
import { accountingAPI, dispatchConfirmationAPI } from '@/lib/api';
import RoleAwareDispatchCases from '@/features/dispatch-case/RoleAwareDispatchCases';
import {
  CompactQueueItem,
  QueueList,
  StatusBadge,
  accountingIcons,
  dateFa,
  money,
  taxStatusLabels,
} from '@/features/accounting/accountingUi';

export default function AccountingDashboardPage() {
  const [workspace, setWorkspace] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dispatchCandidates, setDispatchCandidates] = useState<any[]>([]);
  const [dispatchReason, setDispatchReason] = useState('');
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [dispatchNotice, setDispatchNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [confirmation, setConfirmation] = useState<any>(null);
  const [otpCode, setOtpCode] = useState('');
  const [dispatchCapabilities, setDispatchCapabilities] = useState({ canManageAccountingCandidates: false, canManageAccountingConfirmation: false });

  const loadWorkspace = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getWorkspace();
      if (response.data.success) {
        setWorkspace(response.data.data);
      }
      const [candidates, capabilities] = await Promise.allSettled([accountingAPI.getDispatchCandidates(), dispatchConfirmationAPI.getCapabilities()]);
      if (candidates.status === 'fulfilled' && candidates.value.data.success) setDispatchCandidates(candidates.value.data.data || []);
      if (capabilities.status === 'fulfilled' && capabilities.value.data.success) setDispatchCapabilities(capabilities.value.data.data);
    } catch (error) {
      console.error('Error loading accounting workspace:', error);
    } finally {
      setLoading(false);
    }
  };

  const runDispatch = async (command: () => Promise<any>, success: string) => {
    setDispatchNotice(null);
    try { const response = await command(); setDispatchNotice({ kind: 'success', text: success });
      if (response.data?.data?.id && response.data?.data?.waybillId) setConfirmation(response.data.data);
      if (response.data?.data?.authorization) setConfirmation((current: any) => ({ ...current, authorization: response.data.data.authorization }));
      try { const refreshed = await accountingAPI.getDispatchCandidates(); setDispatchCandidates(refreshed.data.data || []); } catch { /* confirmation-only actors may not list candidates */ } }
    catch (error: any) { setDispatchNotice({ kind: 'error', text: error?.response?.data?.error || 'فرمان ارسال انجام نشد.' }); }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  if (loading) {
    return <ErpLoading />;
  }

  const queues = workspace?.queues || {};
  const commandCenter = workspace?.commandCenter || {};

  return (
    <ErpPage
      eyebrow="حسابداری"
      title="داشبورد حسابداری"
      actions={[
        { label: 'به‌روزرسانی', icon: FaSync, onClick: loadWorkspace, tone: 'neutral' },
      ]}
    >
      <ErpActionGrid
        columns={4}
        items={[
          {
            title: 'قراردادهای قابل بررسی',
            href: '/dashboard/accounting/contracts?view=reviewable',
            icon: FaClipboardCheck,
            tone: 'primary',
            badge: <StatusBadge label={(commandCenter.reviewableContracts?.count || 0).toLocaleString('fa-IR')} tone="primary" />,
          },
          {
            title: 'پیش‌نویس صورتحساب‌ها',
            href: '/dashboard/accounting/invoice-candidates?view=actionable',
            icon: FaFileInvoice,
            tone: 'info',
            badge: <StatusBadge label={(commandCenter.invoiceCandidates?.count || 0).toLocaleString('fa-IR')} tone="info" />,
          },
          {
            title: 'دریافت‌ها و چک‌ها',
            href: '/dashboard/accounting/payments',
            icon: FaMoneyCheckAlt,
            tone: 'warning',
            badge: <StatusBadge label={(commandCenter.checksDue?.count || 0).toLocaleString('fa-IR')} tone="warning" />,
          },
          {
            title: 'دریافتنی‌ها',
            href: '/dashboard/accounting/receivables',
            icon: FaReceipt,
            tone: 'success',
            badge: <StatusBadge label={(commandCenter.openReceivables?.count || 0).toLocaleString('fa-IR')} tone="success" />,
          },
          {
            title: 'استخدام: وثیقه و قرارداد',
            href: '/dashboard/hr/hiring',
            icon: FaUserPlus,
            tone: 'info',
          },
          {
            title: 'قالب وثیقه استخدام',
            href: '/dashboard/hr/hiring/collateral-templates',
            icon: FaClipboardCheck,
            tone: 'neutral',
          },
          {
            title: 'مالیات و سامانه مودیان',
            href: '/dashboard/accounting/tax',
            icon: FaBalanceScale,
            tone: 'purple',
            badge: <StatusBadge label={(commandCenter.taxNotReady?.count || 0).toLocaleString('fa-IR')} tone="purple" />,
          },
          {
            title: 'بررسی اصلاحات',
            href: '/dashboard/accounting/correction-requests',
            icon: FaExclamationTriangle,
            tone: 'warning',
            badge: <StatusBadge label={(commandCenter.correctionRequests?.count || 0).toLocaleString('fa-IR')} tone="warning" />,
          },
          {
            title: 'سوابق عملیات',
            href: '/dashboard/accounting/audit',
            icon: FaHistory,
            tone: 'neutral',
          },
          {
            title: 'عملکرد حسابداران',
            href: '/dashboard/accounting/performance',
            icon: FaUserClock,
            tone: 'primary',
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <QueueList
          title="دریافتنی‌های نزدیک سررسید"
          items={queues.receivables || []}
          emptyText="دریافتنی بازی برای نمایش وجود ندارد."
          actions={[{ label: 'مشاهده همه', href: '/dashboard/accounting/receivables', icon: FaReceipt, tone: 'success' }]}
          renderItem={(item: any) => (
            <CompactQueueItem
              key={item.id}
              icon={accountingIcons.receivable}
              title="دریافتنی قرارداد"
              meta={`سررسید: ${dateFa(item.dueDate)}`}
              amount={money(item.remainingAmount, item.currency)}
              status={<StatusBadge status={item.status} />}
            />
          )}
        />

        <QueueList
          title="مالیات و سامانه مودیان"
          items={queues.tax || []}
          emptyText="پرونده مالیاتی فعالی در صف نیست."
          actions={[{ label: 'مشاهده همه', href: '/dashboard/accounting/tax', icon: FaBalanceScale, tone: 'purple' }]}
          renderItem={(item: any) => (
            <CompactQueueItem
              key={item.id}
              icon={FaBalanceScale}
              title={taxStatusLabels[item.submissionStatus] || item.submissionStatus}
              meta={item.trackingCode ? `کد پیگیری: ${item.trackingCode}` : `آخرین تغییر: ${dateFa(item.updatedAt)}`}
              amount={money(item.taxableAmount)}
              status={<StatusBadge status={item.submissionStatus} />}
            />
          )}
        />
      </div>

      <ErpSection
        title="بررسی اصلاحات"
        description="درخواست‌هایی که حسابداری برای تکمیل اطلاعات فروش، مشتری، پرداخت، تحویل یا مالیات ثبت کرده است."
        actions={[{ label: 'مشاهده همه', href: '/dashboard/accounting/correction-requests', icon: FaExclamationTriangle, tone: 'warning' }]}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(queues.corrections || []).slice(0, 6).map((item: any) => (
            <CompactQueueItem
              key={item.id}
              icon={FaExclamationTriangle}
              title={item.accountantNote}
              meta={`اولویت: ${item.priority} · ${dateFa(item.createdAt)}`}
              status={<StatusBadge status={item.status} />}
            />
          ))}
          {(!queues.corrections || queues.corrections.length === 0) && (
            <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">درخواست اصلاح بازی وجود ندارد.</p>
          )}
        </div>
      </ErpSection>
      <ErpSection title="فرمان‌های ارسال حسابداری" description="پذیرش یا رد نامزد، بارنامه و تأیید راننده فقط در مالکیت حسابداری انجام می‌شود.">
        {dispatchNotice && <ErpInlineState kind={dispatchNotice.kind} title={dispatchNotice.text} />}
        <div className="mb-3"><ErpInput aria-label="دلیل فرمان ارسال" value={dispatchReason} onChange={(event) => setDispatchReason(event.target.value)} placeholder="دلیل رد، ابطال، جایگزینی یا لغو مجوز" /></div>
        {!dispatchCandidates.length ? <ErpEmptyState title="نامزد ارسال حسابداری وجود ندارد" /> : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{dispatchCandidates.map((candidate) => {
          const activeWaybill = candidate.waybills?.find((waybill: any) => waybill.status === 'ISSUED');
          return <ErpCard key={candidate.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-2"><strong>{candidate.id}</strong><ErpBadge tone={candidate.status === 'ACCEPTED' ? 'success' : candidate.status === 'REJECTED' ? 'danger' : 'warning'}>{candidate.status}</ErpBadge></div>
            {candidate.status === 'PENDING' && dispatchCapabilities.canManageAccountingCandidates && <div className="mt-3 flex flex-wrap gap-2"><ErpButton label="پذیرش و صدور بارنامه" disabled={dispatchTimelineStale} onClick={() => void runDispatch(() => accountingAPI.decideDispatchCandidate(candidate.id, { action: 'ACCEPT', reason: '', idempotencyKey: crypto.randomUUID() }), 'نامزد پذیرفته و بارنامه صادر شد.')} /><ErpButton label="رد نامزد" tone="danger" variant="outline" disabled={dispatchTimelineStale || !dispatchReason.trim()} onClick={() => void runDispatch(() => accountingAPI.decideDispatchCandidate(candidate.id, { action: 'REJECT', reason: dispatchReason.trim(), idempotencyKey: crypto.randomUUID() }), 'نامزد رد شد.')} /></div>}
            {activeWaybill && <div className="mt-3 space-y-2"><p className="text-sm sds-text-secondary">بارنامه {activeWaybill.number}</p><div className="flex flex-wrap gap-2">{dispatchCapabilities.canManageAccountingConfirmation && <ErpButton label="آغاز تأیید راننده" variant="soft" disabled={dispatchTimelineStale} onClick={() => void runDispatch(() => dispatchConfirmationAPI.startSession(activeWaybill.id, 'ACCOUNTING-WEB'), 'نشست تأیید آغاز شد.')} />}{dispatchCapabilities.canManageAccountingCandidates && <><ErpButton label="ابطال بارنامه" tone="danger" variant="outline" disabled={dispatchTimelineStale || !dispatchReason.trim()} onClick={() => void runDispatch(() => accountingAPI.voidDispatchWaybill(activeWaybill.id, { reason: dispatchReason.trim(), idempotencyKey: crypto.randomUUID() }), 'بارنامه باطل شد.')} /><ErpButton label="جایگزینی بارنامه" variant="outline" disabled={dispatchTimelineStale || !dispatchReason.trim()} onClick={() => void runDispatch(() => accountingAPI.replaceDispatchWaybill(activeWaybill.id, { reason: dispatchReason.trim(), idempotencyKey: crypto.randomUUID() }), 'بارنامه جایگزین صادر شد.')} /></>}</div></div>}
          </ErpCard>;
        })}</div>}
        {confirmation?.id && dispatchCapabilities.canManageAccountingConfirmation && <ErpCard className="mt-4 p-4"><strong>نشست تأیید {confirmation.id}</strong><div className="mt-3 flex flex-wrap gap-2"><ErpButton label="تطبیق بیومتریک" disabled={dispatchTimelineStale} onClick={() => void runDispatch(() => dispatchConfirmationAPI.verifyBiometric(confirmation.id), 'تلاش بیومتریک ثبت شد.')} /><ErpButton label="آغاز مسیر جایگزین" variant="outline" disabled={dispatchTimelineStale} onClick={() => void runDispatch(() => dispatchConfirmationAPI.beginFallback(confirmation.id), 'مسیر جایگزین آغاز شد.')} /><ErpButton label="ارسال دوباره رمز" variant="ghost" disabled={dispatchTimelineStale} onClick={() => void runDispatch(() => dispatchConfirmationAPI.resendOtp(confirmation.id), 'رمز دوباره ارسال شد.')} /></div><div className="mt-3 flex flex-wrap gap-2"><ErpInput aria-label="رمز یک‌بارمصرف راننده" value={otpCode} onChange={(event) => setOtpCode(event.target.value)} /><ErpButton label="تأیید رمز" disabled={dispatchTimelineStale || !otpCode.trim()} onClick={() => void runDispatch(() => dispatchConfirmationAPI.verifyOtp(confirmation.id, otpCode.trim()), 'رمز راننده تأیید شد.')} /></div>{confirmation.authorization?.id && <div className="mt-3"><ErpButton label="لغو مجوز خروج" tone="danger" variant="outline" disabled={dispatchTimelineStale || !dispatchReason.trim()} onClick={() => void runDispatch(() => dispatchConfirmationAPI.revokeAuthorization(confirmation.authorization.id, dispatchReason.trim()), 'مجوز خروج لغو شد.')} /></div>}</ErpCard>}
      </ErpSection>
      <RoleAwareDispatchCases workspace="accounting" onStaleChange={setDispatchTimelineStale} />
    </ErpPage>
  );
}
