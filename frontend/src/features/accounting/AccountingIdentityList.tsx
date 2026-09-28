'use client';

import React, { useMemo, useState } from 'react';
import { ErpCard, ErpEmptyState, ErpField, ErpInput, ErpPagination, ErpSearchableSelect } from '@/components/erp';

const roleTitles: Record<string, string> = { CUSTOMER: 'مشتری', SUPPLIER: 'تأمین‌کننده', EMPLOYEE: 'کارمند', OTHER: 'سایر', BANK: 'بانک', CASH: 'صندوق' };
const normalize = (value: string) => value.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).toLocaleLowerCase().trim();
export const filterAccountingIdentities = (items: any[], kind: 'party' | 'financial', search: string, role: string) => items.filter((item) => {
  const text = kind === 'party' ? `${item.displayName} ${item.sourceId || ''}` : `${item.titlePersian} ${item.accountNumber || ''} ${item.iban || ''}`;
  return normalize(text).includes(normalize(search)) && (!role || (kind === 'party' ? item.roles?.some((assignment: any) => assignment.role === role && !assignment.effectiveTo) : item.kind === role));
});

export default function AccountingIdentityList({ items, kind }: { items: any[]; kind: 'party' | 'financial' }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterAccountingIdentities(items, kind, search, role), [items, kind, search, role]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, totalPages);
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2"><ErpField label={kind === 'party' ? 'جست‌وجوی طرف حساب' : 'جست‌وجوی حساب مالی'}>
      <ErpInput value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={kind === 'party' ? 'نام یا شناسه طرف حساب' : 'عنوان، شماره حساب یا شبا'} />
    </ErpField><ErpField label={kind === 'party' ? 'نقش طرف حساب' : 'نوع حساب مالی'}><ErpSearchableSelect value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}>
      <option value="">همه</option>{(kind === 'party' ? ['CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER'] : ['BANK', 'CASH', 'OTHER']).map((value) => <option key={value} value={value}>{roleTitles[value]}</option>)}
    </ErpSearchableSelect></ErpField></div>
    {!filtered.length ? <ErpEmptyState title="موردی با این جست‌وجو پیدا نشد." /> : <div className="grid gap-2 sm:grid-cols-2">
      {filtered.slice((currentPage - 1) * 20, currentPage * 20).map((item) => <ErpCard key={item.id} className="p-3"><strong className="break-words">{kind === 'party' ? item.displayName : item.titlePersian}</strong>
        <p className="mt-1 text-sm text-[var(--sds-text-muted)]">{kind === 'party' ? item.roles?.filter((assignment: any) => !assignment.effectiveTo).map((assignment: any) => roleTitles[assignment.role] || 'سایر').join('، ') : `${roleTitles[item.kind] || 'سایر'} · ${item.currency === 'IRR' ? 'ریال' : item.currency}`}</p>
      </ErpCard>)}
    </div>}
    {filtered.length > 0 && <ErpPagination currentPage={currentPage} totalPages={totalPages} totalItems={filtered.length} itemsPerPage={20} onPageChange={setPage} itemLabel={kind === 'party' ? 'طرف حساب' : 'حساب مالی'} />}
  </div>;
}
