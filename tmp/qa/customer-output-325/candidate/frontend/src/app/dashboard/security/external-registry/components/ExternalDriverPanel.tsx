'use client';

import { useState } from 'react';
import { FaPlus, FaUserShield } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpInput, ErpSection, ErpSelect } from '@/components/erp';
import { dispatchMasterDataAPI } from '@/lib/api';
import { field, RunAction, today } from './types';

export default function ExternalDriverPanel({ drivers, canManage, saving, run }: { drivers: any[]; canManage: boolean; saving: boolean; run: RunAction }) {
  const [document, setDocument] = useState({ subjectId: '', reference: '', expiresAt: today() });
  const [reason, setReason] = useState('');
  return <ErpSection title="رانندگان متفرقه">
    {canManage && <ErpCard className="mb-5 p-3"><form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.recordExternalDriverDocument(document.subjectId, { documentType: 'DRIVING_LICENCE', reference: document.reference, expiresAt: document.expiresAt }), 'مدرک گواهینامه ثبت شد.').then(() => setDocument({ subjectId: '', reference: '', expiresAt: today() })); }}>
      <label className={field}>راننده<ErpSelect required value={document.subjectId} onChange={(event) => setDocument({ ...document, subjectId: event.target.value })}><option value="">انتخاب کنید</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.firstName} {driver.lastName}</option>)}</ErpSelect></label>
      <label className={field}>شناسه مدرک<ErpInput required value={document.reference} onChange={(event) => setDocument({ ...document, reference: event.target.value })} /></label>
      <label className={field}>تاریخ انقضا<ErpInput required type="date" value={document.expiresAt} onChange={(event) => setDocument({ ...document, expiresAt: event.target.value })} /></label>
      <ErpButton type="submit" label="ثبت مدرک گواهینامه" icon={FaPlus} disabled={saving || !document.subjectId} />
    </form></ErpCard>}
    {canManage && <label className={`${field} mb-4 block`}>دلیل تغییر وضعیت<ErpInput value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
    {!drivers.length ? <ErpEmptyState title="راننده متفرقه ثبت نشده است" icon={FaUserShield} /> : <div className="space-y-3">{drivers.map((driver) => <ErpCard key={driver.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold sds-text-primary">{driver.firstName} {driver.lastName}</p><p className="mt-1 text-sm sds-text-muted">{driver.phone} · {driver.nationalCode}</p><p className="mt-1 text-xs sds-text-muted">{driver.readiness.blockers.join(' · ') || 'آماده ورود به صف'}</p></div><div className="flex flex-wrap items-center gap-2"><ErpBadge tone={driver.readiness.status === 'READY' ? 'success' : 'warning'}>{driver.readiness.status}</ErpBadge><ErpBadge tone={driver.status === 'ACTIVE' ? 'success' : 'warning'}>{driver.status}</ErpBadge>{canManage && <ErpButton label={driver.status === 'DRAFT' ? 'فعال‌سازی' : driver.status === 'ACTIVE' ? 'محدودسازی' : driver.status === 'RESTRICTED' ? 'رفع محدودیت' : 'بازیابی پیش‌نویس'} tone={driver.status === 'ACTIVE' ? 'warning' : 'success'} variant="soft" disabled={saving || !reason.trim()} onClick={() => void run(() => dispatchMasterDataAPI.transitionExternalDriverStatus(driver.id, { status: driver.status === 'DRAFT' ? 'ACTIVE' : driver.status === 'ACTIVE' ? 'RESTRICTED' : driver.status === 'RESTRICTED' ? 'ACTIVE' : 'DRAFT', effectiveFrom: new Date().toISOString(), reason: reason.trim() }), 'وضعیت راننده ثبت شد.').then(() => setReason(''))} />}</div></div></ErpCard>)}</div>}
  </ErpSection>;
}
