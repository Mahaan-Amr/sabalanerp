'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { PartnerCommand, PartnerQueryResults } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpInlineState, ErpSheet } from '@/components/erp';
import { PartnerCommandSession, type CommandFeedback } from '../management/commandSession';
import { CommandFeedbackView } from '../management/CommandFeedbackView';
import { ResponseRow } from './ResponseRow';
import { ResponseReview } from './ResponseReview';
import { responseDecisions, settleResponseDrafts, type ResponseDrafts } from './responseDraft';

type InquiryDisplay = Pick<PartnerQueryResults['RESPONDER_INQUIRY'], 'inquiryId' | 'assignmentRevision' | 'partnerDisplayName' | 'rows'>;
type Decisions = Extract<PartnerCommand, { type: 'INQUIRY_DECIDE' }>['decisions'];

/** UI props are derived from the server projection by the workspace, never from a role title. */
export function ResponderEditor({ inquiry, editableRowIds, rowStatus, session, refresh, onLockChange, drafts, onDraftsChange: setDrafts }: {
  inquiry: InquiryDisplay; editableRowIds: readonly string[]; rowStatus: Record<string, React.ReactNode>;
  session: PartnerCommandSession; refresh: () => Promise<void>; onLockChange: (locked: boolean) => void;
  drafts: ResponseDrafts; onDraftsChange: React.Dispatch<React.SetStateAction<ResponseDrafts>>;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Decisions | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<CommandFeedback | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const running = useRef(false);
  const locked = pending || feedback?.kind === 'uncertain';
  useEffect(() => {
    onLockChange(locked);
    return () => onLockChange(false);
  }, [locked, onLockChange]);
  const signature = JSON.stringify([inquiry.assignmentRevision, inquiry.rows.map(row => [row.rowId, row.revision]), editableRowIds]);
  useEffect(() => {
    // Reauthorization/reassignment invalidates selection, never silently resends old edits.
    setDrafts(previous => Object.fromEntries(Object.entries(previous).map(([id, draft]) => [id, { ...draft, selected: false }])));
    if (!running.current) setReview(null);
  }, [signature, setDrafts]);

  async function reload() {
    if (running.current) return;
    setPending(true);
    try { await refresh(); setNeedsRefresh(false); }
    catch { setNeedsRefresh(true); }
    finally { setPending(false); }
  }
  async function send(retry = false) {
    if (running.current || (!review && !retry)) return;
    running.current = true; setPending(true);
    try {
      const outcome = retry ? await session.retry() : await session.submit({ type: 'INQUIRY_DECIDE', inquiryId: inquiry.inquiryId,
        expectedAssignmentRevision: inquiry.assignmentRevision, decisions: review! }, inquiry.inquiryId);
      setFeedback(outcome);
      if (outcome.kind === 'uncertain' || outcome.kind === 'blocked') return;
      setReview(null);
      if (outcome.kind === 'success' && outcome.batch) {
        setDrafts(previous => settleResponseDrafts(previous, outcome.batch!));
        setErrors(Object.fromEntries(outcome.batch.outcomes.filter(row => !row.ok).map(row => [row.rowId, !row.ok ? row.error.message : ''])));
      }
      try { await refresh(); setNeedsRefresh(false); }
      catch { setNeedsRefresh(true); }
    } finally { running.current = false; setPending(false); }
  }
  const rowNumbers = Object.fromEntries(inquiry.rows.map((row, index) => [row.rowId, index + 1]));
  return <section className="min-w-0 space-y-4" aria-label={`استعلام ${inquiry.partnerDisplayName}`} aria-busy={pending}>
    <h2 className="text-xl font-bold">{inquiry.partnerDisplayName}</h2>
    <CommandFeedbackView feedback={feedback} pending={pending} onRetry={() => void send(true)} onRefresh={() => void reload()} />
    {needsRefresh && <ErpInlineState kind="stale" className="flex-col items-start" title="وضعیت تازه دریافت نشد؛ پیش از اقدام بعدی دوباره دریافت کنید."
      action={{ label: 'دریافت وضعیت تازه', onClick: () => void reload(), disabled: pending }} />}
    {errors.selection && <ErpInlineState kind="error" title={errors.selection} />}
    <div className="grid gap-4 lg:grid-cols-2">
      {inquiry.rows.map((row, index) => <ResponseRow key={row.rowId} row={row} number={index + 1}
        canRespond={editableRowIds.includes(row.rowId)} status={rowStatus[row.rowId]} error={errors[row.rowId]}
        draft={drafts[row.rowId] || { selected: false, outcome: 'APPROVED', amount: '', note: '' }} pending={locked || needsRefresh}
        onChange={draft => setDrafts(previous => ({ ...previous, [row.rowId]: draft }))} />)}
    </div>
    {editableRowIds.length > 0 && <ErpButton label="بررسی پاسخ ردیف‌های انتخاب‌شده" disabled={locked || needsRefresh} onClick={() => {
      const result = responseDecisions(inquiry.rows.filter(row => editableRowIds.includes(row.rowId))
        .map(row => ({ rowId: row.rowId, revision: row.revision, currency: row.identity.currency })), drafts);
      if (!result.ok) { setErrors(result.errors); return; }
      setErrors({}); setFeedback(null); setReview(result.decisions);
    }} />}
    <ErpSheet open={Boolean(review)} onClose={() => setReview(null)} title="بررسی پاسخ قیمت" presentation="modal" pending={locked}
      footer={<div className="flex flex-wrap gap-2">
        <ErpButton label={pending ? 'در حال ثبت…' : 'ثبت پاسخ‌ها'} disabled={locked || needsRefresh} onClick={() => void send()} />
        <ErpButton label="بازگشت به ردیف‌ها" variant="outline" disabled={locked} onClick={() => setReview(null)} />
      </div>}>
      {review && <ResponseReview decisions={review} rowNumbers={rowNumbers} />}
      {feedback?.kind === 'uncertain' && <CommandFeedbackView feedback={feedback} pending={pending} onRetry={() => void send(true)} onRefresh={() => undefined} />}
    </ErpSheet>
  </section>;
}
