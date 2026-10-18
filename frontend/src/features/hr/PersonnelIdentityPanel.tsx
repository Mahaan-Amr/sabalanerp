'use client';

import { useState } from 'react';
import { ErpButton, ErpCard, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpSheet } from '@/components/erp';
import { hrAPI } from '@/lib/api';
import { normalizeDigits, normalizeIdentifierDigits } from '@/lib/numberFormat';
import { apiError, dateTimeFa } from './hrUi';

const fields = [
  ['firstName', 'نام'], ['lastName', 'نام خانوادگی'], ['nationalCode', 'کد ملی'], ['employeeNumber', 'شمارهٔ پرسنلی'],
] as const;
type Values = Record<typeof fields[number][0], string>;
type Identity = Values & { identityVersion: string; archivedAt: string | null; hasUser: boolean; history: Array<{ id: string; createdAt: string; actorName: string; changes: { before: Values; after: Values; userBefore?: Pick<Values, 'firstName' | 'lastName'>; userAfter?: Pick<Values, 'firstName' | 'lastName'> } }> };
const valuesFrom = (data: Identity): Values => ({ firstName: data.firstName, lastName: data.lastName, nationalCode: data.nationalCode || '', employeeNumber: data.employeeNumber || '' });

export default function PersonnelIdentityPanel({ personnelId, canEdit, onSaved }: { personnelId: string; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [mode, setMode] = useState<'edit' | 'history' | null>(null);
  const [data, setData] = useState<Identity | null>(null);
  const [form, setForm] = useState<Values | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty = data && form && JSON.stringify(valuesFrom(data)) !== JSON.stringify(form);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await hrAPI.getPersonnelIdentity(personnelId);
      setData(response.data.data); setForm(valuesFrom(response.data.data)); setConflict(false);
    } catch (err) { setError(apiError(err)); }
    finally { setLoading(false); }
  };
  const open = (next: 'edit' | 'history') => { setMode(next); setData(null); setForm(null); setConflict(false); void load(); };
  const close = () => { if (busy || loading) return; if (mode === 'edit' && dirty) setDiscard(true); else setMode(null); };
  const save = async () => {
    if (!form || !data || !canEdit) return;
    setBusy(true); setError('');
    try {
      await hrAPI.updatePersonnel(personnelId, { ...form, expectedIdentityVersion: data.identityVersion });
      setMode(null); await onSaved();
    } catch (err: any) {
      setError(apiError(err));
      const payload = err.response?.data;
      if (err.response?.status === 409 && (payload?.code === 'PERSONNEL_IDENTITY_CONFLICT' || payload?.code === 'PERSONNEL_ARCHIVED' || String(payload?.error || '').includes('هم‌زمان'))) setConflict(true);
    } finally { setBusy(false); }
  };
  return <>
    <div className="flex flex-wrap gap-2">
      {canEdit && <ErpButton label="ویرایش مشخصات" variant="soft" onClick={() => open('edit')} />}
      <ErpButton label="تاریخچهٔ مشخصات" variant="ghost" onClick={() => open('history')} />
    </div>
    <ErpSheet open={mode !== null} onClose={close} title={mode === 'edit' ? 'ویرایش مشخصات پرسنل' : 'تاریخچهٔ مشخصات پرسنل'} presentation="modal" scope="workspace" size="default" pending={busy || loading}>
      <div className="space-y-4" dir="rtl">
        {loading && <ErpLoading />}
        {error && <ErpInlineState kind="error" title={error} />}
        {conflict && <ErpButton label="دریافت آخرین اطلاعات" variant="outline" onClick={() => void load()} disabled={busy || loading} />}
        {!loading && !data && error && <ErpButton label="تلاش دوباره" onClick={() => void load()} />}
        {!loading && data && mode === 'edit' && form && <>
          {data.hasUser && <ErpInlineState kind="empty" title="تغییر نام، نام حساب سامانهٔ متصل را هم به‌روزرسانی می‌کند." />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map(([key, label]) => <ErpField key={key} label={label} required={key === 'firstName' || key === 'lastName'} error={(key === 'nationalCode' || key === 'employeeNumber') && data[key] && !form[key].trim() ? 'شناسهٔ ثبت‌شده قابل خالی‌کردن نیست.' : undefined}>
              <ErpInput id={`personnel-identity-${key}`} value={form[key]} maxLength={key === 'nationalCode' ? 10 : 100} disabled={busy || conflict || !canEdit || Boolean(data.archivedAt)}
                inputMode={key === 'nationalCode' ? 'numeric' : 'text'} dir={key === 'nationalCode' || key === 'employeeNumber' ? 'ltr' : 'rtl'}
                onChange={event => setForm({ ...form, [key]: key === 'nationalCode' ? normalizeIdentifierDigits(event.target.value) : key === 'employeeNumber' ? normalizeDigits(event.target.value) : event.target.value })} />
            </ErpField>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <ErpButton label="ذخیرهٔ مشخصات" onClick={() => void save()} disabled={busy || conflict || !canEdit || Boolean(data.archivedAt) || !dirty || !form.firstName.trim() || !form.lastName.trim() || Boolean(data.nationalCode && !form.nationalCode.trim()) || Boolean(data.employeeNumber && !form.employeeNumber.trim())} />
            <ErpButton label="انصراف" variant="ghost" onClick={close} disabled={busy} />
          </div>
        </>}
        {!loading && data && mode === 'history' && <>
          {!data.history.length && <ErpInlineState kind="empty" title="تغییری در مشخصات ثبت نشده است." />}
          {data.history.map(row => <ErpCard key={row.id} className="space-y-2 p-4">
            <p className="font-bold">{row.actorName}</p><p className="text-sm text-[var(--sds-text-secondary)]">{dateTimeFa(row.createdAt)}</p>
            {fields.filter(([key]) => row.changes.before[key] !== row.changes.after[key]).map(([key, label]) => <p key={key} className="break-words text-sm">{label}: {row.changes.before[key] || 'ثبت نشده'} ← {row.changes.after[key] || 'ثبت نشده'}</p>)}
            {row.changes.userBefore && row.changes.userAfter && <p className="break-words text-sm">نام حساب سامانه: {row.changes.userBefore.firstName} {row.changes.userBefore.lastName} ← {row.changes.userAfter.firstName} {row.changes.userAfter.lastName}</p>}
          </ErpCard>)}
          {data.history.length === 100 && <ErpInlineState kind="empty" title="۱۰۰ تغییر اخیر نمایش داده می‌شود." />}
        </>}
      </div>
    </ErpSheet>
    <ErpSheet open={discard} onClose={() => setDiscard(false)} title="کنارگذاشتن تغییرات مشخصات؟" presentation="modal" scope="workspace" size="default">
      <div className="flex flex-wrap gap-2"><ErpButton label="ادامهٔ ویرایش" onClick={() => setDiscard(false)} /><ErpButton label="کنارگذاشتن تغییرات" tone="danger" variant="outline" onClick={() => { setDiscard(false); setMode(null); }} /></div>
    </ErpSheet>
  </>;
}
