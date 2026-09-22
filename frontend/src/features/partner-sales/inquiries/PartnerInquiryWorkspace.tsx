'use client';

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PartnerCommandPort, PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInlineState, ErpLoading, ErpSheet, ErpTextarea } from '@/components/erp';
import { TechnicalProductConfiguration } from '../../contract-creation/partner/TechnicalProductConfiguration';
import { PartnerInquiryPanel } from './PartnerInquiryPanel';
import { createPartnerInquiryReader } from './partnerInquiryReader';
import { createPartnerInquirySubmission, type PartnerConfiguredInquiryRows, type PartnerInquiryRecovery } from './partnerInquirySubmission';
import type { PartnerInquiryRow } from './inquiryPresentation';
import { buildPartnerInquiryBulkRows, partnerInquiryBulkStatusLabel, resolveLatestPartnerInquiryRow } from './partnerInquiryBulk';

export interface PartnerInquiryWorkspaceProps {
  actorId: string;
  inquiryId: string;
  queries: PartnerQueryV2Port;
  commands: PartnerCommandPort;
  recovery: PartnerInquiryRecovery;
  writable: boolean;
  configuredRows: PartnerConfiguredInquiryRows;
  knownInquiryRows?: readonly PartnerInquiryRow[];
  configuredRowLabels?: Readonly<Record<string, string>>;
  configurationEditor: React.ReactNode;
  mismatchedRowIds?: readonly string[];
  onOpenInquiry: (inquiryId: string) => void;
  onCreateNewInquiry: () => void;
  /** Returns a newly saved technical recovery ref and a new inquiry row ID;
   * never guesses a product identity or mutates the predecessor. */
  prepareSuccessor: (row: PartnerInquiryRow, reason: string) => Promise<PartnerConfiguredInquiryRows[number]>;
}

