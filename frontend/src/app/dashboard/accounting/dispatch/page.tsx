'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaSync } from 'react-icons/fa';
import {
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
import RoleAwareDispatchCases from '@/features/dispatch-case/RoleAwareDispatchCases';
import { accountingAPI, dispatchConfirmationAPI } from '@/lib/api';

type DispatchNotice = { kind: 'success' | 'error'; text: string };
const dispatchStatusLabels: Record<string, string> = {
  PENDING: 'در انتظار بررسی',
  ACCEPTED: 'پذیرفته‌شده',
  REJECTED: 'ردشده',
};

export default function AccountingDispatchPage() {
  const [loading, setLoading] = useState(true);
  const [dispatchCandidates, setDispatchCandidates] = useState<any[]>([]);
  const [dispatchReason, setDispatchReason] = useState('');
  const [dispatchTimelineStale, setDispatchTimelineStale] = useState(false);
  const [dispatchNotice, setDispatchNotice] = useState<DispatchNotice | null>(null);
  const [confirmation, setConfirmation] = useState<any>(null);
  const [otpCode, setOtpCode] = useState('');
  const [dispatchCapabilities, setDispatchCapabilities] = useState({
    canManageAccountingCandidates: false,
    canManageAccountingConfirmation: false,
  });

  const loadDispatch = useCallback(async () => {
    setLoading(true);
    setDispatchNotice(null);
    try {
      const [candidates, capabilities] = await Promise.allSettled([
        accountingAPI.getDispatchCandidates(),
        dispatchConfirmationAPI.getCapabilities(),
      ]);
      if (candidates.status === 'fulfilled' && candidates.value.data.success) {
        setDispatchCandidates(candidates.value.data.data || []);
      }
      if (capabilities.status === 'fulfilled' && capabilities.value.data.success) {
        setDispatchCapabilities(capabilities.value.data.data);
      }
      if (candidates.status === 'rejected' && capabilities.status === 'rejected') {
        throw candidates.reason;
      }
    } catch (error: any) {
      setDispatchNotice({
        kind: 'error',
        text: error?.response?.data?.error || 'اطلاعات ارسال حسابداری دریافت نشد.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const runDispatch = async (command: () => Promise<any>, success: string) => {
    setDispatchNotice(null);
    try {
      const response = await command();
      setDispatchNotice({ kind: 'success', text: success });
      if (response.data?.data?.id && response.data?.data?.waybillId) setConfirmation(response.data.data);
      if (response.data?.data?.authorization) {
        setConfirmation((current: any) => ({ ...current, authorization: response.data.data.authorization }));
      }
      try {
        const refreshed = await accountingAPI.getDispatchCandidates();
        setDispatchCandidates(refreshed.data.data || []);
      } catch {
        // Confirmation-only actors may not have permission to list candidates.
      }
    } catch (error: any) {
      setDispatchNotice({ kind: 'error', text: error?.response?.data?.error || 'فرمان ارسال انجام نشد.' });
    }
  };

  useEffect(() => {
    void loadDispatch();
  }, [loadDispatch]);

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حسابداری"
      title="فرمان‌های ارسال"
      backHref="/dashboard/accounting"
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadDispatch, tone: 'neutral' }]}
    >
      <ErpSection
        title="فرمان‌های ارسال حسابداری"
        description="پذیرش یا رد نامزد، بارنامه و تأیید راننده فقط با دسترسی حسابداری انجام می‌شود."
      >
        {dispatchNotice && <ErpInlineState kind={dispatchNotice.kind} title={dispatchNotice.text} />}
        <div className="mb-3">
          <ErpInput
            aria-label="دلیل فرمان ارسال"
            value={dispatchReason}
            onChange={(event) => setDispatchReason(event.target.value)}
            placeholder="دلیل رد، ابطال، جایگزینی یا لغو مجوز"
          />
        </div>
        {!dispatchCandidates.length ? (
          <ErpEmptyState title="نامزد ارسال حسابداری وجود ندارد" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {dispatchCandidates.map((candidate) => {
              const activeWaybill = candidate.waybills?.find((waybill: any) => waybill.status === 'ISSUED');
              return (
                <ErpCard key={candidate.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <strong>{candidate.id}</strong>
                    <ErpBadge tone={candidate.status === 'ACCEPTED' ? 'success' : candidate.status === 'REJECTED' ? 'danger' : 'warning'}>
                      {dispatchStatusLabels[candidate.status] || candidate.status}
                    </ErpBadge>
                  </div>
                  {candidate.status === 'PENDING' && dispatchCapabilities.canManageAccountingCandidates && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ErpButton
                        label="پذیرش و صدور بارنامه"
                        disabled={dispatchTimelineStale}
                        onClick={() => void runDispatch(
                          () => accountingAPI.decideDispatchCandidate(candidate.id, { action: 'ACCEPT', reason: '', idempotencyKey: crypto.randomUUID() }),
                          'نامزد پذیرفته و بارنامه صادر شد.',
                        )}
                      />
                      <ErpButton
                        label="رد نامزد"
                        tone="danger"
                        variant="outline"
                        disabled={dispatchTimelineStale || !dispatchReason.trim()}
                        onClick={() => void runDispatch(
                          () => accountingAPI.decideDispatchCandidate(candidate.id, { action: 'REJECT', reason: dispatchReason.trim(), idempotencyKey: crypto.randomUUID() }),
                          'نامزد رد شد.',
                        )}
                      />
                    </div>
                  )}
                  {activeWaybill && (
                    <div className="mt-3 space-y-2">
                      <p className="sds-text-secondary text-sm">بارنامه {activeWaybill.number}</p>
                      <div className="flex flex-wrap gap-2">
                        {dispatchCapabilities.canManageAccountingConfirmation && (
                          <ErpButton
                            label="آغاز تأیید راننده"
                            variant="soft"
                            disabled={dispatchTimelineStale}
                            onClick={() => void runDispatch(
                              () => dispatchConfirmationAPI.startSession(activeWaybill.id, 'ACCOUNTING-WEB'),
                              'نشست تأیید آغاز شد.',
                            )}
                          />
                        )}
                        {dispatchCapabilities.canManageAccountingCandidates && (
                          <>
                            <ErpButton
                              label="ابطال بارنامه"
                              tone="danger"
                              variant="outline"
                              disabled={dispatchTimelineStale || !dispatchReason.trim()}
                              onClick={() => void runDispatch(
                                () => accountingAPI.voidDispatchWaybill(activeWaybill.id, { reason: dispatchReason.trim(), idempotencyKey: crypto.randomUUID() }),
                                'بارنامه باطل شد.',
                              )}
                            />
                            <ErpButton
                              label="جایگزینی بارنامه"
                              variant="outline"
                              disabled={dispatchTimelineStale || !dispatchReason.trim()}
                              onClick={() => void runDispatch(
                                () => accountingAPI.replaceDispatchWaybill(activeWaybill.id, { reason: dispatchReason.trim(), idempotencyKey: crypto.randomUUID() }),
                                'بارنامه جایگزین صادر شد.',
                              )}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </ErpCard>
              );
            })}
          </div>
        )}
        {confirmation?.id && dispatchCapabilities.canManageAccountingConfirmation && (
          <ErpCard className="mt-4 p-4">
            <strong>نشست تأیید {confirmation.id}</strong>
            <div className="mt-3 flex flex-wrap gap-2">
              <ErpButton label="تطبیق بیومتریک" disabled={dispatchTimelineStale} onClick={() => void runDispatch(() => dispatchConfirmationAPI.verifyBiometric(confirmation.id), 'تلاش بیومتریک ثبت شد.')} />
              <ErpButton label="آغاز مسیر جایگزین" variant="outline" disabled={dispatchTimelineStale} onClick={() => void runDispatch(() => dispatchConfirmationAPI.beginFallback(confirmation.id), 'مسیر جایگزین آغاز شد.')} />
              <ErpButton label="ارسال دوباره رمز" variant="ghost" disabled={dispatchTimelineStale} onClick={() => void runDispatch(() => dispatchConfirmationAPI.resendOtp(confirmation.id), 'رمز دوباره ارسال شد.')} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <ErpInput aria-label="رمز یک‌بارمصرف راننده" value={otpCode} onChange={(event) => setOtpCode(event.target.value)} />
              <ErpButton label="تأیید رمز" disabled={dispatchTimelineStale || !otpCode.trim()} onClick={() => void runDispatch(() => dispatchConfirmationAPI.verifyOtp(confirmation.id, otpCode.trim()), 'رمز راننده تأیید شد.')} />
            </div>
            {confirmation.authorization?.id && (
              <div className="mt-3">
                <ErpButton label="لغو مجوز خروج" tone="danger" variant="outline" disabled={dispatchTimelineStale || !dispatchReason.trim()} onClick={() => void runDispatch(() => dispatchConfirmationAPI.revokeAuthorization(confirmation.authorization.id, dispatchReason.trim()), 'مجوز خروج لغو شد.')} />
              </div>
            )}
          </ErpCard>
        )}
      </ErpSection>
      <RoleAwareDispatchCases workspace="accounting" onStaleChange={setDispatchTimelineStale} />
    </ErpPage>
  );
}
