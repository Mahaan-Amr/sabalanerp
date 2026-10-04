'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ResponderWorkspaceViewV2Schema, ResponderInquiryViewV2Schema, partnerError } from '@sabalanerp/partner-sales-contracts';
import type { PartnerCommandPort, PartnerQueryV2Port, ResponderInquiryViewV2 } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpCard, ErpDisclosure, ErpField, ErpInput, ErpEmptyState, ErpInlineState, ErpLoading, ErpSection, ErpSegmentedControl, ErpWorkspacePage } from '@/components/erp';
import { actionPresentation } from '../management/availability';
import { PartnerCommandSession } from '../management/commandSession';
import { useWorkspaceQuery } from '../management/useWorkspaceQuery';
import { ResponderEditor } from './ResponderEditor';
import type { ResponseDrafts } from './responseDraft';
import { responderInquiriesForView, responderRowView, type ResponderQueueView } from './responderQueueView';
import { formatPartnerMoney } from '../presentation';

const states = { PENDING: 'در انتظار پاسخ', APPROVED: 'تأییدشده', REJECTED: 'ردشده', EXPIRED: 'منقضی‌شده', SUPERSEDED: 'جایگزین‌شده', CANCELLED: 'لغوشده' };
const tehranTime = (instant: string) => new Date(instant).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' });
const inquiryLabel = (inquiry: { partnerDisplayName: string; submittedAt: string; rows: readonly unknown[] }) =>
  `${inquiry.partnerDisplayName} · ${tehranTime(inquiry.submittedAt)} · ${inquiry.rows.length.toLocaleString('fa-IR')} ردیف`;

