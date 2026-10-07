'use client';
import { WHOLESALE_MANDATORY_DEFAULT_PERCENTAGE } from '@sabalanerp/partner-sales-contracts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ResponderInquiryViewV2Schema, ResponderWorkspaceViewV2Schema } from '@sabalanerp/partner-sales-contracts';
import type { PartnerCommand, PartnerCommandPort, PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpDisclosure, ErpEmptyState, ErpInlineState, ErpLoading, ErpPage, ErpSheet } from '@/components/erp';
import { useWorkspaceQuery } from '../management/useWorkspaceQuery';
import { actionPresentation } from '../management/availability';
import { PartnerCommandSession, type CommandFeedback } from '../management/commandSession';
import { CommandFeedbackView } from '../management/CommandFeedbackView';
import { getPartnerSalesErrorMessage } from '../partnerSalesErrorMessage';
import { responderContracts, responderProductGroups } from './responderContracts';
import { ResponseRow } from './ResponseRow';
import { responseDecisions, settleResponseDrafts, type ResponseDrafts } from './responseDraft';
import { formatPartnerMoney } from '../presentation';

type Job = { inquiryId: string; assignmentRevision: number; decisions: Extract<PartnerCommand, { type: 'INQUIRY_DECIDE' }>['decisions'] };
const states = { PENDING: 'نیازمند پاسخ', APPROVED: 'قیمت ارائه‌شده', REJECTED: 'رد جهت اصلاح', EXPIRED: 'قیمت منقضی‌شده', SUPERSEDED: 'جایگزین‌شده', CANCELLED: 'لغوشده' };
export function ResponderContractWorkspace({ contractId, inquiryId, queryPort, inquiryQueryPort, commandPort }: {
  contractId?: string; inquiryId?: string; queryPort: PartnerQueryV2Port; inquiryQueryPort: PartnerQueryV2Port; commandPort: PartnerCommandPort;
}) {
  const load = useCallback(async () => {
    let id = contractId;
    if (!id && inquiryId) {
      const target = await inquiryQueryPort.query({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId });
      if (!target.ok) return target;
      const parsed = ResponderInquiryViewV2Schema.parse(target.value);
      id = parsed.caseId ?? parsed.inquiryId;
    }
    const response = await queryPort.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', contractId: id, view: 'all' });
    return response.ok ? { ok: true as const, value: ResponderWorkspaceViewV2Schema.parse(response.value) } : response;
  }, [contractId, inquiryId, queryPort, inquiryQueryPort]);
  const resource = useWorkspaceQuery(load, contractId ?? inquiryId);
  const inquiries = resource.view?.inquiries ?? [];
  const contract = responderContracts(inquiries)[0];
  const groups = responderProductGroups(inquiries);
  const [drafts, setDrafts] = useState<ResponseDrafts>({});
  const [review, setReview] = useState<Job[] | null>(null);
  const [feedback, setFeedback] = useState<CommandFeedback | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const actor = useRef<string>();
  const retryIndex = useRef(0);
  const [sessions] = useState(() => new Map<string, PartnerCommandSession>());
  const locked = pending || feedback?.kind === 'uncertain';
  const now = Date.now();
  const editable = new Set(inquiries.flatMap(inquiry => actionPresentation(inquiry.actions, 'INQUIRY_RESPOND', now)?.enabled
    ? inquiry.rows.filter(row => row.state === 'PENDING' && actionPresentation(row.actions, 'INQUIRY_RESPOND', now)?.enabled).map(row => row.rowId) : []));
  const signature = JSON.stringify(inquiries.map(inquiry => [inquiry.inquiryId, inquiry.assignmentRevision, inquiry.rows.map(row => [row.rowId, row.revision])]));
  useEffect(() => {
    if (running.current || feedback?.kind === 'uncertain') return;
    const pendingIds = new Set(inquiries.flatMap(inquiry => inquiry.rows.filter(row => row.state === 'PENDING').map(row => row.rowId)));
    setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => pendingIds.has(id))));
    setReview(null);
  // Fresh evidence invalidates the review; unresolved commands retain their exact retry payload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useEffect(() => {
    if (!resource.view?.actorId || resource.view.actorId === actor.current) return;
    actor.current = resource.view.actorId;
    sessions.clear(); setDrafts({}); setReview(null); setFeedback(null); setErrors({});
  }, [resource.view?.actorId, sessions]);

  async function send(retry = false) {
    if (running.current || !review || (!resource.view && !retry) || !actor.current) return;
    const actorId = actor.current;
    running.current = true; setPending(true);
    try {
      for (let index = retry ? retryIndex.current : 0; index < review.length; index++) {
        if (actor.current !== actorId) return;
        const job = review[index]; retryIndex.current = index;
        let session = sessions.get(job.inquiryId);
        if (!session) { session = new PartnerCommandSession(commandPort, actorId); sessions.set(job.inquiryId, session); }
        const result = retry && index === retryIndex.current ? await session.retry() : await session.submit({ type: 'INQUIRY_DECIDE',
          inquiryId: job.inquiryId, expectedAssignmentRevision: job.assignmentRevision, decisions: job.decisions }, job.inquiryId);
        if (actor.current !== actorId) return;
        retry = false; setFeedback(result);
        if (result.kind === 'uncertain' || result.kind === 'blocked') return;
        if (result.kind !== 'success' || !result.batch) break;
        setDrafts(previous => settleResponseDrafts(previous, result.batch!));
        const failed = result.batch.outcomes.filter(outcome => !outcome.ok);
        if (failed.length) { setErrors(Object.fromEntries(failed.map(outcome => [outcome.rowId, !outcome.ok ? getPartnerSalesErrorMessage(outcome.error) : '']))); break; }
        // A denied refresh must not lose the exact unresolved retry, or authorize the next package.
        if (!resource.view) break;
      }
      setReview(null);
      await resource.refresh().catch(() => undefined);
    } finally { running.current = false; setPending(false); }
  }
  function prepare() {
    const jobs: Job[] = [], validation: Record<string, string> = {};
    for (const inquiry of inquiries) {
      const selected = inquiry.rows.filter(row => editable.has(row.rowId) && drafts[row.rowId]);
      if (!selected.length) continue;
      const result = responseDecisions(selected.map(row => ({ rowId: row.rowId, revision: row.revision, currency: row.identity.currency })), drafts);
      if (!result.ok) Object.assign(validation, result.errors);
      else jobs.push({ inquiryId: inquiry.inquiryId, assignmentRevision: inquiry.assignmentRevision, decisions: result.decisions });
    }
    if (Object.keys(validation).length || !jobs.length) { setErrors(Object.keys(validation).length ? validation : { selection: 'قیمت حداقل یک گروه را وارد کنید.' }); return; }
    setErrors({}); setFeedback(null); setReview(jobs);
  }
  return <div className="mx-auto w-full max-w-5xl"><ErpPage title={contract?.label ?? 'استعلام های همکار'} eyebrow={contract?.customer} description={inquiries[0]?.partnerDisplayName}
    backHref="/dashboard/sales/partner-inquiries" actions={[{ label: 'به‌روزرسانی', variant: 'outline', disabled: locked, onClick: () => void resource.refresh().catch(() => undefined) }]}>
    {resource.loading && !resource.view && <ErpLoading />}
    {resource.error && <ErpInlineState kind="error" title={resource.error} />}
    <CommandFeedbackView feedback={feedback} pending={pending} onRetry={() => void send(true)} onRefresh={() => void resource.refresh().catch(() => undefined)} />
    {errors.selection && <ErpInlineState kind="error" title={errors.selection} />}
    {!resource.loading && !resource.error && !contract && <ErpEmptyState title="قرارداد قابل مشاهده‌ای پیدا نشد." />}
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">{groups.map((group, index) => {
      const members = group.rows.filter(row => editable.has(row.rowId));
      const draft = members.map(row => drafts[row.rowId]).find(Boolean) ?? { outcome: 'APPROVED' as const, amount: '', note: '', mandatoryEnabled: false, mandatoryPercentage: WHOLESALE_MANDATORY_DEFAULT_PERCENTAGE };
      return <ResponseRow key={group.key} row={group.display} number={index + 1} draft={draft} pending={locked || resource.loading || Boolean(resource.error)}
        canRespond={members.length > 0} error={group.rows.map(row => errors[row.rowId]).find(Boolean)}
        onChange={next => setDrafts(previous => ({ ...previous, ...Object.fromEntries(members.map(row => [row.rowId, next])) }))}
        status={<ErpDisclosure hoverEffect="shadow" title={`جزئیات ${group.rows.length.toLocaleString('fa-IR')} ردیف اصلی`}>
          {group.rows.map((row, number) => <div key={row.rowId} className="space-y-2 border-b border-[var(--sds-border-subtle)] py-3">
            <p>ردیف {(number + 1).toLocaleString('fa-IR')} · {states[row.state]}</p>
            <p>{row.configuration.map(fact => `${fact.label}: ${fact.value}`).join(' · ')}</p>
            {row.approvedPrice && <p>قیمت سبلان: {formatPartnerMoney(row.approvedPrice.amount, row.approvedPrice.currency)}</p>}
            {row.wholesaleMandatory && <p>حکمی سبلان: {row.wholesaleMandatory.enabled ? `${row.wholesaleMandatory.percentage}٪` : 'غیرفعال'}</p>}
            {row.partnerRejectionReason && <p>دلیل رد قیمت توسط همکار: {row.partnerRejectionReason}</p>}
            {row.noteOrReason && <p>{row.noteOrReason}</p>}
            {row.negotiationHistory?.map((previous, historyIndex) => <p key={previous.rowId}>
              پیشنهاد قبلی {(historyIndex + 1).toLocaleString('fa-IR')}: {previous.price ? formatPartnerMoney(previous.price.amount, previous.price.currency) : 'بدون قیمت'}
              {previous.rejectionReason ? ` · دلیل رد: ${previous.rejectionReason}` : ''}
            </p>)}
          </div>)}
        </ErpDisclosure>} />;
    })}</div>
    {inquiries.some(inquiry => inquiry.rows.some(row => row.superseded || row.state === 'CANCELLED')) && <ErpDisclosure title="نوبت‌های قبلی و لغوشده">
      {inquiries.flatMap(inquiry => inquiry.rows).filter(row => row.superseded || row.state === 'CANCELLED').map((row, index) => <div key={row.rowId} className="space-y-2 py-3">
        <p>ردیف {(index + 1).toLocaleString('fa-IR')} · {row.description} · {row.superseded ? 'جایگزین‌شده' : 'لغوشده'}</p>
        <p>{row.configuration.map(fact => `${fact.label}: ${fact.value}`).join(' · ')}</p>
        {row.approvedPrice && <p>قیمت قبلی: {formatPartnerMoney(row.approvedPrice.amount, row.approvedPrice.currency)}</p>}
        {row.noteOrReason && <p>{row.noteOrReason}</p>}
      </div>)}
    </ErpDisclosure>}
    {editable.size > 0 && <ErpButton label="مرور و ثبت قیمت" disabled={locked || resource.loading || Boolean(resource.error)} onClick={prepare} />}
    <ErpSheet open={Boolean(review)} onClose={() => setReview(null)} title="مرور پاسخ قیمت" presentation="modal" pending={locked}
      footer={<ErpButton label="ثبت پاسخ‌ها" disabled={locked || resource.loading || Boolean(resource.error)} onClick={() => void send()} />}>
      {groups.filter(group => group.rows.some(row => review?.some(job => job.decisions.some(decision => decision.rowId === row.rowId)))).map(group => {
        const decision = review!.flatMap(job => job.decisions).find(item => group.rows.some(row => row.rowId === item.rowId))!;
        return <div key={group.key} className="space-y-2 py-3"><p className="font-semibold">{group.display.description}</p><p>{decision.outcome === 'APPROVED' ? formatPartnerMoney(decision.wholesaleUnitPrice.amount, decision.wholesaleUnitPrice.currency) : decision.reason}</p>
          {decision.outcome === 'APPROVED' && decision.wholesaleMandatory?.enabled && <p>حکمی سبلان: {decision.wholesaleMandatory.percentage}٪</p>}</div>;
      })}
      {feedback?.kind === 'uncertain' && <CommandFeedbackView feedback={feedback} pending={pending} onRetry={() => void send(true)} onRefresh={() => void resource.refresh().catch(() => undefined)} />}
    </ErpSheet>
  </ErpPage></div>;
}
