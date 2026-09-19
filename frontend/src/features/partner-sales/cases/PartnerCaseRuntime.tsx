'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ErpButton, ErpCheckbox, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpRialInput, ErpSheet, ErpTextarea, ErpWorkspacePage } from '@/components/erp';
import { FaFileContract } from 'react-icons/fa';
import { PartnerCaseWorkspace } from './PartnerCaseWorkspace';
import { finalizePartnerCase, openPartnerPdf, readPartnerAccount, readPartnerCases, sendPartnerConfirmation,
  readPartnerCollections, readPartnerCorrection, requestPartnerCorrection,
  cancelPartnerCase, recordPartnerCollection, reversePartnerCollection, savePartnerRetailCorrection,
  type PartnerCaseRuntimeRow } from './partnerCaseHttpPort';
import type { PartnerAccountView } from '@sabalanerp/partner-sales-contracts';
import type { RetailCollectionHistory } from '../collections/RetailCollectionsPanel';
import type { PartnerCorrectionStatus } from './PartnerCorrectionPanel';
import { assertSuccessfulSalesResult, getSalesOperationalErrorKind, getSalesOperationalErrorMessage, normalizeSalesBlobError } from '@/features/sales/salesOperationalError';
import { normalizePartnerSalesOperationalError } from '../partnerSalesErrorMessage';
import { createLatestRequestTracker } from '@/features/sales/latestRequestTracker';

