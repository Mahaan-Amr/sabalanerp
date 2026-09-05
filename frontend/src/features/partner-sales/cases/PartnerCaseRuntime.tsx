'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErpEmptyState, ErpInlineState, ErpLoading, ErpWorkspacePage } from '@/components/erp';
import { FaFileContract } from 'react-icons/fa';
import { PartnerCaseWorkspace } from './PartnerCaseWorkspace';
import { openPartnerPdf, readPartnerAccount, readPartnerCases, sendPartnerConfirmation,
  readPartnerCollections, readPartnerCorrection, requestPartnerCorrection,
  type PartnerCaseRuntimeRow } from './partnerCaseHttpPort';
import type { PartnerAccountView } from '@sabalanerp/partner-sales-contracts';
import type { RetailCollectionHistory } from '../collections/RetailCollectionsPanel';
import type { PartnerCorrectionStatus } from './PartnerCorrectionPanel';

export function PartnerCaseRuntime() {
  const [rows, setRows] = useState<PartnerCaseRuntimeRow[]>([]);
  const [account, setAccount] = useState<PartnerAccountView>();
  const [collections, setCollections] = useState<Record<string, RetailCollectionHistory>>({});
  const [corrections, setCorrections] = useState<Record<string, PartnerCorrectionStatus | null>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setBusy(true); setError(undefined);
    try {
      const [cases, accountView] = await Promise.all([readPartnerCases(), readPartnerAccount().catch(() => undefined)]);
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
  }, []);
  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setError(undefined);
    try { await action(); await load(); }
    catch { setError('انجام عملیات پرونده ممکن نشد. لطفاً دوباره تلاش کنید.'); }
  }, [load]);
  useEffect(() => { void load(); }, [load]);
  if (busy) return <ErpLoading />;
  return <ErpWorkspacePage title="پرونده‌های فروش همکار" context="حقیقت جاری پرونده، وصول و حساب سبلان">
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: load }} />}
    {!error && !rows.length && <ErpEmptyState icon={FaFileContract} title="پرونده‌ای ثبت نشده است" />}
    <div className="space-y-8">{rows.map((row, index) => <PartnerCaseWorkspace key={row.view.owner.caseId}
      view={row.view} account={index === 0 ? account : undefined}
      collections={collections[row.view.owner.caseId]} correction={corrections[row.view.owner.caseId]}
      onRequestCorrection={scope => void runAction(() => requestPartnerCorrection(row.view, scope))}
      actions={{ ...row.actions,
        onPreview: row.snapshotId ? () => void openPartnerPdf(row.view.owner.caseId, row.snapshotId!, 'PREVIEW') : undefined,
        onIssue: row.snapshotId ? () => void runAction(() => openPartnerPdf(row.view.owner.caseId, row.snapshotId!, 'FINAL')) : undefined,
        onSendConfirmation: () => void runAction(() => sendPartnerConfirmation(row.view.owner.caseId)),
        onRequestCorrection: () => void runAction(() => requestPartnerCorrection(row.view, 'RETAIL_ONLY')),
        onRequestVoid: () => void runAction(() => requestPartnerCorrection(row.view, 'VOID')),
      }} />)}</div>
  </ErpWorkspacePage>;
}
