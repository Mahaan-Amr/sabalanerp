'use client';
import React, { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ResponderWorkspaceViewV2Schema } from '@sabalanerp/partner-sales-contracts';
import type { PartnerCommandPort, PartnerQueryV2Port, PartnerQueryV2 } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpEmptyState, ErpInlineState, ErpListPage } from '@/components/erp';
import { useWorkspaceQuery } from '../management/useWorkspaceQuery';
import { responderContracts } from './responderContracts';
import { ResponderContractWorkspace } from './ResponderContractWorkspace';
type Query = Extract<PartnerQueryV2, { purpose: 'RESPONDER_WORKSPACE' }>;
const time = (value: string) => new Date(value).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' });
export function ResponderWorkspace({ queryPort, inquiryQueryPort = queryPort, commandPort }: {
  queryPort: PartnerQueryV2Port; inquiryQueryPort?: PartnerQueryV2Port; commandPort: PartnerCommandPort;
}) {
  const params = useSearchParams();
  const [view, setView] = useState<Query['view']>(params.get('view') === 'pending' ? 'pending' : 'all');
  const [status, setStatus] = useState<Query['status']>('all');
  const [search, setSearch] = useState('');
  const load = useCallback(async (cursor?: string) => {
    const response = await queryPort.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view, status, search, ...(cursor ? { cursor } : {}) });
    return response.ok ? { ok: true as const, value: ResponderWorkspaceViewV2Schema.parse(response.value) } : response;
  }, [queryPort, view, status, search]);
  const resource = useWorkspaceQuery(load, `${view}:${status}:${search}`);
  if (params.get('inquiryId')) return <ResponderContractWorkspace inquiryId={params.get('inquiryId')!} queryPort={queryPort} inquiryQueryPort={inquiryQueryPort} commandPort={commandPort} />;
  const rows = resource.view?.contracts ?? responderContracts(resource.view?.inquiries ?? []);
  return <div className="mx-auto w-full max-w-6xl"><ErpListPage title="استعلام های همکار" eyebrow="فروش" rows={rows} rowKey={row => row.id} isLoading={resource.loading}
    actions={[{ label: 'به‌روزرسانی', variant: 'outline', tone: 'neutral', onClick: () => void resource.refresh().catch(() => undefined) }]}
    filters={[
      { id: 'search', label: 'جستجو', type: 'search', value: search, onChange: setSearch, placeholder: 'نام مشتری، همکار یا شماره قرارداد' },
      { id: 'response', label: 'وضعیت پاسخ', type: 'select', value: view ?? 'all', onChange: value => setView(value as Query['view']), options: [{ value: 'all', label: 'همه' }, { value: 'pending', label: 'نیازمند پاسخ' }, { value: 'answered', label: 'پاسخ داده شده' }] },
      { id: 'status', label: 'وضعیت استعلام', type: 'select', value: status ?? 'all', onChange: value => setStatus(value as Query['status']), options: [{ value: 'all', label: 'همه وضعیت‌ها' }, { value: 'approved', label: 'قیمت ارائه‌شده' }, { value: 'rejected', label: 'رد جهت اصلاح' }, { value: 'expired', label: 'قیمت منقضی‌شده' }, { value: 'cancelled', label: 'لغوشده' }, { value: 'superseded', label: 'جایگزین‌شده' }] },
    ]}
    columns={[
      { id: 'customer', header: 'نام مشتری', cell: row => <div><p className="font-semibold">{row.customer}</p><p className="text-xs sds-text-secondary">{row.partnerDisplayName}</p></div> },
      { id: 'number', header: 'شماره قرارداد', cell: row => <div><p>{row.label}</p><p className="text-xs sds-text-secondary">{row.pending ? 'درخواست' : 'پاسخ'}: {time(row.pending ? row.requestedAt : row.answeredAt ?? row.requestedAt)}</p></div> },
      { id: 'status', header: 'وضعیت', cell: row => <div className="space-y-1"><ErpBadge tone={row.pending ? 'warning' : row.answeredRows ? 'success' : 'neutral'}>{row.pending ? 'استعلام نشده' : row.answeredRows ? 'استعلام شده' : row.cancelled ? 'لغوشده' : 'جایگزین‌شده'}</ErpBadge>{row.pending && <p className="text-xs sds-text-secondary">{row.answeredRows.toLocaleString('fa-IR')} از {row.currentRows.toLocaleString('fa-IR')} ردیف پاسخ گرفته‌اند</p>}</div> },
      { id: 'tools', header: 'ابزارها', cell: row => <ErpButton label="مشاهده قرارداد" variant="outline" href={`/dashboard/sales/partner-inquiries/${encodeURIComponent(row.id)}`} /> },
    ]}
    emptyState={<ErpEmptyState title="استعلامی با این فیلتر وجود ندارد." />}
    footer={<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm sds-text-secondary">۲۰ قرارداد در هر صفحه</p><div className="flex gap-2">{resource.canGoBack && <ErpButton label="صفحه قبل" variant="outline" disabled={resource.loading} onClick={resource.back} />}{resource.view?.nextCursor && <ErpButton label="صفحه بعد" variant="outline" disabled={resource.loading} onClick={() => resource.next(resource.view!.nextCursor!)} />}</div></div>}>
    {resource.error && <ErpInlineState kind="error" title={resource.error} action={{ label: 'دریافت وضعیت تازه', onClick: () => void resource.refresh().catch(() => undefined) }} />}
  </ErpListPage></div>;
}