export function PartnerCaseRuntime() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedCaseId = searchParams.get('caseId') || undefined;
  const [rows, setRows] = useState<PartnerCaseRuntimeRow[]>([]);
  const [account, setAccount] = useState<PartnerAccountView>();
  const [collections, setCollections] = useState<Record<string, RetailCollectionHistory>>({});
  const [corrections, setCorrections] = useState<Record<string, PartnerCorrectionStatus | null>>({});
  const [busy, setBusy] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const actionFlight = useRef(false);
  const [cancelTarget, setCancelTarget] = useState<PartnerCaseRuntimeRow>();
  const [cancelReason, setCancelReason] = useState('');
  const [finalizeTarget, setFinalizeTarget] = useState<PartnerCaseRuntimeRow>();
  const [lossAccepted, setLossAccepted] = useState(false);
  const [collectionTarget, setCollectionTarget] = useState<PartnerCaseRuntimeRow>();
  const [collectionAmount, setCollectionAmount] = useState('');
  const [collectionDate, setCollectionDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [reversalTarget, setReversalTarget] = useState<{ row: PartnerCaseRuntimeRow; receiptId: string }>();
  const [reversalReason, setReversalReason] = useState('');
  const [loadError, setLoadError] = useState<{ message: string; kind: 'error' | 'permission' | 'stale' }>();
  const [caseErrors, setCaseErrors] = useState<Array<{ key: string; message: string; kind: 'error' | 'permission' | 'stale'; caseId: string; order: number }>>([]);
  const caseErrorSequenceRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const actionTrackerRef = useRef(createLatestRequestTracker());
  const beginCaseAction = useCallback((key: string) => {
    return actionTrackerRef.current.begin(key);
  }, []);
  const isLatestCaseAction = useCallback((key: string, sequence: number) => actionTrackerRef.current.isLatest(key, sequence), []);
  const reportCaseError = useCallback((key: string, value: Omit<(typeof caseErrors)[number], 'key' | 'order'>) => {
    const order = ++caseErrorSequenceRef.current;
    setCaseErrors((current) => [...current.filter((item) => item.key !== key), { ...value, key, order }]);
  }, []);
  const clearCaseError = useCallback((key: string) => {
    setCaseErrors((current) => current.filter((item) => item.key !== key));
  }, []);
  const latestCaseError = (caseId: string) => caseErrors
    .filter((item) => item.caseId === caseId)
    .sort((left, right) => right.order - left.order)[0];
  const load = useCallback(async () => {
    const requestSequence = ++loadSequenceRef.current;
    setBusy(true);
    try {
      const [cases, accountResult] = await Promise.all([
        readPartnerCases(selectedCaseId),
        readPartnerAccount()
          .then(value => ({ ok: true as const, value }))
          .catch(reason => ({ ok: false as const, reason }))
      ]);
      if (requestSequence !== loadSequenceRef.current) return;
      setRows(cases);
      if (accountResult.ok) setAccount(accountResult.value);
      const supplementary = await Promise.all(cases.map(async row => {
        const caseId = row.view.owner.caseId;
        const collectionsResult = ['COMMITTED', 'VOIDED'].includes(row.view.state)
          ? await readPartnerCollections(row.view.owner)
            .then(value => ({ ok: true as const, value }))
            .catch(reason => ({ ok: false as const, reason }))
          : undefined;
        const correctionResult = await readPartnerCorrection(caseId)
          .then(value => ({ ok: true as const, value }))
          .catch(reason => ({ ok: false as const, reason }));
        return { caseId, collectionsResult, correctionResult };
      }));
      if (requestSequence !== loadSequenceRef.current) return;
      setCollections(current => {
        const next = { ...current };
        supplementary.forEach(item => {
          if (item.collectionsResult?.ok) next[item.caseId] = item.collectionsResult.value;
        });
        return next;
      });
      setCorrections(current => {
        const next = { ...current };
        supplementary.forEach(item => {
          if (item.correctionResult.ok) next[item.caseId] = item.correctionResult.value;
        });
        return next;
      });
      supplementary.forEach(item => {
        const collectionKey = `${item.caseId}:load-collections`;
        if (item.collectionsResult?.ok) clearCaseError(collectionKey);
        else if (item.collectionsResult) {
          const reason = normalizePartnerSalesOperationalError(item.collectionsResult.reason);
          reportCaseError(collectionKey, { caseId: item.caseId, kind: getSalesOperationalErrorKind(reason), message: getSalesOperationalErrorMessage(reason, {
            failedAction: 'دریافت سابقهٔ وصول این پرونده',
            nextStep: 'اطلاعات قبلی حفظ شده است؛ صفحه را تازه‌سازی کنید.'
          }) });
        }
        const correctionKey = `${item.caseId}:load-correction`;
        if (item.correctionResult.ok) clearCaseError(correctionKey);
        else {
          const reason = normalizePartnerSalesOperationalError(item.correctionResult.reason);
          reportCaseError(correctionKey, { caseId: item.caseId, kind: getSalesOperationalErrorKind(reason), message: getSalesOperationalErrorMessage(reason, {
            failedAction: 'دریافت وضعیت اصلاح این پرونده',
            nextStep: 'اطلاعات قبلی حفظ شده است؛ صفحه را تازه‌سازی کنید.'
          }) });
        }
      });
      if (accountResult.ok) {
        setLoadError(undefined);
      } else {
        const reason = normalizePartnerSalesOperationalError(accountResult.reason);
        setLoadError({ kind: getSalesOperationalErrorKind(reason), message: getSalesOperationalErrorMessage(reason, {
          failedAction: 'دریافت اطلاعات حساب فروش همکار',
          nextStep: 'پرونده‌ها و اطلاعات قبلی حفظ شده‌اند؛ دوباره تلاش کنید.'
        }) });
      }
    } catch (reason) {
      if (requestSequence !== loadSequenceRef.current) return;
      const normalizedReason = normalizePartnerSalesOperationalError(reason);
      setLoadError({ kind: getSalesOperationalErrorKind(normalizedReason), message: getSalesOperationalErrorMessage(normalizedReason, {
        failedAction: 'دریافت پرونده‌های فروش همکار',
        nextStep: 'اتصال را بررسی کنید و دوباره تلاش کنید.'
      }) });
    }
    finally { if (requestSequence === loadSequenceRef.current) setBusy(false); }
  }, [clearCaseError, reportCaseError, selectedCaseId]);
  const runAction = useCallback(async (caseId: string, operation: string, name: string, action: () => Promise<unknown>) => {
    if (actionFlight.current) return false;
    actionFlight.current = true;
    setActionPending(true);
    const errorKey = `${caseId}:${operation}`;
    const actionSequence = beginCaseAction(errorKey);
    try {
      const result = await action();
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      assertSuccessfulSalesResult(result as { success?: unknown });
      await load();
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      clearCaseError(errorKey);
      return true;
    }
    catch (reason) {
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      const normalizedReason = normalizePartnerSalesOperationalError(await normalizeSalesBlobError(reason));
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      reportCaseError(errorKey, { caseId, kind: getSalesOperationalErrorKind(normalizedReason), message: getSalesOperationalErrorMessage(normalizedReason, {
        failedAction: name,
        nextStep: 'وضعیت پرونده را تازه‌سازی و سپس دوباره بررسی کنید.',
        uncertainMutation: true,
      }) });
      return false;
    } finally { actionFlight.current = false; setActionPending(false); }
  }, [beginCaseAction, clearCaseError, isLatestCaseAction, load, reportCaseError]);
  const previewPdf = useCallback(async (caseId: string, snapshotId: string, mode: 'PREVIEW' | 'FINAL' = 'PREVIEW') => {
    if (mode === 'FINAL') {
      if (actionFlight.current) return;
      actionFlight.current = true;
      setActionPending(true);
    }
    const operation = mode === 'FINAL' ? 'issue' : 'preview';
    const errorKey = `${caseId}:${operation}`;
    const actionSequence = beginCaseAction(errorKey);
    try {
      await openPartnerPdf(caseId, snapshotId, mode);
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      if (mode === 'FINAL') await load();
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      clearCaseError(errorKey);
    } catch (reason) {
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      const normalizedReason = normalizePartnerSalesOperationalError(await normalizeSalesBlobError(reason));
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      reportCaseError(errorKey, { caseId, kind: getSalesOperationalErrorKind(normalizedReason), message: getSalesOperationalErrorMessage(normalizedReason, {
        failedAction: mode === 'FINAL' ? 'صدور سند فروش همکار' : 'پیش‌نمایش سند فروش همکار',
        nextStep: mode === 'FINAL' ? 'دوباره روی «صدور سند» بزنید.' : 'دوباره روی «پیش‌نمایش» بزنید.',
      }) });
    } finally {
      if (mode === 'FINAL') { actionFlight.current = false; setActionPending(false); }
    }
  }, [beginCaseAction, clearCaseError, isLatestCaseAction, load, reportCaseError]);
  useEffect(() => { void load(); }, [load]);
  if (busy) return <ErpLoading />;
  return <ErpWorkspacePage title="پرونده‌های فروش همکار" context="حقیقت جاری پرونده، وصول و حساب سبلان">
    {loadError && <ErpInlineState kind={loadError.kind} title={loadError.message} action={{ label: 'تلاش دوباره', onClick: load }} />}
    {!loadError && !rows.length && <ErpEmptyState icon={FaFileContract} title="پرونده‌ای ثبت نشده است" />}
    <div className="space-y-8">
      {rows.map((row, index) => {
        const error = latestCaseError(row.view.owner.caseId);
        return (
          <div key={row.view.owner.caseId} className="space-y-2">
            {error && <ErpInlineState kind={error.kind} title={error.message} />}
            <PartnerCaseWorkspace
              view={row.view}
              account={index === 0 ? account : undefined}
              collections={collections[row.view.owner.caseId]}
              correction={corrections[row.view.owner.caseId]}
              canRecordCollection={row.view.state === 'COMMITTED'}
              onRecordCollection={() => { setCollectionTarget(row); setCollectionAmount(''); }}
              onReverseCollection={receiptId => { setReversalTarget({ row, receiptId }); setReversalReason(''); }}
              onSaveCorrection={input => void runAction(row.view.owner.caseId, 'save-correction', 'ثبت اصلاح فروش همکار', () => savePartnerRetailCorrection(row.view, input))}
              onRequestCorrection={(scope) => void runAction(row.view.owner.caseId, `request-correction:${scope}`, 'ثبت درخواست اصلاح فروش همکار', () => requestPartnerCorrection(row.view, scope))}
              actions={{
                ...row.actions,
                onContinue: row.editRecovery ? () => router.push(`/dashboard/sales/contracts/create?caseId=${encodeURIComponent(row.view.owner.caseId)}&draftId=${encodeURIComponent(row.editRecovery!.recoveryId)}&baseRevision=${row.editRecovery!.baseRevision}`) : undefined,
                onCancel: () => { setCancelTarget(row); setCancelReason(''); },
                onPreview: row.snapshotId ? () => void previewPdf(row.view.owner.caseId, row.snapshotId!) : undefined,
                onIssue: row.snapshotId ? () => void previewPdf(row.view.owner.caseId, row.snapshotId!, 'FINAL') : undefined,
                onFinalize: () => { setFinalizeTarget(row); setLossAccepted(false); },
                onSendConfirmation: () => void runAction(row.view.owner.caseId, 'send-confirmation', 'ارسال تأییدیه فروش همکار', () => sendPartnerConfirmation(row.view.owner.caseId)),
                onRequestCorrection: () => void runAction(row.view.owner.caseId, 'request-correction:retail', 'ثبت درخواست اصلاح فروش همکار', () => requestPartnerCorrection(row.view, 'RETAIL_ONLY')),
                onRequestVoid: () => void runAction(row.view.owner.caseId, 'request-void', 'ثبت درخواست ابطال فروش همکار', () => requestPartnerCorrection(row.view, 'VOID')),
              }}
            />
          </div>
        );
      })}
    </div>
    <ErpSheet open={Boolean(finalizeTarget)} onClose={() => { if (!actionPending) setFinalizeTarget(undefined); }}
      title="تأیید و نهایی‌سازی قرارداد" presentation="modal" pending={actionPending}
      footer={<ErpButton label="تأیید و نهایی‌سازی قرارداد" tone="success"
        disabled={actionPending || Boolean(finalizeTarget?.view.resaleDifference?.startsWith('-') && !lossAccepted)}
        onClick={() => {
          if (!finalizeTarget) return;
          void runAction(finalizeTarget.view.owner.caseId, 'finalize', 'نهایی‌سازی قرارداد فروش همکار',
            () => finalizePartnerCase(finalizeTarget.view, lossAccepted)).then(saved => { if (saved) setFinalizeTarget(undefined); });
        }} />}>
      <ErpInlineState kind={finalizeTarget?.view.customerConfirmationState === 'APPROVED' ? 'success' : 'stale'}
        title={finalizeTarget?.view.customerConfirmationState === 'APPROVED'
        ? 'مشتری این نسخه را تأیید کرده است.'
        : 'مشتری هنوز این نسخه را تأیید نکرده است. با نهایی‌سازی، تعهد شما به سبلان مستقل از پاسخ مشتری ایجاد می‌شود.'} />
      {finalizeTarget?.view.resaleDifference?.startsWith('-') && <ErpCheckbox
        label="زیان این قرارداد را بررسی کرده‌ام و صریحاً می‌پذیرم"
        checked={lossAccepted} onChange={event => setLossAccepted(event.target.checked)} />}
    </ErpSheet>
    <ErpSheet open={Boolean(cancelTarget)} onClose={() => { if (!actionPending) setCancelTarget(undefined); }} title="لغو پیش از قطعیت" presentation="modal" pending={actionPending}
      footer={<ErpButton label="ثبت لغو" tone="danger" disabled={actionPending || !/[\u0600-\u06ff]/.test(cancelReason) || !cancelReason.trim()} onClick={() => {
        if (!cancelTarget) return; void runAction(cancelTarget.view.owner.caseId, 'cancel', 'لغو پرونده', () => cancelPartnerCase(cancelTarget.view, cancelReason.trim())).then(saved => { if (saved) setCancelTarget(undefined); });
      }} />}>
      <ErpInlineState kind="stale" title="لغو، هر دو سمت پرونده را با حفظ سابقه متوقف می‌کند و قابل برگشت مستقیم نیست." />
      <ErpField label="دلیل لغو" required><ErpTextarea value={cancelReason} maxLength={4000} onChange={event => setCancelReason(event.target.value)} /></ErpField>
    </ErpSheet>
    <ErpSheet open={Boolean(collectionTarget)} onClose={() => { if (!actionPending) setCollectionTarget(undefined); }} title="ثت وصول مشتری" presentation="modal" pending={actionPending}
      footer={<ErpButton label="ثبت وصول" disabled={actionPending || !collectionAmount || !collectionDate} onClick={() => {
        if (!collectionTarget) return; const history = collections[collectionTarget.view.owner.caseId]; if (!history) return;
        void runAction(collectionTarget.view.owner.caseId, 'record-collection', 'ثبت وصول', () => recordPartnerCollection(collectionTarget.view, history, collectionAmount, collectionDate)).then(saved => { if (saved) setCollectionTarget(undefined); });
      }} />}>
      <ErpInlineState kind="permission" title="این وصول فقط در حساب خصوصی فروش شما ثبت می‌شود و بدهی شما به سبلان را تغییر نمی‌دهد." />
      <div className="grid gap-4 sm:grid-cols-2"><ErpField label="مبلغ وصول" required><ErpRialInput value={collectionAmount} onValueChange={setCollectionAmount} /></ErpField>
        <ErpField label="تاریخ مؤثر" required><ErpInput type="date" value={collectionDate} onChange={event => setCollectionDate(event.target.value)} /></ErpField></div>
    </ErpSheet>
    <ErpSheet open={Boolean(reversalTarget)} onClose={() => { if (!actionPending) setReversalTarget(undefined); }} title="برگشت وصول مشتری" presentation="modal" pending={actionPending}
      footer={<ErpButton label="ثبت برگشت" tone="danger" disabled={actionPending || !/[\u0600-\u06ff]/.test(reversalReason)} onClick={() => {
        if (!reversalTarget) return; void runAction(reversalTarget.row.view.owner.caseId, 'reverse-collection', 'برگشت وصول', () => reversePartnerCollection(reversalTarget.row.view, reversalTarget.receiptId, collectionDate, reversalReason.trim()))
          .then(saved => { if (saved) setReversalTarget(undefined); });
      }} />}>
      <ErpInlineState kind="stale" title="برگشت به همان receipt و نسخه برنامه پرداخت متصل می‌ماند و سابقه حذف نمی‌شود." />
      <div className="grid gap-4 sm:grid-cols-2"><ErpField label="دلیل برگشت" required><ErpTextarea value={reversalReason} maxLength={4000} onChange={event => setReversalReason(event.target.value)} /></ErpField>
        <ErpField label="تاریخ مؤثر" required><ErpInput type="date" value={collectionDate} onChange={event => setCollectionDate(event.target.value)} /></ErpField></div>
    </ErpSheet>
  </ErpWorkspacePage>;
}
