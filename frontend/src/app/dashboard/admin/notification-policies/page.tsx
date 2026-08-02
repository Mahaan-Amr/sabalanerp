'use client';

import { useEffect, useState } from 'react';
import { FaBell, FaEdit, FaSave, FaSearch } from 'react-icons/fa';
import { notificationsAPI } from '@/lib/api';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpCheckboxControl,
  ErpEmptyState,
  ErpInput,
  ErpLoading,
  ErpSelect,
  ErpSheet,
  ErpTextarea,
  ErpWorkspacePage,
} from '@/components/erp';

type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
type Channel = 'IN_APP' | 'REALTIME' | 'WEB_PUSH';

type PolicyRow = {
  definition: {
    type: string;
    mandatory: boolean;
    allowedVariables: string[];
    allowedChannels: Channel[];
    allowedRecipientResolvers: string[];
  };
  policy: {
    version: number;
    enabled: boolean;
    mandatory: boolean;
    titleTemplate: string;
    messageTemplate: string;
    priority: Priority;
    channels: Channel[];
    recipientResolvers: string[];
    batching: 'IMMEDIATE' | 'DAILY';
    changeReason?: string | null;
    createdAt?: string | null;
  };
};

type FormState = {
  enabled: boolean;
  titleTemplate: string;
  messageTemplate: string;
  priority: Priority;
  channels: Channel[];
  recipientResolvers: string[];
  batching: 'IMMEDIATE' | 'DAILY';
  changeReason: string;
};

const eventLabels: Record<string, string> = {
  FAILED_LOGIN_ALERT: 'هشدار تلاش ورود ناموفق',
  HIRING_CHECKLIST_OVERDUE: 'پیگیری الزام معوق جذب',
  HIRING_INVITATION_SMS_FAILED: 'عدم تحویل پیامک دعوت استخدام',
  HIRING_OFFER_DECLINED: 'رد پیشنهاد همکاری',
  NEW_BROWSER_LOGIN: 'ورود از مرورگر جدید',
  RECOVERY_BACKUP_STALE: 'نسخه پشتیبان بازیابی به‌روز نیست',
  SYSTEM_RECOVERY_COMPLETED: 'تکمیل بازیابی کامل سامانه',
  SYSTEM_RECOVERY_STARTED: 'آغاز بازیابی کامل سامانه',
  SUPPORT_TICKET_CREATED: 'تیکت پشتیبانی جدید',
  SUPPORT_TICKET_ASSIGNED: 'ارجاع مستقیم تیکت',
  SUPPORT_TICKET_RESPONSE: 'پاسخ تیکت',
  SUPPORT_TICKET_REPORTER_REMINDER: 'یادآوری پاسخ گزارشگر',
  SUPPORT_TICKET_SLA_WARNING: 'هشدار نزدیک‌شدن به هدف',
  SUPPORT_TICKET_SLA_BREACHED: 'تأخیر در هدف پشتیبانی',
  SALES_CONTRACT_READY_FOR_ACCOUNTING: 'قرارداد آماده بررسی حسابداری',
  ACCOUNTING_RECORD_SUBMITTED: 'ثبت رکورد مالی برای فروش',
  ACCOUNTING_CORRECTION_REQUIRED: 'اصلاح قرارداد توسط فروش',
};

const channelLabels: Record<Channel, string> = {
  IN_APP: 'مرکز اعلان‌ها',
  REALTIME: 'بلادرنگ',
  WEB_PUSH: 'اعلان دستگاه',
};

const resolverLabels: Record<string, string> = {
  DIRECT_USER: 'کاربر مستقیم',
  ACTIVE_ADMINS: 'مدیران سیستم فعال',
  WORKSPACE_USERS: 'کاربران مجاز فضای کاری',
  HR_AUTHORITIES: 'مسئولان منابع انسانی',
  WORKSPACE_MANAGERS: 'مدیران فضای کاری',
  RESOURCE_OWNER: 'مسئول رکورد',
  EXPLICIT_WATCHERS: 'ناظران صریح',
};

const priorityLabels: Record<Priority, string> = {
  LOW: 'کم',
  NORMAL: 'عادی',
  HIGH: 'مهم',
  URGENT: 'فوری',
};

const priorityTone: Record<Priority, 'neutral' | 'info' | 'warning' | 'danger'> = {
  LOW: 'neutral',
  NORMAL: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};

const policyGroup = (type: string) => {
  if (type.includes('LOGIN') || type.includes('BROWSER')) return 'امنیت حساب';
  if (type.startsWith('HIRING_')) return 'جذب و منابع انسانی';
  if (type.startsWith('SUPPORT_')) return 'پشتیبانی';
  if (type.startsWith('SALES_') || type.startsWith('ACCOUNTING_')) return 'فروش و مالی';
  return 'سامانه و بازیابی';
};
const previewTemplate = (value: string) => value.replace(/\{\{[^}]+\}\}/g, 'نمونه');

