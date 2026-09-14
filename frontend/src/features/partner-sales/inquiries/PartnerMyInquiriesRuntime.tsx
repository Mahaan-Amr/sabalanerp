'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PartnerCreationContextSchema, type PartnerInquiryViewV2 } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpLoading, ErpWorkspacePage } from '@/components/erp';
import { FaClipboardList, FaPlus } from 'react-icons/fa';
import api from '@/lib/api';
import { createPartnerInquiryHttpPorts } from './partnerInquiryHttpPorts';
import { PartnerInquiryPanel } from './PartnerInquiryPanel';

const ports = createPartnerInquiryHttpPorts();

export function PartnerMyInquiriesRuntime() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('inquiryId');
  const [rows, setRows] = useState<PartnerInquiryViewV2[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setPending(true); setError(undefined);
    try {
      const response = await api.get('/partner/cases/creation-context');
      const context = PartnerCreationContextSchema.safeParse((response.data as { data?: unknown })?.data);
      if (!context.success || context.data.kind !== 'PARTNER') throw new Error('not-partner');
      const ids = selectedId ? [selectedId] : context.data.inquiryIds;
      const results = await Promise.all(ids.map(inquiryId => ports.queries.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId })));
      setRows(results.flatMap(result => result.ok ? [result.value] : []));
      if (results.some(result => !result.ok) && !results.some(result => result.ok)) setError('دریافت استعلام‌های شما انجام نشد.');
    } catch { setError('دریافت استعلام‌های شما انجام نشد.'); }
    finally { setPending(false); }
  }, [selectedId]);
  useEffect(() => { void load(); }, [load]);
  return <ErpWorkspacePage title="استعلام‌های من" context="قیمت‌های دریافتی از سبلان برای محصولات انتخاب‌شده"
    primaryAction={{ label: 'استعلام جدید', icon: FaPlus, onClick: () => router.push('/dashboard/sales/contracts/create?newInquiry=1') }}>
    {pending && !rows.length ? <ErpLoading /> : error ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: () => void load() }} />
      : !rows.length ? <ErpEmptyState icon={FaClipboardList} title="هنوز استعلامی ثبت نشده است" description="از مسیر ایجاد فروش، محصولات را انتخاب و استعلام را ارسال کنید." action={{ label: 'ایجاد استعلام', onClick: () => router.push('/dashboard/sales/contracts/create?newInquiry=1') }} />
        : <div className="space-y-8">{rows.map(inquiry => <PartnerInquiryPanel key={inquiry.inquiryId} inquiry={inquiry} now={Date.now()} pending={false}
          onRefresh={() => void load()} onReinquire={() => router.push(`/dashboard/sales/contracts/create?inquiryId=${encodeURIComponent(inquiry.inquiryId)}`)}
          onEnterWizard={() => router.push(`/dashboard/sales/contracts/create?inquiryId=${encodeURIComponent(inquiry.inquiryId)}`)}
          onOpenInquiry={inquiryId => router.push(`/dashboard/sales/partner-inquiries?inquiryId=${encodeURIComponent(inquiryId)}`)} />)}</div>}
    {error && rows.length > 0 && <ErpInlineState kind="error" title={error} />}
  </ErpWorkspacePage>;
}
