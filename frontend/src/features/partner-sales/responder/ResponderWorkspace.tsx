'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ResponderWorkspaceViewV2Schema } from '@sabalanerp/partner-sales-contracts';
import type { PartnerCommandPort, PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpLoading, ErpSection, ErpWorkspacePage } from '@/components/erp';
import { actionPresentation } from '../management/availability';
import { PartnerCommandSession } from '../management/commandSession';
import { useWorkspaceQuery } from '../management/useWorkspaceQuery';
import { ResponderEditor } from './ResponderEditor';
import type { ResponseDrafts } from './responseDraft';

const states = { PENDING: 'در انتظار پاسخ', APPROVED: 'تأییدشده', REJECTED: 'ردشده', EXPIRED: 'منقضی‌شده', SUPERSEDED: 'جایگزین‌شده', CANCELLED: 'لغوشده' };
const tehranTime = (instant: string) => new Date(instant).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' });

export function ResponderWorkspace({ queryPort, commandPort }: { queryPort: PartnerQueryV2Port; commandPort: PartnerCommandPort }) {
  const load = useCallback(async (cursor?: string) => {
    const response = await queryPort.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', limit: 20, ...(cursor ? { cursor } : {}) });
    return response.ok ? { ok: true as const, value: ResponderWorkspaceViewV2Schema.parse(response.value) } : response;
  }, [queryPort]);
  const resource = useWorkspaceQuery(load);
  const [selected, setSelected] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [draftsByInquiry, setDraftsByInquiry] = useState<Record<string, ResponseDrafts>>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const inquiry = resource.view?.inquiries.find(item => item.inquiryId === selected) || resource.view?.inquiries[0];
  const activeInquiryId = inquiry?.inquiryId;
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
      {row.noteOrReason && <p>{row.noteOrReason}</p>}
      {(inquiryAvailability?.reason || availability?.reason) && <p>{inquiryAvailability?.reason || availability?.reason}</p>}
    </div>];
  }) || []);
  return <ErpWorkspacePage title="پاسخ استعلام‌های همکار">
    {resource.loading && !resource.view && <ErpLoading />}
    {resource.error && <ErpInlineState kind="error" className="flex-col items-start" title={resource.error}
      action={{ label: 'دریافت وضعیت تازه', disabled: resource.loading || locked, onClick: () => void resource.refresh().catch(() => undefined) }} />}
    {resource.view && <>
      <div className="flex flex-wrap justify-end gap-2">
        <ErpButton label="تازه‌سازی صف" variant="outline" disabled={locked || resource.loading} onClick={() => void resource.refresh().catch(() => undefined)} />
        {resource.canGoBack && <ErpButton label="صفحه قبل" disabled={locked || resource.loading} onClick={resource.back} />}
        {resource.view.nextCursor && <ErpButton label="صفحه بعد" disabled={locked || resource.loading} onClick={() => resource.next(resource.view!.nextCursor!)} />}
      </div>
      {resource.view.inquiries.length === 0 ? <ErpEmptyState title="استعلام منتسبی در دسترس نیست." /> : <ErpSection title="صف پاسخ">
        <div className="flex flex-wrap gap-2">{resource.view.inquiries.map(item => <ErpButton key={item.inquiryId} label={item.partnerDisplayName}
          variant={inquiry?.inquiryId === item.inquiryId ? 'solid' : 'outline'} disabled={locked || resource.loading}
          onClick={() => setSelected(item.inquiryId)} />)}</div>
      </ErpSection>}
      {inquiry && <ResponderEditor key={inquiry.inquiryId} inquiry={inquiry}
        drafts={draftsByInquiry[inquiry.inquiryId] || {}} onDraftsChange={setDrafts}
        editableRowIds={resource.error || resource.loading ? [] : editableRowIds} rowStatus={rowStatus} session={session}
        refresh={resource.refresh} onLockChange={setLocked} />}
    </>}
  </ErpWorkspacePage>;
}
