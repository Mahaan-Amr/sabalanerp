'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PartnerCreationContextSchema, type PartnerCreationContext } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpCard, ErpEmptyState, ErpFieldView, ErpInlineState, ErpLoading, ErpToolbar, ErpWorkspacePage } from '@/components/erp';
import { FaPlus, FaSearch, FaUsers } from 'react-icons/fa';
import api from '@/lib/api';

type PartnerContext = Extract<PartnerCreationContext, { kind: 'PARTNER' }>;

export function PartnerCustomersRuntime() {
  const router = useRouter();
  const [context, setContext] = useState<PartnerContext>();
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setPending(true); setError(undefined);
    try {
      const response = await api.get('/partner/cases/creation-context');
      const parsed = PartnerCreationContextSchema.safeParse((response.data as { data?: unknown })?.data);
      if (!parsed.success || parsed.data.kind !== 'PARTNER') throw new Error('not-partner');
      setContext(parsed.data);
    } catch { setError('دریافت مشتریان شما انجام نشد.'); }
    finally { setPending(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const customers = useMemo(() => context?.customers.filter(customer => {
    const needle = search.trim().toLocaleLowerCase('fa');
    return !needle || `${customer.displayName} ${customer.address}`.toLocaleLowerCase('fa').includes(needle);
  }) ?? [], [context, search]);
  return <ErpWorkspacePage title="مشتریان من" context="مشتریانی که در محدوده حساب فروش همکار شما ثبت شده‌اند"
    primaryAction={{ label: 'ثبت مشتری', icon: FaPlus, onClick: () => router.push('/dashboard/sales/contracts/create?newCustomer=1') }}>
    <ErpToolbar search={{ value: search, placeholder: 'جست‌وجوی نام یا نشانی', onChange: setSearch }} />
    {pending && !context ? <ErpLoading /> : error ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: () => void load() }} />
      : !customers.length ? <ErpEmptyState icon={search ? FaSearch : FaUsers} title={search ? 'مشتری مطابق جست‌وجو پیدا نشد' : 'هنوز مشتری ثبت نشده است'}
        description={search ? 'عبارت دیگری را امتحان کنید.' : 'برای شروع فروش، مشتری را در محدوده حساب خود ثبت کنید.'}
        action={!search ? { label: 'ثبت مشتری', onClick: () => router.push('/dashboard/sales/contracts/create?newCustomer=1') } : undefined} />
        : <div className="grid gap-4 lg:grid-cols-2">{customers.map(customer => <ErpCard key={customer.id} className="space-y-4 p-4">
          <ErpFieldView label="مشتری" value={customer.displayName} />
          <ErpFieldView label="نشانی تحویل" value={customer.address} />
          <div className="flex justify-end"><ErpButton label="ایجاد فروش برای این مشتری"
            onClick={() => router.push(`/dashboard/sales/contracts/create?customerId=${encodeURIComponent(customer.id)}`)} /></div>
        </ErpCard>)}</div>}
  </ErpWorkspacePage>;
}