export function PartnerInquiryWorkspace(props: PartnerInquiryWorkspaceProps) {
  const { actorId, inquiryId, queries, commands, recovery, writable, configuredRows, knownInquiryRows = [], configuredRowLabels = {}, configurationEditor, mismatchedRowIds, onOpenInquiry, onCreateNewInquiry, prepareSuccessor } = props;
  const reader = useMemo(() => createPartnerInquiryReader(queries, inquiryId), [queries, inquiryId]);
  const submission = useMemo(() => createPartnerInquirySubmission({ actorId, inquiryId, commands, recovery }), [actorId, inquiryId, commands, recovery]);
  const read = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
  const submit = useSyncExternalStore(submission.subscribe, submission.getSnapshot, submission.getSnapshot);
  const [now, setNow] = useState(Date.now);
  const [successor, setSuccessor] = useState<PartnerInquiryRow | null>(null);
  const [reason, setReason] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const actionFlight = useRef(false);
  const blocked = !writable || actionPending || submit.phase === 'submitting' || submit.phase === 'uncertain';
  const bulkInquiry = useMemo(() => read.inquiry ? { ...read.inquiry, rows: [...knownInquiryRows.filter(known =>
    !read.inquiry!.rows.some(current => current.configurationRef.productRowId === known.configurationRef.productRowId)),
    ...read.inquiry.rows] } : undefined, [knownInquiryRows, read.inquiry]);
  const bulkRows = useMemo(() => buildPartnerInquiryBulkRows({ configuredRows, inquiry: bulkInquiry, now,
    mismatchedRowIds }), [bulkInquiry, configuredRows, mismatchedRowIds, now]);

  useEffect(() => { void reader.refresh(); }, [reader]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = () => { setNow(Date.now()); void reader.refresh(); };
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    return () => { clearInterval(tick); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [reader]);
  const send = async (rows: PartnerConfiguredInquiryRows) => {
    await submission.submit(rows);
    const submitted = submission.getSnapshot().phase === 'submitted';
    if (submitted) { setSuccessor(null); setReason(''); await reader.refresh(); }
    return submitted;
  };
  const retry = async () => {
    await submission.retry();
    if (submission.getSnapshot().phase === 'submitted') { setSuccessor(null); setReason(''); await reader.refresh(); }
  };
  const submissionFeedback = (submit.message || submit.phase === 'uncertain') && <ErpInlineState kind={submit.phase === 'uncertain' ? 'stale' : 'error'} title={submit.message || 'نتیجه ارسال مشخص نیست؛ همان درخواست را دوباره بررسی کنید.'}
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm sds-text-secondary">این استعلام مستقل باقی می‌ماند؛ برای محصولات یا مشتری دیگر لازم نیست منتظر پاسخ آن بمانید.</p>
      <ErpButton label="استعلام جدید" variant="outline" disabled={blocked} onClick={() => {
        setBulkSelected(new Set(bulkRows.filter(row => row.selectable).map(row => row.key)));
        setReason(''); setBulkOpen(true);
      }} />
    </div>
    {!successor && submissionFeedback}
    {read.error && <ErpInlineState kind="error" title={read.error} action={{ label: 'تلاش مجدد', onClick: () => void reader.refresh() }} />}
    {!read.inquiry && read.pending && <ErpLoading />}
    {read.inquiry && <PartnerInquiryPanel inquiry={read.inquiry} now={now} pending={blocked || read.pending}
      onRefresh={() => void reader.refresh()} onOpenInquiry={onOpenInquiry} mismatchedRowIds={mismatchedRowIds}
      onReinquire={row => { setSuccessor(row); setReason(''); setError(null); }} />}
    <ErpSheet open={Boolean(successor)} onClose={() => setSuccessor(null)} title="استعلام مجدد" presentation="modal" pending={actionPending || submit.phase === 'submitting' || submit.phase === 'uncertain'}
      footer={<ErpButton label="ارسال استعلام مجدد" disabled={blocked} onClick={() => void act(async () => {
        if (!successor) return;
        const latest = await resolveLatestPartnerInquiryRow(queries, successor);
        const next = await prepareSuccessor(latest, reason.trim());
        await send([{ ...next, predecessor: { rowId: latest.rowId, revision: latest.revision,
          ...(reason.trim() ? { reason: reason.trim() } : {}) } }]);
      })} />}>
      <ErpField label="یادداشت"><ErpTextarea value={reason} maxLength={4000} onChange={event => setReason(event.target.value)} disabled={blocked} /></ErpField>
      {submissionFeedback}
      {error && <ErpInlineState kind="error" title={error} />}
    </ErpSheet>
    <ErpSheet open={bulkOpen} onClose={() => setBulkOpen(false)} title="استعلام جدید" presentation="modal"
      pending={actionPending || submit.phase === 'submitting' || submit.phase === 'uncertain'}
      footer={<div className="flex flex-wrap gap-2"><ErpButton label="ارسال ردیف‌های انتخاب‌شده"
        disabled={blocked || bulkSelected.size === 0} onClick={() => void act(async () => {
          const selected = bulkRows.filter(row => row.selectable && bulkSelected.has(row.key));
          const rows = await Promise.all(selected.map(async row => {
            if (!row.inquiryRow) return row.configured;
            const latest = await resolveLatestPartnerInquiryRow(queries, row.inquiryRow);
            const next = await prepareSuccessor(latest, reason.trim());
            return { ...next, predecessor: { rowId: latest.rowId, revision: latest.revision,
              ...(reason.trim() ? { reason: reason.trim() } : {}) } };
          }));
          if (await send(rows)) setBulkOpen(false);
        })} /><ErpButton label="استعلام مستقل جدید" variant="ghost" disabled={blocked}
          onClick={() => { setBulkOpen(false); onCreateNewInquiry(); }} /></div>}>
      <div className="space-y-3">
        {bulkRows.map(row => <ErpCard key={row.key} className="p-3"><div className="flex flex-wrap items-center justify-between gap-3">
          <ErpCheckbox label={configuredRowLabels[row.productRowId] ?? row.description}
            checked={bulkSelected.has(row.key)} disabled={!row.selectable || blocked}
            onChange={event => setBulkSelected(current => { const next = new Set(current);
              if (event.target.checked) next.add(row.key); else next.delete(row.key); return next; })} />
          <ErpBadge tone={row.status === 'USABLE' ? 'success' : row.status.includes('PENDING') ? 'info' : 'warning'}>
            {partnerInquiryBulkStatusLabel[row.status]}</ErpBadge>
          {row.detail && <p className="basis-full text-xs text-[var(--sds-text-secondary)]">{row.detail}</p>}
        </div></ErpCard>)}
        {!bulkRows.some(row => row.selectable) && <ErpInlineState kind="empty" title="همه ردیف‌ها استعلام معتبر یا در حال بررسی دارند." />}
        <ErpField label="یادداشت استعلام مجدد (اختیاری)"><ErpTextarea value={reason} maxLength={4000}
          onChange={event => setReason(event.target.value)} disabled={blocked} /></ErpField>
        {submissionFeedback}
      </div>
    </ErpSheet>
    {!successor && error && <ErpInlineState kind="error" title={error} />}
  </section>;
}
