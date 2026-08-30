'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PartnerManagementWorkspaceViewV2Schema, partnerError } from '@sabalanerp/partner-sales-contracts';
import type { PartnerCommandPort, PartnerManagementCommandV2Port, PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpField, ErpInlineState, ErpLoading, ErpSelect, ErpWorkspacePage } from '@/components/erp';
import { actionPresentation } from './availability';
import { PartnerCommandSession, type CommandFeedback } from './commandSession';
import { CommandFeedbackView } from './CommandFeedbackView';
import { ManagementView, actionLabels, type ManagementChoice } from './ManagementView';
import { PartnerDecision } from './PartnerDecision';
import { useWorkspaceQuery } from './useWorkspaceQuery';

export function ManagementWorkspace({ queryPort, commandPort, managementPort }: {
  queryPort: PartnerQueryV2Port; commandPort: PartnerCommandPort; managementPort: PartnerManagementCommandV2Port;
}) {
  const load = useCallback(async (cursor?: string) => {
    const response = await queryPort.query({ schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', limit: 20, ...(cursor ? { cursor } : {}) });
    return response.ok ? { ok: true as const, value: PartnerManagementWorkspaceViewV2Schema.parse(response.value) } : response;
  }, [queryPort]);
  const resource = useWorkspaceQuery(load);
  const session = useMemo(() => new PartnerCommandSession(commandPort, resource.view?.actorId || 'unloaded', managementPort), [commandPort, managementPort, resource.view?.actorId]);
  const [choice, setChoice] = useState<ManagementChoice | null>(null);
  const [option, setOption] = useState('');
  const [inquiryId, setInquiryId] = useState('');
  const [conversion, setConversion] = useState<'START' | 'ABANDON' | 'RESOLVE'>('START');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<CommandFeedback | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [mustReview, setMustReview] = useState(false);
  const [now, setNow] = useState(Date.now());
  const running = useRef(false);
  const locked = pending || feedback?.kind === 'uncertain';
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const availability = choice && actionPresentation(choice.profile?.actions || choice.transfer?.actions || resource.view?.actions || [], choice.action, now);
  const options = choice?.action === 'PROFILE_CREATE' ? resource.view?.identityCandidates?.map(item => ({ id: item.identityEvidenceId, label: item.displayName })) || []
    : choice?.action === 'COMMERCIAL_TERMS_MANAGE' ? choice.profile?.commercialTerms?.options || []
      : choice?.action === 'CREDIT_TERMS_MANAGE' ? choice.profile?.creditTerms?.options || []
        : choice?.action === 'RESPONDER_ASSIGN' || choice?.action === 'RESPONDER_REASSIGN' ? choice.profile?.responder?.eligibleOptions || [] : null;
  const inquiryOptions = choice?.profile?.responder?.pendingInquiries || [];

  function choose(next: ManagementChoice) {
    setChoice(next); setOption(''); setInquiryId(''); setFieldError(undefined); setFeedback(null); setMustReview(false);
    setConversion(next.profile?.conversion?.started ? 'RESOLVE' : 'START');
  }
  async function refreshDecision() {
    if (running.current || feedback?.kind === 'uncertain') return;
    try { await resource.refresh(); setChoice(null); setMustReview(false); } catch { /* Resource renders a safe retry. */ }
  }
  async function submit(reason: string, retry = false) {
    if (running.current || (!retry && (!choice || !availability?.enabled || mustReview))) return;
    if (!retry && options && !options.some(item => item.id === option)) { setFieldError('یک گزینه را انتخاب کنید.'); return; }
    const assignedInquiry = inquiryOptions.find(item => item.inquiryId === inquiryId);
    if (!retry && choice?.action === 'RESPONDER_REASSIGN' && (!assignedInquiry || !actionPresentation(assignedInquiry.actions, 'RESPONDER_REASSIGN', now)?.enabled)) {
      setFieldError('یک استعلام قابل واگذاری را انتخاب کنید.'); return;
    }
    running.current = true; setPending(true); setFieldError(undefined);
    try {
      let outcome: CommandFeedback;
      const profile = choice?.profile?.profile;
      const target = profile && { profileId: profile.profileId, expectedRevision: profile.revision, reason };
      if (retry) outcome = await session.retry();
      else if (choice!.action === 'PROFILE_CREATE') outcome = await session.submitManagement({ type: 'PROFILE_CREATE', identityEvidenceId: option, reason }, option);
      else if (choice!.action === 'CUSTOMER_TRANSFER_DECIDE' && choice!.transfer && choice!.outcome) outcome = await session.submit({ type: 'CUSTOMER_TRANSFER_DECIDE',
        transferId: choice!.transfer.transferId, expectedRevision: choice!.transfer.revision, outcome: choice!.outcome, reason }, choice!.transfer.transferId);
      else if (target && choice!.action === 'IDENTITY_VERIFY' && choice!.profile!.identity) outcome = await session.submitManagement({ type: 'IDENTITY_VERIFY', ...target,
        evidenceId: choice!.profile!.identity.evidenceId }, target.profileId);
      else if (target && (choice!.action === 'COMMERCIAL_TERMS_MANAGE' || choice!.action === 'CREDIT_TERMS_MANAGE')) outcome = await session.submitManagement({
        type: choice!.action === 'COMMERCIAL_TERMS_MANAGE' ? 'COMMERCIAL_TERMS_SET' : 'CREDIT_TERMS_SET', ...target, termsVersionId: option }, target.profileId);
      else if (target && choice!.action === 'RESPONDER_ASSIGN') outcome = await session.submitManagement({ type: 'RESPONDER_ASSIGN', ...target, responderId: option }, target.profileId);
      else if (target && choice!.action === 'RESPONDER_REASSIGN' && assignedInquiry) outcome = await session.submit({ type: 'INQUIRY_REASSIGN', inquiryId,
        expectedAssignmentRevision: assignedInquiry.assignmentRevision, responderId: option, reason }, inquiryId);
      else if (target && choice!.action === 'PROFILE_CONVERSION_MANAGE' && choice!.profile!.conversion) outcome = await session.submitManagement({ type: 'PROFILE_CONVERSION', ...target,
        transition: conversion, dispositionEvidenceIds: conversion === 'RESOLVE' ? choice!.profile!.conversion.dispositionEvidenceIds : [] }, target.profileId);
      else if (target && ['PROFILE_ACTIVATE', 'PROFILE_SUSPEND', 'PROFILE_TERMINATE'].includes(choice!.action)) outcome = await session.submit({ type: 'PROFILE_TRANSITION', ...target,
        to: choice!.action === 'PROFILE_ACTIVATE' ? 'ACTIVE' : choice!.action === 'PROFILE_SUSPEND' ? 'SUSPENDED' : 'TERMINATED',
        // Activation remains unavailable in the production projection until a
        // versioned evidence transport is composed; other transitions need none.
        gateEvidenceIds: [] }, target.profileId);
      else outcome = { kind: 'error', error: partnerError('FORBIDDEN') };
      setFeedback(outcome);
      if (outcome.kind === 'error') setMustReview(true);
      if (outcome.kind === 'success') {
        setChoice(null);
        try { await resource.refresh(); } catch { /* Preserve committed success; never resend because a read failed. */ }
      }
    } finally { running.current = false; setPending(false); }
  }
  const consequence = choice?.action === 'PROFILE_TERMINATE' ? 'ورود و کار تازه متوقف می‌شود؛ سوابق و کارهای قطعی حسابداری و تحویل حفظ می‌شوند.'
    : choice?.action === 'PROFILE_SUSPEND' ? 'کار تازه و پاسخ قیمت متوقف می‌شود. مهلت اعتبار قیمت‌ها ادامه دارد.'
      : choice?.action === 'CUSTOMER_TRANSFER_DECIDE' ? 'فقط مالکیت جاری مشتری تعیین می‌شود؛ تاریخچه، مسئولیت پروژه و اعتبار فروش تغییر نمی‌کند.'
        : choice?.action === 'RESPONDER_REASSIGN' ? 'فقط ردیف‌های منتظر پاسخ واگذار می‌شوند؛ سابقه تصمیم‌های قبلی تغییر نمی‌کند.'
          : 'این تصمیم با هویت شما و دلیل ثبت می‌شود. سامانه پیش از ثبت، مجوز و شرایط جاری را دوباره بررسی می‌کند.';
  return <ErpWorkspacePage title="مدیریت فروشندگان همکار">
    {resource.loading && !resource.view && <ErpLoading />}
    {resource.error && <ErpInlineState kind="error" className="flex-col items-start" title={resource.error}
      action={{ label: 'دریافت وضعیت تازه', disabled: locked || resource.loading, onClick: () => void refreshDecision() }} />}
    {!choice && <CommandFeedbackView feedback={feedback} pending={pending} onRetry={() => void submit('', true)} onRefresh={() => void refreshDecision()} />}
    {resource.view && <>
      <div className="flex flex-wrap justify-end gap-2"><ErpButton label="تازه‌سازی" variant="outline" disabled={locked || resource.loading} onClick={() => void refreshDecision()} />
        {resource.canGoBack && <ErpButton label="صفحه قبل" disabled={locked || resource.loading || Boolean(choice)} onClick={resource.back} />}
        {resource.view.nextCursor && <ErpButton label="صفحه بعد" disabled={locked || resource.loading || Boolean(choice)} onClick={() => resource.next(resource.view!.nextCursor!)} />}
      </div>
      <ManagementView view={resource.view} now={now} disabled={locked || resource.loading || Boolean(resource.error)} onChoose={choose} />
    </>}
    {choice && <PartnerDecision key={`${choice.action}:${choice.profile?.profile.profileId || choice.transfer?.transferId || 'create'}:${choice.outcome || ''}`}
      title={actionLabels[choice.action] || 'ثبت تصمیم'} consequence={consequence} open pending={locked} danger={choice.action === 'PROFILE_TERMINATE'}
      disabled={!availability?.enabled || mustReview || resource.loading || Boolean(resource.error)} onClose={() => setChoice(null)} onConfirm={reason => void submit(reason)}
      feedback={<CommandFeedbackView feedback={feedback} pending={pending} onRetry={() => void submit('', true)} onRefresh={() => void refreshDecision()} />}>
      {availability?.reason && <ErpInlineState kind="permission" title={availability.reason} />}
      {options && <ErpField label={choice.action === 'PROFILE_CREATE' ? 'هویت تأییدشده' : 'گزینه جدید'} required error={fieldError}>
        <ErpSelect value={option} disabled={locked || mustReview} onChange={event => setOption(event.target.value)}>
          <option value="">انتخاب کنید</option>{options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </ErpSelect>
      </ErpField>}
      {choice.action === 'RESPONDER_REASSIGN' && <ErpField label="استعلام منتظر پاسخ" required error={fieldError}>
        <ErpSelect value={inquiryId} disabled={locked || mustReview} onChange={event => setInquiryId(event.target.value)}><option value="">انتخاب کنید</option>
          {inquiryOptions.map(item => <option key={item.inquiryId} value={item.inquiryId} disabled={!actionPresentation(item.actions, 'RESPONDER_REASSIGN', now)?.enabled}>{item.label}</option>)}
        </ErpSelect>
      </ErpField>}
      {choice.action === 'PROFILE_CONVERSION_MANAGE' && choice.profile?.conversion && <ErpField label="تصمیم تبدیل" required>
        <ErpSelect value={conversion} disabled={locked || mustReview} onChange={event => setConversion(event.target.value as typeof conversion)}>
          {!choice.profile.conversion.started && <option value="START">آغاز بررسی تبدیل</option>}
          {choice.profile.conversion.started && <option value="RESOLVE" disabled={!choice.profile.conversion.dispositionEvidenceIds.length}>ثبت تعیین تکلیف کارهای داخلی</option>}
          {choice.profile.conversion.started && !choice.profile.conversion.irreversible && <option value="ABANDON">انصراف از تبدیل</option>}
        </ErpSelect>
      </ErpField>}
    </PartnerDecision>}
  </ErpWorkspacePage>;
}