function PolicySnapshot({ label, value }: { label: string; value: Omit<FormState, 'changeReason'> }) {
  return (
    <ErpCard className="p-3">
      <p className="text-xs font-bold sds-text-muted">{label}</p>
      <dl className="mt-3 space-y-2 text-sm">
        <div><dt className="text-xs sds-text-muted">وضعیت</dt><dd className="font-bold">{value.enabled ? 'فعال' : 'غیرفعال'}</dd></div>
        <div><dt className="text-xs sds-text-muted">عنوان</dt><dd className="font-bold">{value.titleTemplate}</dd></div>
        <div><dt className="text-xs sds-text-muted">متن</dt><dd className="leading-6">{value.messageTemplate}</dd></div>
        <div><dt className="text-xs sds-text-muted">اهمیت</dt><dd>{priorityLabels[value.priority]}</dd></div>
        <div><dt className="text-xs sds-text-muted">کانال‌ها</dt><dd>{value.channels.map((channel) => channelLabels[channel]).join('، ') || '—'}</dd></div>
        <div><dt className="text-xs sds-text-muted">مخاطبان</dt><dd>{value.recipientResolvers.map((resolver) => resolverLabels[resolver] || resolver).join('، ') || '—'}</dd></div>
        <div><dt className="text-xs sds-text-muted">زمان تحویل</dt><dd>{value.batching === 'IMMEDIATE' ? 'فوری' : 'خلاصه روزانه'}</dd></div>
      </dl>
    </ErpCard>
  );
}

const toForm = (row: PolicyRow): FormState => ({
  enabled: row.definition.mandatory ? true : row.policy.enabled,
  titleTemplate: row.policy.titleTemplate,
  messageTemplate: row.policy.messageTemplate,
  priority: row.policy.priority,
  channels: row.policy.channels,
  recipientResolvers: row.policy.recipientResolvers,
  batching: row.policy.batching,
  changeReason: '',
});

