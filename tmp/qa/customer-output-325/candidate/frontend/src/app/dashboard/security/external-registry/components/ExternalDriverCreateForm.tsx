'use client';

import { useState } from 'react';
import { FaPlus } from 'react-icons/fa';
import { ErpButton, ErpInput, ErpSection } from '@/components/erp';
import { dispatchMasterDataAPI } from '@/lib/api';
import { field, RunAction } from './types';

const initial = { firstName: '', lastName: '', nationalCode: '', phone: '', notes: '', reason: 'ثبت پیش‌نویس راننده متفرقه' };

export default function ExternalDriverCreateForm({ saving, run }: { saving: boolean; run: RunAction }) {
  const [form, setForm] = useState(initial);
  return <ErpSection title="ثبت راننده متفرقه"><form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => dispatchMasterDataAPI.createExternalDriver(form), 'راننده متفرقه ثبت شد.').then(() => setForm(initial)); }}>
    <label className={field}>نام<ErpInput required value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label>
    <label className={field}>نام خانوادگی<ErpInput required value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label>
    <label className={field}>کد ملی<ErpInput required inputMode="numeric" value={form.nationalCode} onChange={(event) => setForm({ ...form, nationalCode: event.target.value })} /></label>
    <label className={field}>موبایل<ErpInput required inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
    <label className={`${field} sm:col-span-2`}>دلیل<ErpInput required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
    <ErpButton type="submit" label="ثبت راننده" icon={FaPlus} disabled={saving} className="sm:col-span-2" />
  </form></ErpSection>;
}