export function ResponderWorkspace({ queryPort, inquiryQueryPort = queryPort, commandPort }: { queryPort: PartnerQueryV2Port; inquiryQueryPort?: PartnerQueryV2Port; commandPort: PartnerCommandPort }) {
  const searchParams = useSearchParams();
  const requestedInquiryId = searchParams.get('inquiryId');
  const [dutyTarget, setDutyTarget] = useState<ResponderInquiryViewV2>();
  const [queueView, setQueueView] = useState<ResponderQueueView>('pending');
  const [search, setSearch] = useState('');
  const load = useCallback(async (cursor?: string) => {
    const response = await queryPort.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', limit: 5, view: queueView, search, ...(cursor ? { cursor } : {}) });
    if (!response.ok) return response;
    const view = ResponderWorkspaceViewV2Schema.parse(response.value);
    // A duty's target can be outside this queue page. Resolve its exact identity,
    // never substitute the first inquiry from the paginated workspace.
    if (requestedInquiryId && !view.inquiries.some(item => item.inquiryId === requestedInquiryId)) {
      const target = await inquiryQueryPort.query({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId: requestedInquiryId });
      if (!target.ok) return target;
      const parsed = ResponderInquiryViewV2Schema.safeParse(target.value);
      if (!parsed.success || parsed.data.inquiryId !== requestedInquiryId) return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
      setDutyTarget(parsed.data);
      return { ok: true as const, value: view };
    }
    return { ok: true as const, value: view };
  }, [queryPort, inquiryQueryPort, requestedInquiryId, queueView, search]);
  const resource = useWorkspaceQuery(load, `${requestedInquiryId ?? 'queue'}:${queueView}:${search}`);
  const [selection, setSelection] = useState({ routeId: requestedInquiryId, inquiryId: requestedInquiryId });
  const selected = selection.routeId === requestedInquiryId ? selection.inquiryId : requestedInquiryId;
  const setSelected = (inquiryId: string | null) => setSelection({ routeId: requestedInquiryId, inquiryId });
  const focusedRoute = useRef<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [draftsByInquiry, setDraftsByInquiry] = useState<Record<string, ResponseDrafts>>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const visibleInquiries = responderInquiriesForView(resource.view?.inquiries ?? [], queueView, now);
  const groups = new Map<string, typeof visibleInquiries>();
  for (const item of visibleInquiries) {
    const key = item.caseId ?? item.inquiryId;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const inquiry = selected
    ? visibleInquiries.find(item => item.inquiryId === selected) || resource.view?.inquiries.find(item => item.inquiryId === selected)
      || (selected === requestedInquiryId && dutyTarget?.inquiryId === selected ? dutyTarget : undefined)
    : visibleInquiries[0];
  const activeInquiryId = inquiry?.inquiryId;
  useEffect(() => {
    if (!requestedInquiryId) { focusedRoute.current = null; return; }
    const target = resource.view?.inquiries.find(item => item.inquiryId === requestedInquiryId) || (dutyTarget?.inquiryId === requestedInquiryId ? dutyTarget : undefined);
    if (!target || focusedRoute.current === requestedInquiryId) return;
    focusedRoute.current = requestedInquiryId;
    setQueueView(target.rows.some(row => responderRowView(row, now) === 'pending') ? 'pending'
      : target.rows.some(row => responderRowView(row, now) === 'answered') ? 'answered' : 'history');
  }, [requestedInquiryId, resource.view, dutyTarget, now]);
  const setDrafts = useCallback<React.Dispatch<React.SetStateAction<ResponseDrafts>>>((update) => {
    if (!activeInquiryId) return;
    setDraftsByInquiry(previous => ({ ...previous, [activeInquiryId]: typeof update === 'function' ? update(previous[activeInquiryId] || {}) : update }));
  }, [activeInquiryId]);
  useEffect(() => setDraftsByInquiry({}), [resource.view?.actorId]);

  const session = useMemo(() => new PartnerCommandSession(commandPort, resource.view?.actorId || 'unloaded'), [commandPort, resource.view?.actorId]);
  const inquiryAvailability = inquiry && actionPresentation(inquiry.actions, 'INQUIRY_RESPOND', now);
  const editableRowIds = inquiry?.rows.filter(row => row.state === 'PENDING' && inquiryAvailability?.enabled && actionPresentation(row.actions, 'INQUIRY_RESPOND', now)?.enabled).map(row => row.rowId) || [];
  const rowStatus = Object.fromEntries(inquiry?.rows.map(row => {
    const availability = actionPresentation(row.actions, 'INQUIRY_RESPOND', now);
    return [row.rowId, <div key={row.rowId} className="space-y-2">
      <p>{row.state === 'APPROVED' && row.expiresAt && Date.parse(row.expiresAt) <= now ? states.EXPIRED : states[row.state]}</p>
      {row.expiresAt && <p>پایان اعتبار: {tehranTime(row.expiresAt)} (تهران)</p>}
      {row.partnerRejectionReason && <ErpInlineState kind="stale" title={`دلیل رد قیمت توسط همکار: ${row.partnerRejectionReason}`} />}
      {row.noteOrReason && <p>{row.noteOrReason}</p>}
      {!!row.negotiationHistory?.length && <ErpDisclosure title="پیشنهادها و دلایل قبلی">{row.negotiationHistory.map(item => <div key={item.rowId} className="space-y-1 py-2">
        {item.price && <p>{formatPartnerMoney(item.price.amount, item.price.currency)}</p>}
        {item.rejectionReason && <p>دلیل رد: {item.rejectionReason}</p>}
      </div>)}</ErpDisclosure>}
      {(inquiryAvailability?.reason || availability?.reason) && <p>{inquiryAvailability?.reason || availability?.reason}</p>}
    </div>];
  }) || []);
  return <ErpWorkspacePage title="صندوق کار استعلام‌های همکار">
    <ErpField label="جستجوی قرارداد یا همکار"><ErpInput value={search} onChange={event => { setSearch(event.target.value); setSelected(null); }} placeholder="شماره قرارداد، کد پیگیری یا نام همکار" disabled={locked} /></ErpField>
    {resource.loading && !resource.view && <ErpLoading />}
    {resource.error && <ErpInlineState kind="error" className="flex-col items-start" title={resource.error}
      action={{ label: 'دریافت وضعیت تازه', disabled: resource.loading || locked, onClick: () => void resource.refresh().catch(() => undefined) }} />}
    {resource.view && <>
      <ErpSegmentedControl value={queueView} onChange={value => { setQueueView(value); setSelected(null); }} options={[
        { value: 'pending', label: `نیازمند پاسخ${resource.view.contractCounts ? ` (${resource.view.contractCounts.pending.toLocaleString('fa-IR')})` : ''}` },
        { value: 'answered', label: `پاسخ داده‌شده${resource.view.contractCounts ? ` (${resource.view.contractCounts.answered.toLocaleString('fa-IR')})` : ''}` },
        { value: 'history', label: `سوابق${resource.view.contractCounts ? ` (${resource.view.contractCounts.history.toLocaleString('fa-IR')})` : ''}` },
      ]} />
      <div className="flex flex-wrap justify-end gap-2">
        <ErpButton label="تازه‌سازی صف" variant="outline" disabled={locked || resource.loading} onClick={() => void resource.refresh().catch(() => undefined)} />
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
      <ErpSection title="قراردادها" className="order-2 lg:order-1">
        {visibleInquiries.length === 0 ? <ErpEmptyState title="قراردادی در این فهرست نیست." /> : <ul className="space-y-2">{Array.from(groups.entries()).map(([key, items]) => <li key={key}><ErpCard className="space-y-1 p-2">
          <ErpButton label={`${items[0].customerContractNumber ?? items[0].caseNumber ?? 'استعلام'} · ${items[0].partnerDisplayName}`}
            variant={items.some(item => item.inquiryId === inquiry?.inquiryId) ? 'solid' : 'outline'} disabled={locked || resource.loading}
            onClick={() => setSelected(items[0].inquiryId)} />
          <p className="text-sm sds-text-secondary">{items.reduce((total, item) => total + item.rows.length, 0).toLocaleString('fa-IR')} ردیف · {tehranTime(items[0].submittedAt)}</p>
          {items.length > 1 && <ErpDisclosure title="بسته‌های استعلام">{items.map(item => <ErpButton key={item.inquiryId} label={inquiryLabel(item)} variant="ghost" disabled={locked} onClick={() => setSelected(item.inquiryId)} />)}</ErpDisclosure>}
        </ErpCard></li>)}</ul>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm sds-text-secondary">۵ قرارداد در هر صفحه</p>
          <div className="flex flex-wrap gap-2">
            {resource.canGoBack && <ErpButton label="صفحه قبل" disabled={locked || resource.loading} onClick={resource.back} />}
            {resource.view.nextCursor && <ErpButton label="صفحه بعد" disabled={locked || resource.loading} onClick={() => resource.next(resource.view!.nextCursor!)} />}
          </div>
        </div>
      </ErpSection>
      <div className="order-1 min-w-0 space-y-4 lg:order-2">
      {inquiry && queueView === 'pending' && <ResponderEditor key={inquiry.inquiryId} inquiry={inquiry}
        drafts={draftsByInquiry[inquiry.inquiryId] || {}} onDraftsChange={setDrafts}
        editableRowIds={resource.error || resource.loading ? [] : editableRowIds} rowStatus={rowStatus} session={session}
        refresh={resource.refresh} onLockChange={setLocked} />}
      {inquiry && queueView !== 'pending' && <ErpSection title={inquiry.partnerDisplayName}>
        <div className="grid gap-3 lg:grid-cols-2">{inquiry.rows.map(row => <ErpCard key={row.rowId} className="p-4">
          <p className="font-semibold">{row.description}</p>
          <p className="mt-1 text-sm sds-text-secondary">{states[row.state]} · {tehranTime(inquiry.submittedAt)}</p>
          {row.approvedPrice && <p className="mt-2 text-sm">قیمت سبلان: {formatPartnerMoney(row.approvedPrice.amount, row.approvedPrice.currency)}</p>}
          {row.noteOrReason && <p className="mt-2 text-sm">{row.noteOrReason}</p>}
          {rowStatus[row.rowId]}
        </ErpCard>)}</div>
      </ErpSection>}
      </div>
      </div>
    </>}
  </ErpWorkspacePage>;
}