export default function NotificationPoliciesPage() {
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [selected, setSelected] = useState<PolicyRow | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await notificationsAPI.getPolicies();
      setRows(response.data.data || []);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت سیاست‌های اعلان ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const edit = (row: PolicyRow) => {
    setSelected(row);
    setForm(toForm(row));
    setError('');
    setMessage('');
  };

  const toggleArrayValue = <T extends string>(values: T[], value: T): T[] =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const save = async () => {
    if (!selected || !form) return;
    if (!form.changeReason.trim()) {
      setError('دلیل تغییر سیاست الزامی است.');
      return;
    }
    if (!form.channels.length || !form.recipientResolvers.length) {
      setError('حداقل یک کانال و یک گروه مخاطب انتخاب کنید.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await notificationsAPI.createPolicyVersion(selected.definition.type, {
        ...form,
        changeReason: form.changeReason.trim(),
      });
      setMessage('نسخه جدید سیاست اعلان ثبت شد.');
      setSelected(null);
      setForm(null);
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'ثبت سیاست اعلان ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const visibleRows = rows.filter((row) => `${eventLabels[row.definition.type] || ''} ${row.definition.type}`.toLocaleLowerCase('fa-IR').includes(search.trim().toLocaleLowerCase('fa-IR')));
  const groupedRows = visibleRows.reduce<Record<string, PolicyRow[]>>((groups, row) => {
    const group = policyGroup(row.definition.type);
    groups[group] = [...(groups[group] || []), row];
    return groups;
  }, {});

  return (
    <ErpWorkspacePage title="سیاست‌های اعلان" primaryAction={{ label: 'به‌روزرسانی', onClick: load, icon: FaBell, tone: 'neutral', variant: 'outline' }}>
      {message && <div role="status" className="rounded-xl border border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] p-3 text-sm font-semibold text-[var(--sds-success)]">{message}</div>}
      {error && <div role="alert" className="rounded-xl border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] p-3 text-sm font-semibold text-[var(--sds-danger)]">{error}</div>}

      <ErpCard className="p-3"><div className="relative max-w-xl"><FaSearch className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 sds-text-muted" /><ErpInput className="pr-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی رویداد اعلان" /></div></ErpCard>
      {loading ? <ErpLoading /> : visibleRows.length === 0 ? (
        <ErpEmptyState icon={FaBell} title="رویداد اعلانی ثبت نشده است" />
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedRows).map(([group, groupRows]) => <section key={group} aria-labelledby={`policy-group-${group}`}><h2 id={`policy-group-${group}`} className="mb-3 text-lg font-black sds-text-primary">{group}</h2><div className="grid gap-4 lg:grid-cols-2">
          {groupRows.map((row) => (
            <ErpCard key={row.definition.type} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-[var(--sds-text-primary)]">
                    {eventLabels[row.definition.type] || row.definition.type}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--sds-text-muted)]" dir="ltr">{row.definition.type}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ErpBadge tone={row.definition.mandatory ? 'danger' : row.policy.enabled ? 'success' : 'neutral'}>
                    {row.definition.mandatory ? 'الزامی' : row.policy.enabled ? 'فعال' : 'غیرفعال'}
                  </ErpBadge>
                  <ErpBadge tone={priorityTone[row.policy.priority]}>
                    {priorityLabels[row.policy.priority]}
                  </ErpBadge>
                  <ErpBadge tone="neutral">نسخه {row.policy.version.toLocaleString('fa-IR')}</ErpBadge>
                </div>
              </div>
              <p className="mt-4 text-sm font-semibold text-[var(--sds-text-primary)]">{row.policy.titleTemplate}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--sds-text-secondary)]">{row.policy.messageTemplate}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {row.policy.channels.map((channel) => <ErpBadge key={channel} tone="info">{channelLabels[channel]}</ErpBadge>)}
              </div>
              <div className="mt-4">
                <ErpButton label="ویرایش سیاست" icon={FaEdit} variant="outline" onClick={() => edit(row)} />
              </div>
            </ErpCard>
          ))}</div></section>)}
        </div>
      )}

      <ErpSheet
        open={Boolean(selected && form)}
        onClose={() => { setSelected(null); setForm(null); }}
        title={selected ? `سیاست ${eventLabels[selected.definition.type] || selected.definition.type}` : 'سیاست اعلان'}
        footer={form ? (
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" tone="neutral" variant="ghost" onClick={() => { setSelected(null); setForm(null); }} />
            <ErpButton label={saving ? 'در حال ثبت...' : 'ثبت نسخه جدید'} icon={FaSave} variant="solid" disabled={saving} onClick={save} />
          </div>
        ) : undefined}
      >
        {selected && form && (
          <div className="space-y-5">
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[var(--sds-border-default)] p-3">
              <span className="text-sm font-semibold">فعال</span>
              <ErpCheckboxControl
                checked={selected.definition.mandatory ? true : form.enabled}
                disabled={selected.definition.mandatory}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold">عنوان فارسی</span>
              <ErpInput value={form.titleTemplate} onChange={(event) => setForm({ ...form, titleTemplate: event.target.value })} />
            </label>
            <ErpCard className="p-3">
              <p className="text-xs font-bold sds-text-muted">پیش‌نمایش زنده</p>
              <p className="mt-2 font-bold sds-text-primary">{previewTemplate(form.titleTemplate) || 'عنوان اعلان'}</p>
              <p className="mt-1 text-sm leading-6 sds-text-secondary">{previewTemplate(form.messageTemplate) || 'متن اعلان'}</p>
            </ErpCard>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">متن فارسی</span>
              <ErpTextarea className="min-h-28" value={form.messageTemplate} onChange={(event) => setForm({ ...form, messageTemplate: event.target.value })} />
            </label>

            {selected.definition.allowedVariables.length > 0 && (
              <div>
                <p className="text-sm font-semibold">متغیرهای مجاز</p>
                <div className="mt-2 flex flex-wrap gap-2" dir="ltr">
                  {selected.definition.allowedVariables.map((variable) => <ErpBadge key={variable} tone="purple">{`{{${variable}}}`}</ErpBadge>)}
                </div>
              </div>
            )}

            <label className="block">
              <span className="mb-2 block text-sm font-semibold">اهمیت</span>
              <ErpSelect value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}>
                {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </ErpSelect>
            </label>

            <div>
              <p className="text-sm font-semibold">کانال‌ها</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {selected.definition.allowedChannels.map((channel) => (
                  <label key={channel} className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sds-border-default)] p-3 text-sm">
                    <ErpCheckboxControl
                      checked={form.channels.includes(channel)}
                      onChange={() => setForm({ ...form, channels: toggleArrayValue(form.channels, channel) })}
                    />
                    {channelLabels[channel]}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold">مخاطبان مجاز</p>
              <div className="mt-2 grid gap-2">
                {selected.definition.allowedRecipientResolvers.map((resolver) => (
                  <label key={resolver} className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sds-border-default)] p-3 text-sm">
                    <ErpCheckboxControl
                      checked={form.recipientResolvers.includes(resolver)}
                      onChange={() => setForm({ ...form, recipientResolvers: toggleArrayValue(form.recipientResolvers, resolver) })}
                    />
                    {resolverLabels[resolver] || resolver}
                  </label>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold">زمان تحویل</span>
              <ErpSelect value={form.batching} onChange={(event) => setForm({ ...form, batching: event.target.value as FormState['batching'] })}>
                <option value="IMMEDIATE">فوری</option>
                <option value="DAILY">خلاصه روزانه</option>
              </ErpSelect>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">دلیل تغییر</span>
              <ErpTextarea className="min-h-24" value={form.changeReason} onChange={(event) => setForm({ ...form, changeReason: event.target.value })} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <PolicySnapshot label="نسخه جاری" value={{ enabled: selected.policy.enabled, titleTemplate: selected.policy.titleTemplate, messageTemplate: selected.policy.messageTemplate, priority: selected.policy.priority, channels: selected.policy.channels, recipientResolvers: selected.policy.recipientResolvers, batching: selected.policy.batching }} />
              <PolicySnapshot label="نسخه پیشنهادی" value={{ enabled: form.enabled, titleTemplate: form.titleTemplate, messageTemplate: form.messageTemplate, priority: form.priority, channels: form.channels, recipientResolvers: form.recipientResolvers, batching: form.batching }} />
            </div>
          </div>
        )}
      </ErpSheet>
    </ErpWorkspacePage>
  );
}
