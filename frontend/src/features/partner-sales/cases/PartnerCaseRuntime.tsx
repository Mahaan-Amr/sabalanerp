'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ErpEmptyState, ErpInlineState, ErpLoading, ErpWorkspacePage } from '@/components/erp';
import { FaFileContract } from 'react-icons/fa';
import { PartnerCaseWorkspace } from './PartnerCaseWorkspace';
import {
  openPartnerPdf,
  readPartnerAccount,
  readPartnerCases,
  readPartnerCollections,
  readPartnerCorrection,
  requestPartnerCorrection,
  sendPartnerConfirmation,
  type PartnerCaseRuntimeRow,
} from './partnerCaseHttpPort';
import type { PartnerAccountView } from '@sabalanerp/partner-sales-contracts';
import type { RetailCollectionHistory } from '../collections/RetailCollectionsPanel';
import type { PartnerCorrectionStatus } from './PartnerCorrectionPanel';
import { assertSuccessfulSalesResult, getSalesOperationalErrorKind, getSalesOperationalErrorMessage, normalizeSalesBlobError } from '@/features/sales/salesOperationalError';
import { normalizePartnerSalesOperationalError } from '../partnerSalesErrorMessage';
import { createLatestRequestTracker } from '@/features/sales/latestRequestTracker';

export function PartnerCaseRuntime() {
  const [rows, setRows] = useState<PartnerCaseRuntimeRow[]>([]);
  const [account, setAccount] = useState<PartnerAccountView>();
  const [collections, setCollections] = useState<Record<string, RetailCollectionHistory>>({});
  const [corrections, setCorrections] = useState<Record<string, PartnerCorrectionStatus | null>>({});
  const [busy, setBusy] = useState(true);
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
        readPartnerCases(),
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
  }, [clearCaseError, reportCaseError]);
  const runAction = useCallback(async (caseId: string, operation: string, name: string, action: () => Promise<unknown>) => {
    const errorKey = `${caseId}:${operation}`;
    const actionSequence = beginCaseAction(errorKey);
    try {
      const result = await action();
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      assertSuccessfulSalesResult(result as { success?: unknown });
      await load();
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      clearCaseError(errorKey);
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
    }
  }, [beginCaseAction, clearCaseError, isLatestCaseAction, load, reportCaseError]);
  const previewPdf = useCallback(async (caseId: string, snapshotId: string, mode: 'PREVIEW' | 'FINAL' = 'PREVIEW') => {
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
              onRequestCorrection={(scope) => void runAction(row.view.owner.caseId, `request-correction:${scope}`, 'ثبت درخواست اصلاح فروش همکار', () => requestPartnerCorrection(row.view, scope))}
              actions={{
                ...row.actions,
                onPreview: row.snapshotId ? () => void previewPdf(row.view.owner.caseId, row.snapshotId!) : undefined,
                onIssue: row.snapshotId ? () => void previewPdf(row.view.owner.caseId, row.snapshotId!, 'FINAL') : undefined,
                onSendConfirmation: () => void runAction(row.view.owner.caseId, 'send-confirmation', 'ارسال تأییدیه فروش همکار', () => sendPartnerConfirmation(row.view.owner.caseId)),
                onRequestCorrection: () => void runAction(row.view.owner.caseId, 'request-correction:retail', 'ثبت درخواست اصلاح فروش همکار', () => requestPartnerCorrection(row.view, 'RETAIL_ONLY')),
                onRequestVoid: () => void runAction(row.view.owner.caseId, 'request-void', 'ثبت درخواست ابطال فروش همکار', () => requestPartnerCorrection(row.view, 'VOID')),
              }}
            />
          </div>
        );
      })}
    </div>
  </ErpWorkspacePage>;
}
