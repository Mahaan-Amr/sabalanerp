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
import { getSalesOperationalErrorKind, getSalesOperationalErrorMessage, normalizeSalesBlobError } from '@/features/sales/salesOperationalError';
import { normalizePartnerSalesOperationalError } from '../partnerSalesErrorMessage';

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
  const actionSequenceRef = useRef(new Map<string, number>());
  const beginCaseAction = useCallback((key: string) => {
    const sequence = (actionSequenceRef.current.get(key) || 0) + 1;
    actionSequenceRef.current.set(key, sequence);
    return sequence;
  }, []);
  const isLatestCaseAction = useCallback((key: string, sequence: number) => actionSequenceRef.current.get(key) === sequence, []);
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
      const [cases, accountView] = await Promise.all([readPartnerCases(), readPartnerAccount().catch(() => undefined)]);
      if (requestSequence !== loadSequenceRef.current) return;
      setRows(cases); setAccount(accountView);
      const supplementary = await Promise.all(cases.map(async row => ({ caseId: row.view.owner.caseId,
        collections: ['COMMITTED', 'VOIDED'].includes(row.view.state)
          ? await readPartnerCollections(row.view.owner).catch(() => undefined) : undefined,
        correction: await readPartnerCorrection(row.view.owner.caseId).catch(() => undefined) })));
      if (requestSequence !== loadSequenceRef.current) return;
      setCollections(Object.fromEntries(supplementary.flatMap(item => item.collections ? [[item.caseId, item.collections]] : [])));
      setCorrections(Object.fromEntries(supplementary.flatMap(item => item.correction !== undefined
        ? [[item.caseId, item.correction]] : [])));
      setLoadError(undefined);
    } catch (reason) {
      if (requestSequence !== loadSequenceRef.current) return;
      const normalizedReason = normalizePartnerSalesOperationalError(reason);
      setLoadError({ kind: getSalesOperationalErrorKind(normalizedReason), message: getSalesOperationalErrorMessage(normalizedReason, {
        failedAction: 'دریافت پرونده‌های فروش همکار',
        nextStep: 'اتصال را بررسی کنید و دوباره تلاش کنید.'
      }) });
    }
    finally { if (requestSequence === loadSequenceRef.current) setBusy(false); }
  }, []);
  const runAction = useCallback(async (caseId: string, operation: string, name: string, action: () => Promise<unknown>) => {
    const errorKey = `${caseId}:${operation}`;
    const actionSequence = beginCaseAction(errorKey);
    try {
      await action();
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
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
  const previewPdf = useCallback(async (caseId: string, snapshotId: string) => {
    const errorKey = `${caseId}:preview`;
    const actionSequence = beginCaseAction(errorKey);
    try {
      await openPartnerPdf(caseId, snapshotId, 'PREVIEW');
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      clearCaseError(errorKey);
    } catch (reason) {
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      const normalizedReason = normalizePartnerSalesOperationalError(await normalizeSalesBlobError(reason));
      if (!isLatestCaseAction(errorKey, actionSequence)) return;
      reportCaseError(errorKey, { caseId, kind: getSalesOperationalErrorKind(normalizedReason), message: getSalesOperationalErrorMessage(normalizedReason, {
        failedAction: 'پیش‌نمایش سند فروش همکار',
        nextStep: 'دوباره روی «پیش‌نمایش» بزنید.',
      }) });
    }
  }, [beginCaseAction, clearCaseError, isLatestCaseAction, reportCaseError]);
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
                onIssue: row.snapshotId ? () => void runAction(row.view.owner.caseId, 'issue', 'صدور سند فروش همکار', () => openPartnerPdf(row.view.owner.caseId, row.snapshotId!, 'FINAL')) : undefined,
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
