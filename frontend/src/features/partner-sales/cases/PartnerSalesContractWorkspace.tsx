'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PartnerCaseView, PartnerCaseRuntimeRow } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpCheckbox, ErpFieldView, ErpInlineState, ErpSheet, ErpTextarea, type ErpAction } from '@/components/erp';
import { partnerSalesActionFeedback } from '../partnerSalesErrorMessage';
import { formatPartnerMoney } from '../presentation';
import { PartnerCaseWorkspace } from './PartnerCaseWorkspace';
import { assertSuccessfulSalesResult } from '@/features/sales/salesOperationalError';
import { cancelPartnerCase, decidePartnerCommercial, finalizePartnerCase, openPartnerPdf, readPartnerCases, requestPartnerCorrection, sendPartnerConfirmation } from './partnerCaseHttpPort';

/** Uses the same Case permissions and commands as the Partner workspace. */
export function PartnerSalesContractWorkspace({ view, canDownload, canPrint, onDownload, onPrint, decisionActions }: {
  view: PartnerCaseView;
  canDownload?: boolean; canPrint?: boolean; onDownload?: () => void; onPrint?: () => void;
  decisionActions?: ErpAction[];
}) {
  const router = useRouter();
  const [row, setRow] = useState<PartnerCaseRuntimeRow>();
  const [error, setError] = useState<ReturnType<typeof partnerSalesActionFeedback>>();
  const actionFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [lossAccepted, setLossAccepted] = useState(false);
  const load = useCallback(async (allowNewRevision = false) => {
    try {
      const next = (await readPartnerCases(view.owner.caseId))[0];
      if (!next || (!allowNewRevision && (next.view.owner.revision !== view.owner.revision ||
          next.view.owner.integrityHash !== view.owner.integrityHash))) {
        setError({ kind: 'stale', message: 'نسخهٔ پرونده تغییر کرده است. صفحه را دوباره باز کنید.' });
        return;
      }
      setRow(next); setError(undefined);
    } catch (failure) {
      setError(partnerSalesActionFeedback(failure, 'دریافت اقدام‌های پرونده'));
    }
  }, [view.owner.caseId, view.owner.revision, view.owner.integrityHash]);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (actionFlight.current) return false;
    actionFlight.current = true;
    setPending(true); setError(undefined);
    try { await action(); await load(true); router.refresh(); return true; }
    catch (failure) { setError(partnerSalesActionFeedback(failure, 'انجام اقدام پرونده')); return false; }
    finally { actionFlight.current = false; setPending(false); }
  };
  const actions = row?.actions;
  const currentView = row?.view ?? view;
  return <>
    {error && <ErpInlineState kind={error.kind} title={error.message} action={{ label: 'تلاش دوباره', onClick: () => void load() }} />}
    <PartnerCaseWorkspace view={currentView}
      commercial={row?.commercial}
      customerOutput={row?.customerOutput} history={row?.history}
      accountingCorrectionRequests={row?.accountingCorrectionRequests}
      onRequestCorrection={scope => { if (!pending) void run(() => requestPartnerCorrection(currentView, scope)); }}
      actions={{
        canDownload, canPrint, onDownload, onPrint, pending,
        decisionActions: row?.commercial ? [
          ...(actions?.canApproveSales ? [{ label: 'تایید', tone: 'success' as const,
            onClick: () => void run(() => decidePartnerCommercial(currentView.owner.caseId, row.commercial!.revision, 'APPROVE_SALES')) }] : []),

        ] : row ? decisionActions : [],
        canPreview: Boolean(actions?.canPreview), canIssue: Boolean(actions?.canIssue),
        canContinue: Boolean(actions?.canContinue), canFinalize: Boolean(actions?.canFinalize),
        canReviewPricing: row?.commercial?.inquiry !== 'ACCEPTED' && ['READY', 'PARTIAL', 'REJECTED'].includes(row?.pricingResponseState || ''),
        canSendConfirmation: Boolean(actions?.canSendConfirmation),
        canRequestCorrection: Boolean(actions?.canRequestCorrection),
        canCancel: false, canRequestVoid: Boolean(actions?.canRequestVoid),
        onPreview: () => void run(() => openPartnerPdf(currentView.owner.caseId, currentView.state === 'COMMITTED' ? undefined : row?.snapshotId ?? undefined, 'PREVIEW', currentView.owner)),
        onIssue: () => void run(() => openPartnerPdf(currentView.owner.caseId, undefined, 'FINAL', currentView.owner)),
        onSendConfirmation: () => { if (!pending) void run(async () => {
          const result = await sendPartnerConfirmation(currentView.owner.caseId);
          assertSuccessfulSalesResult(result);
          return result;
        }); },
        onContinue: row?.editRecovery ? () => router.push(
          `/dashboard/sales/contracts/create?caseId=${encodeURIComponent(view.owner.caseId)}&draftId=${encodeURIComponent(row.editRecovery!.recoveryId)}&baseRevision=${row.editRecovery!.baseRevision}${['READY', 'PARTIAL', 'REJECTED'].includes(row.pricingResponseState || '') ? '&returnTo=contract&step=5' : ''}`) : undefined,
        onRequestCorrection: () => { if (!pending) void run(() => requestPartnerCorrection(currentView, 'RETAIL_ONLY')); },
        onCancel: () => { if (!pending) setCancelOpen(true); },
        onRequestVoid: () => { if (!pending) void run(() => requestPartnerCorrection(currentView, 'VOID')); },
        onFinalize: () => { if (!pending) { setLossAccepted(false); setFinalizeOpen(true); } },
      }} />
    <ErpSheet open={finalizeOpen} onClose={() => { if (!pending) setFinalizeOpen(false); }}
      title="تأیید و نهایی‌سازی قرارداد" presentation="modal" pending={pending}
      footer={<ErpButton label="تأیید و نهایی‌سازی قرارداد" tone="success"
        disabled={pending || Boolean(currentView.resaleDifference?.startsWith('-') && !lossAccepted)}
        onClick={() => void run(() => finalizePartnerCase(currentView, lossAccepted)).then(ok => { if (ok) setFinalizeOpen(false); })} />}>
      <ErpInlineState kind={currentView.customerConfirmationState === 'APPROVED' ? 'success' : 'stale'}
        title={currentView.customerConfirmationState === 'APPROVED' ? 'مشتری این نسخه را تأیید کرده است.'
          : 'تعهد خرید از سبلان مستقل از پاسخ مشتری ثبت می‌شود.'} />
      {currentView.sabalanTotals && <div className="grid gap-3 sm:grid-cols-2">
        <ErpFieldView label="فروش به مشتری" value={formatPartnerMoney(currentView.retailTotals.payable, currentView.retailTotals.currency)} />
        <ErpFieldView label="خرید از سبلان" value={formatPartnerMoney(currentView.sabalanTotals.payable, currentView.sabalanTotals.currency)} />
      </div>}
      {currentView.resaleDifference?.startsWith('-') && <ErpCheckbox checked={lossAccepted}
        label="زیان این قرارداد را بررسی کرده‌ام و می‌پذیرم" onChange={event => setLossAccepted(event.target.checked)} />}
    </ErpSheet>
    <ErpSheet open={cancelOpen} onClose={() => { if (!pending) setCancelOpen(false); }}
      title="لغو پرونده فروش همکار" presentation="modal" pending={pending}
      footer={<ErpButton label="ثبت لغو" tone="danger" disabled={pending || !cancelReason.trim()}
        onClick={() => void run(() => cancelPartnerCase(currentView, cancelReason.trim())).then(ok => { if (ok) setCancelOpen(false); })} />}>
      <ErpTextarea value={cancelReason} onChange={event => setCancelReason(event.target.value)}
        placeholder="دلیل لغو را بنویسید" aria-label="دلیل لغو" />
    </ErpSheet>
  </>;
}
