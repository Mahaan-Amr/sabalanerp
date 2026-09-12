'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ErpEmptyState, ErpInlineState, ErpLoading, ErpWorkspacePage } from '@/components/erp';
import { FaFileContract } from 'react-icons/fa';
import { PartnerCaseWorkspace } from './PartnerCaseWorkspace';
import { openPartnerPdf, readPartnerAccount, readPartnerCases, sendPartnerConfirmation,
  readPartnerCollections, readPartnerCorrection, requestPartnerCorrection,
  type PartnerCaseRuntimeRow } from './partnerCaseHttpPort';
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
  const [error, setError] = useState<{ message: string; kind: 'error' | 'permission' | 'stale'; caseId?: string }>();
  const loadSequenceRef = useRef(0);
  const actionSequenceRef = useRef(new Map<string, number>());
  const beginCaseAction = useCallback((caseId: string) => {
    const sequence = (actionSequenceRef.current.get(caseId) || 0) + 1;
    actionSequenceRef.current.set(caseId, sequence);
    return sequence;
  }, []);
  const isLatestCaseAction = useCallback((caseId: string, sequence: number) => actionSequenceRef.current.get(caseId) === sequence, []);
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
      setError((current) => current?.caseId ? current : undefined);
    } catch (reason) {
      if (requestSequence !== loadSequenceRef.current) return;
      const normalizedReason = normalizePartnerSalesOperationalError(reason);
      setError({ kind: getSalesOperationalErrorKind(normalizedReason), message: getSalesOperationalErrorMessage(normalizedReason, {
        failedAction: 'دریافت پرونده‌های فروش همکار',
        nextStep: 'اتصال را بررسی کنید و دوباره تلاش کنید.'
      }) });
    }
    finally { if (requestSequence === loadSequenceRef.current) setBusy(false); }
  }, []);
  const runAction = useCallback(async (caseId: string, name: string, action: () => Promise<unknown>) => {
    const actionSequence = beginCaseAction(caseId);
    try {
      await action();
      if (!isLatestCaseAction(caseId, actionSequence)) return;
      await load();
      if (!isLatestCaseAction(caseId, actionSequence)) return;
      setError((current) => current?.caseId === caseId ? undefined : current);
    }
    catch (reason) {
      if (!isLatestCaseAction(caseId, actionSequence)) return;
      const normalizedReason = normalizePartnerSalesOperationalError(await normalizeSalesBlobError(reason));
      setError({ caseId, kind: getSalesOperationalErrorKind(normalizedReason), message: getSalesOperationalErrorMessage(normalizedReason, {
        failedAction: name,
        nextStep: 'وضعیت پرونده را تازه‌سازی و سپس دوباره بررسی کنید.',
        uncertainMutation: true,
      }) });
    }
  }, [beginCaseAction, isLatestCaseAction, load]);
  const previewPdf = useCallback(async (caseId: string, snapshotId: string) => {
    const actionSequence = beginCaseAction(caseId);
    try {
      await openPartnerPdf(caseId, snapshotId, 'PREVIEW');
      if (!isLatestCaseAction(caseId, actionSequence)) return;
      setError((current) => current?.caseId === caseId ? undefined : current);
    } catch (reason) {
      if (!isLatestCaseAction(caseId, actionSequence)) return;
      const normalizedReason = normalizePartnerSalesOperationalError(await normalizeSalesBlobError(reason));
      setError({ caseId, kind: getSalesOperationalErrorKind(normalizedReason), message: getSalesOperationalErrorMessage(normalizedReason, {
        failedAction: 'پیش‌نمایش سند فروش همکار',
        nextStep: 'دوباره روی «پیش‌نمایش» بزنید.',
      }) });
    }
  }, [beginCaseAction, isLatestCaseAction]);
  useEffect(() => { void load(); }, [load]);
  if (busy) return <ErpLoading />;
  return <ErpWorkspacePage title="پرونده‌های فروش همکار" context="حقیقت جاری پرونده، وصول و حساب سبلان">
    {error && !error.caseId && <ErpInlineState kind={error.kind} title={error.message} action={{ label: 'تلاش دوباره', onClick: load }} />}
    {!error && !rows.length && <ErpEmptyState icon={FaFileContract} title="پرونده‌ای ثبت نشده است" />}
    <div className="space-y-8">{rows.map((row, index) => <div key={row.view.owner.caseId} className="space-y-2">
      {error?.caseId === row.view.owner.caseId && <ErpInlineState kind={error.kind} title={error.message} />}
      <PartnerCaseWorkspace
      view={row.view} account={index === 0 ? account : undefined}
      collections={collections[row.view.owner.caseId]} correction={corrections[row.view.owner.caseId]}
      onRequestCorrection={scope => void runAction(row.view.owner.caseId, 'ثبت درخواست اصلاح فروش همکار', () => requestPartnerCorrection(row.view, scope))}
      actions={{ ...row.actions,
        onPreview: row.snapshotId ? () => void previewPdf(row.view.owner.caseId, row.snapshotId!) : undefined,
        onIssue: row.snapshotId ? () => void runAction(row.view.owner.caseId, 'صدور سند فروش همکار', () => openPartnerPdf(row.view.owner.caseId, row.snapshotId!, 'FINAL')) : undefined,
        onSendConfirmation: () => void runAction(row.view.owner.caseId, 'ارسال تأییدیه فروش همکار', () => sendPartnerConfirmation(row.view.owner.caseId)),
        onRequestCorrection: () => void runAction(row.view.owner.caseId, 'ثبت درخواست اصلاح فروش همکار', () => requestPartnerCorrection(row.view, 'RETAIL_ONLY')),
        onRequestVoid: () => void runAction(row.view.owner.caseId, 'ثبت درخواست ابطال فروش همکار', () => requestPartnerCorrection(row.view, 'VOID')),
      }} /></div>)}</div>
  </ErpWorkspacePage>;
}
