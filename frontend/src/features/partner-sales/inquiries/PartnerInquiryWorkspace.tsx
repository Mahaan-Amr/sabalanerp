'use client';

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PartnerCommandPort, PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpField, ErpInlineState, ErpLoading, ErpSheet, ErpTextarea } from '@/components/erp';
import { TechnicalProductConfiguration } from '../../contract-creation/partner/TechnicalProductConfiguration';
import { PartnerInquiryPanel } from './PartnerInquiryPanel';
import { createPartnerInquiryReader } from './partnerInquiryReader';
import { createPartnerInquirySubmission, type PartnerConfiguredInquiryRows, type PartnerInquiryRecovery } from './partnerInquirySubmission';
import type { PartnerInquiryRow, PartnerInquiryView } from './inquiryPresentation';

export interface PartnerInquiryWorkspaceProps {
  actorId: string;
  inquiryId: string;
  queries: PartnerQueryV2Port;
  commands: PartnerCommandPort;
  recovery: PartnerInquiryRecovery;
  writable: boolean;
  configuredRows: PartnerConfiguredInquiryRows;
  configurationEditor: React.ReactNode;
  mismatchedRowIds?: readonly string[];
  onEnterWizard: (inquiry: PartnerInquiryView) => Promise<void>;
  onOpenInquiry: (inquiryId: string) => void;
  /** Returns a newly saved technical recovery ref and a new inquiry row ID;
   * never guesses a product identity or mutates the predecessor. */
  prepareSuccessor: (row: PartnerInquiryRow, reason: string) => Promise<PartnerConfiguredInquiryRows[number]>;
}

export function PartnerInquiryWorkspace(props: PartnerInquiryWorkspaceProps) {
  const { actorId, inquiryId, queries, commands, recovery, writable, configuredRows, configurationEditor, mismatchedRowIds, onEnterWizard, onOpenInquiry, prepareSuccessor } = props;
  const reader = useMemo(() => createPartnerInquiryReader(queries, inquiryId), [queries, inquiryId]);
  const submission = useMemo(() => createPartnerInquirySubmission({ actorId, inquiryId, commands, recovery }), [actorId, inquiryId, commands, recovery]);
  const read = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
  const submit = useSyncExternalStore(submission.subscribe, submission.getSnapshot, submission.getSnapshot);
  const [now, setNow] = useState(Date.now);
  const [successor, setSuccessor] = useState<PartnerInquiryRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const actionFlight = useRef(false);
  const blocked = !writable || actionPending || submit.phase === 'submitting' || submit.phase === 'uncertain';

  useEffect(() => { void reader.refresh(); }, [reader]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = () => { setNow(Date.now()); void reader.refresh(); };
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    return () => { clearInterval(tick); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [reader]);
  const send = async (rows: PartnerConfiguredInquiryRows) => {
    await submission.submit(rows);
    if (submission.getSnapshot().phase === 'submitted') { setSuccessor(null); setReason(''); await reader.refresh(); }
  };
  const retry = async () => {
    await submission.retry();
    if (submission.getSnapshot().phase === 'submitted') { setSuccessor(null); setReason(''); await reader.refresh(); }
  };
  const submissionFeedback = submit.message && <ErpInlineState kind={submit.phase === 'uncertain' ? 'stale' : 'error'} title={submit.message}
    action={submit.phase === 'uncertain' ? { label: 'بررسی نتیجه ارسال', onClick: () => void retry() } : undefined} />;
  const act = async (operation: () => Promise<void>) => {
    if (actionFlight.current || !writable) return;
    actionFlight.current = true; setActionPending(true); setError(null);
    try { await operation(); }
    catch { setError('ادامه انجام نشد؛ ذخیره مشخصات و اعتبار قیمت را بررسی کنید. ورودی‌های شما حفظ شده‌اند.'); }
    finally { actionFlight.current = false; setActionPending(false); }
  };
  return <section dir="rtl" className="min-w-0 space-y-5">
    <fieldset disabled={blocked} className="min-w-0"><TechnicalProductConfiguration>{configurationEditor}</TechnicalProductConfiguration></fieldset>
    <ErpButton label="ارسال استعلام محصولات" variant="outline" disabled={blocked || !configuredRows.length} onClick={() => void send(configuredRows)} />
    {!successor && submissionFeedback}
    {read.error && <ErpInlineState kind="error" title={read.error} action={{ label: 'تلاش مجدد', onClick: () => void reader.refresh() }} />}
    {!read.inquiry && read.pending && <ErpLoading />}
    {read.inquiry && <PartnerInquiryPanel inquiry={read.inquiry} now={now} pending={blocked || read.pending}
      onRefresh={() => void reader.refresh()} onOpenInquiry={onOpenInquiry} mismatchedRowIds={mismatchedRowIds}
      onReinquire={row => { setSuccessor(row); setReason(''); setError(null); }}
      onEnterWizard={() => void act(async () => {
        await reader.refresh();
        const latest = reader.getSnapshot().inquiry;
        if (!latest) throw new Error('Inquiry unavailable');
        await onEnterWizard(latest);
      })} />}
    <ErpSheet open={Boolean(successor)} onClose={() => setSuccessor(null)} title="استعلام مجدد" presentation="modal" pending={actionPending || submit.phase === 'submitting' || submit.phase === 'uncertain'}
      footer={<ErpButton label="ارسال استعلام مجدد" disabled={blocked || !/[\u0600-\u06ff]/.test(reason) || !reason.trim()} onClick={() => void act(async () => {
        if (!successor) return;
        const next = await prepareSuccessor(successor, reason.trim());
        await send([{ ...next, predecessor: { rowId: successor.rowId, revision: successor.revision, reason: reason.trim() } }]);
      })} />}>
      <ErpField label="دلیل استعلام مجدد" required><ErpTextarea value={reason} maxLength={4000} onChange={event => setReason(event.target.value)} disabled={blocked} /></ErpField>
      {submissionFeedback}
      {error && <ErpInlineState kind="error" title={error} />}
    </ErpSheet>
    {!successor && error && <ErpInlineState kind="error" title={error} />}
  </section>;
}
