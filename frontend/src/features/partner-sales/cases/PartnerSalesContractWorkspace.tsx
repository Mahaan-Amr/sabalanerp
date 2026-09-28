'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PartnerAccountView, PartnerCaseView, PartnerCaseRuntimeRow } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpCheckbox, ErpFieldView, ErpInlineState, ErpSheet, ErpTextarea, type ErpAction } from '@/components/erp';
import { formatPartnerMoney } from '../presentation';
import { PartnerCaseWorkspace } from './PartnerCaseWorkspace';
import { cancelPartnerCase, finalizePartnerCase, openPartnerPdf, readPartnerCases, requestPartnerCorrection, sendPartnerConfirmation } from './partnerCaseHttpPort';

/** Uses the same Case permissions and commands as the Partner workspace. */
export function PartnerSalesContractWorkspace({ view, account, canDownload, canPrint, onDownload, onPrint, decisionActions }: {
  view: PartnerCaseView; account?: PartnerAccountView;
  canDownload?: boolean; canPrint?: boolean; onDownload?: () => void; onPrint?: () => void;
  decisionActions?: ErpAction[];
}) {
  const router = useRouter();
  const [row, setRow] = useState<PartnerCaseRuntimeRow>();
  const [error, setError] = useState<string>();
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
        setError('نسخهٔ پرونده تغییر کرده است. صفحه را دوباره باز کنید.');
        return;
      }
      setRow(next); setError(undefined);
    } catch {
      setError('اقدام‌های این پرونده دریافت نشد. دوباره تلاش کنید.');
    }
  }, [view.owner.caseId, view.owner.revision, view.owner.integrityHash]);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setPending(true); setError(undefined);
    try { await action(); await load(true); router.refresh(); return true; }
    catch { setError('انجام اقدام کامل نشد. وضعیت پرونده را بررسی و دوباره تلاش کنید.'); return false; }
    finally { setPending(false); }
  };
  const actions = row?.actions;
  const currentView = row?.view ?? view;
  return <>
    {error && <ErpInlineState kind="stale" title={error} action={{ label: 'دریافت دوباره', onClick: () => void load() }} />}
    <PartnerCaseWorkspace view={currentView}
      account={currentView.owner.revision === view.owner.revision ? account : undefined}
      customerOutput={row?.customerOutput} history={row?.history}
      accountingCorrectionRequests={row?.accountingCorrectionRequests}
      onRequestCorrection={scope => { if (!pending) void run(() => requestPartnerCorrection(currentView, scope)); }}
      actions={{
        canDownload, canPrint, onDownload, onPrint, pending, decisionActions,
        canPreview: Boolean(actions?.canPreview), canIssue: Boolean(actions?.canIssue),
        canContinue: Boolean(actions?.canContinue), canFinalize: Boolean(actions?.canFinalize),
        canSendConfirmation: Boolean(actions?.canSendConfirmation),
        canRequestCorrection: Boolean(actions?.canRequestCorrection),
        canCancel: Boolean(actions?.canCancel), canRequestVoid: Boolean(actions?.canRequestVoid),
        onPreview: row?.snapshotId ? () => void run(() => openPartnerPdf(currentView.owner.caseId, row.snapshotId!, 'PREVIEW')) : undefined,
        onIssue: row?.snapshotId ? () => void run(() => openPartnerPdf(currentView.owner.caseId, row.snapshotId!, 'FINAL')) : undefined,
        onSendConfirmation: () => { if (!pending) void run(() => sendPartnerConfirmation(currentView.owner.caseId)); },
        onContinue: row?.editRecovery ? () => router.push(
          `/dashboard/sales/contracts/create?caseId=${encodeURIComponent(view.owner.caseId)}&draftId=${encodeURIComponent(row.editRecovery!.recoveryId)}&baseRevision=${row.editRecovery!.baseRevision}`) : undefined,
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
