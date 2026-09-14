'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ErpButton, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpRialInput, ErpSheet, ErpTextarea, ErpWorkspacePage } from '@/components/erp';
import { FaFileContract } from 'react-icons/fa';
import { PartnerCaseWorkspace } from './PartnerCaseWorkspace';
import { openPartnerPdf, readPartnerAccount, readPartnerCases, sendPartnerConfirmation,
  readPartnerCollections, readPartnerCorrection, requestPartnerCorrection,
  cancelPartnerCase, recordPartnerCollection, reversePartnerCollection, savePartnerRetailCorrection,
  type PartnerCaseRuntimeRow } from './partnerCaseHttpPort';
import type { PartnerAccountView } from '@sabalanerp/partner-sales-contracts';
import type { RetailCollectionHistory } from '../collections/RetailCollectionsPanel';
import type { PartnerCorrectionStatus } from './PartnerCorrectionPanel';

export function PartnerCaseRuntime() {
  const searchParams = useSearchParams();
  const selectedCaseId = searchParams.get('caseId') || undefined;
  const [rows, setRows] = useState<PartnerCaseRuntimeRow[]>([]);
  const [account, setAccount] = useState<PartnerAccountView>();
  const [collections, setCollections] = useState<Record<string, RetailCollectionHistory>>({});
  const [corrections, setCorrections] = useState<Record<string, PartnerCorrectionStatus | null>>({});
  const [busy, setBusy] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const actionFlight = useRef(false);
  const [error, setError] = useState<string>();
  const [cancelTarget, setCancelTarget] = useState<PartnerCaseRuntimeRow>();
  const [cancelReason, setCancelReason] = useState('');
  const [collectionTarget, setCollectionTarget] = useState<PartnerCaseRuntimeRow>();
  const [collectionAmount, setCollectionAmount] = useState('');
  const [collectionDate, setCollectionDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [reversalTarget, setReversalTarget] = useState<{ row: PartnerCaseRuntimeRow; receiptId: string }>();
  const [reversalReason, setReversalReason] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError(undefined);
    try {
      const [cases, accountView] = await Promise.all([readPartnerCases(selectedCaseId), readPartnerAccount().catch(() => undefined)]);
      setRows(cases); setAccount(accountView);
      const supplementary = await Promise.all(cases.map(async row => ({ caseId: row.view.owner.caseId,
        collections: ['COMMITTED', 'VOIDED'].includes(row.view.state)
          ? await readPartnerCollections(row.view.owner).catch(() => undefined) : undefined,
        correction: await readPartnerCorrection(row.view.owner.caseId).catch(() => undefined) })));
      setCollections(Object.fromEntries(supplementary.flatMap(item => item.collections ? [[item.caseId, item.collections]] : [])));
      setCorrections(Object.fromEntries(supplementary.flatMap(item => item.correction !== undefined
        ? [[item.caseId, item.correction]] : [])));
    } catch { setError('دریافت پرونده‌های فروش همکار ممکن نشد.'); }
    finally { setBusy(false); }
  }, [selectedCaseId]);
  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    if (actionFlight.current) return false;
    actionFlight.current = true;
    setActionPending(true);
    setError(undefined);
    try { await action(); await load(); return true; }
    catch { setError('انجام عملیات پرونده ممکن نشد. لطفاً دوباره تلاش کنید.'); return false; }
    finally { actionFlight.current = false; setActionPending(false); }
  }, [load]);
  useEffect(() => { void load(); }, [load]);
  if (busy) return <ErpLoading />;
  return <ErpWorkspacePage title="پرونده‌های فروش همکار" context="حقیقت جاری پرونده، وصول و حساب سبلان">
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: load }} />}
    {!error && !rows.length && <ErpEmptyState icon={FaFileContract} title="پرونده‌ای ثبت نشده است" />}
    <div className="space-y-8">{rows.map((row, index) => <PartnerCaseWorkspace key={row.view.owner.caseId}
      view={row.view} account={index === 0 ? account : undefined}
      collections={collections[row.view.owner.caseId]} correction={corrections[row.view.owner.caseId]}
      canRecordCollection={row.view.state === 'COMMITTED'} onRecordCollection={() => { setCollectionTarget(row); setCollectionAmount(''); }}
      onReverseCollection={receiptId => { setReversalTarget({ row, receiptId }); setReversalReason(''); }}
      onRequestCorrection={scope => void runAction(() => requestPartnerCorrection(row.view, scope))}
      onSaveCorrection={input => void runAction(() => savePartnerRetailCorrection(row.view, input))}
      actions={{ ...row.actions,
        onPreview: row.snapshotId ? () => void openPartnerPdf(row.view.owner.caseId, row.snapshotId!, 'PREVIEW') : undefined,
        onIssue: row.snapshotId ? () => void runAction(() => openPartnerPdf(row.view.owner.caseId, row.snapshotId!, 'FINAL')) : undefined,
        onSendConfirmation: () => void runAction(() => sendPartnerConfirmation(row.view.owner.caseId)),
        onRequestCorrection: () => void runAction(() => requestPartnerCorrection(row.view, 'RETAIL_ONLY')),
        onCancel: () => { setCancelTarget(row); setCancelReason(''); },
        onRequestVoid: () => void runAction(() => requestPartnerCorrection(row.view, 'VOID')),
      }} />)}</div>
    <ErpSheet open={Boolean(cancelTarget)} onClose={() => { if (!actionPending) setCancelTarget(undefined); }} title="لغو پیش از قطعیت" presentation="modal" pending={actionPending}
      footer={<ErpButton label="ثبت لغو" tone="danger" disabled={actionPending || !/[\u0600-\u06ff]/.test(cancelReason) || !cancelReason.trim()} onClick={() => {
        if (!cancelTarget) return; void runAction(() => cancelPartnerCase(cancelTarget.view, cancelReason.trim())).then(saved => { if (saved) setCancelTarget(undefined); });
      }} />}>
      <ErpInlineState kind="stale" title="لغو، هر دو سمت پرونده را با حفظ سابقه متوقف می‌کند و قابل برگشت مستقیم نیست." />
      <ErpField label="دلیل لغو" required><ErpTextarea value={cancelReason} maxLength={4000} onChange={event => setCancelReason(event.target.value)} /></ErpField>
    </ErpSheet>
    <ErpSheet open={Boolean(collectionTarget)} onClose={() => { if (!actionPending) setCollectionTarget(undefined); }} title="ثت وصول مشتری" presentation="modal" pending={actionPending}
      footer={<ErpButton label="ثبت وصول" disabled={actionPending || !collectionAmount || !collectionDate} onClick={() => {
        if (!collectionTarget) return; const history = collections[collectionTarget.view.owner.caseId]; if (!history) return;
        void runAction(() => recordPartnerCollection(collectionTarget.view, history, collectionAmount, collectionDate)).then(saved => { if (saved) setCollectionTarget(undefined); });
      }} />}>
      <ErpInlineState kind="permission" title="این وصول فقط در حساب خصوصی فروش شما ثبت می‌شود و بدهی شما به سبلان را تغییر نمی‌دهد." />
      <div className="grid gap-4 sm:grid-cols-2"><ErpField label="مبلغ وصول" required><ErpRialInput value={collectionAmount} onValueChange={setCollectionAmount} /></ErpField>
        <ErpField label="تاریخ مؤثر" required><ErpInput type="date" value={collectionDate} onChange={event => setCollectionDate(event.target.value)} /></ErpField></div>
    </ErpSheet>
    <ErpSheet open={Boolean(reversalTarget)} onClose={() => { if (!actionPending) setReversalTarget(undefined); }} title="برگشت وصول مشتری" presentation="modal" pending={actionPending}
      footer={<ErpButton label="ثبت برگشت" tone="danger" disabled={actionPending || !/[\u0600-\u06ff]/.test(reversalReason)} onClick={() => {
        if (!reversalTarget) return; void runAction(() => reversePartnerCollection(reversalTarget.row.view, reversalTarget.receiptId, collectionDate, reversalReason.trim()))
          .then(saved => { if (saved) setReversalTarget(undefined); });
      }} />}>
      <ErpInlineState kind="stale" title="برگشت به همان receipt و نسخه برنامه پرداخت متصل می‌ماند و سابقه حذف نمی‌شود." />
      <div className="grid gap-4 sm:grid-cols-2"><ErpField label="دلیل برگشت" required><ErpTextarea value={reversalReason} maxLength={4000} onChange={event => setReversalReason(event.target.value)} /></ErpField>
        <ErpField label="تاریخ مؤثر" required><ErpInput type="date" value={collectionDate} onChange={event => setCollectionDate(event.target.value)} /></ErpField></div>
    </ErpSheet>
  </ErpWorkspacePage>;
}
