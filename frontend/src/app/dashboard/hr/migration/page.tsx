'use client';
import { ErpInput } from '@/components/erp';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import moment from 'moment-jalaali';
import { FaCheckCircle, FaClipboardCheck, FaExclamationTriangle, FaPlay, FaSync, FaUsers } from 'react-icons/fa';
import HrPersianCalendar from '@/features/hr/HrPersianCalendar';
import { ErpBadge, ErpButton, ErpCard, ErpLoading, ErpPage, ErpSection, ErpSheet } from '@/components/erp';
import { hrAPI } from '@/lib/api';
import { apiError, HrField, HrMessage, toIsoDate } from '@/features/hr/hrUi';
import { hrDisplayLabel } from '@/features/hr/hrDisplay';

export default function HrMigrationPage() {
  const [data, setData] = useState<any>(null); const [loading, setLoading] = useState(true); const [applying, setApplying] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [baselineDate, setBaselineDate] = useState(moment().format('jYYYY/jMM/jDD')); const [confirmedDepartmentIds, setConfirmedDepartmentIds] = useState<string[]>([]); const [confirmed, setConfirmed] = useState(false);
  const [executionOpen, setExecutionOpen] = useState(false);
  const load = useCallback(async () => { try { setLoading(true); setError(''); setData((await hrAPI.getMigrationPreview()).data.data); } catch (err) { setError(apiError(err)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const toggleDepartment = (id: string) => setConfirmedDepartmentIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const apply = async () => { try { setApplying(true); setError(''); setSuccess(''); const response = await hrAPI.applyMigration({ baselineDate: toIsoDate(baselineDate), confirmedDepartmentIds }); setSuccess(`${response.data.message} ${response.data.data.relationshipsCreated.toLocaleString('fa-IR')} رابطه و ${response.data.data.unitsCreated.toLocaleString('fa-IR')} واحد ایجاد شد.`); setConfirmed(false); await load(); } catch (err) { setError(apiError(err)); } finally { setApplying(false); } };
  if (loading && !data) return <ErpLoading />;
  const counts = data?.counts || {};
  return <ErpPage eyebrow="منابع انسانی · کنترل انتقال" title="مهاجرت و تطبیق داده‌های موجود" description="پیش‌نمایش خواندنی و اجرای قابل تکرار؛ هیچ تاریخ یا رابطه ناشناخته‌ای ساخته نمی‌شود." actions={[{ label: 'اجرای مهاجرت', icon: FaPlay, onClick: () => setExecutionOpen(true), tone: 'success' }, { label: 'اجرای دوباره پیش‌نمایش', icon: FaSync, onClick: load, tone: 'neutral' }]} backHref="/dashboard/hr">
    {error && <HrMessage>{error}</HrMessage>}{success && <HrMessage tone="success">{success}</HrMessage>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">{[
      ['active-personnel', 'پرسنل فعال', counts.activePersonnel],
      ['inactive-personnel', 'پرسنل غیرفعال', counts.inactivePersonnel],
      ['linked-users', 'کاربر متصل', counts.linkedUsers],
      ['unlinked-users', 'کاربر بدون پرسنل', counts.unlinkedUsers],
      ['departments', 'دپارتمان قدیمی', counts.departments],
      ['schedules', 'برنامه کاری قدیمی', counts.schedules],
      ['migrated', 'قبلاً مهاجرت‌شده', counts.migrated],
    ].map(([category, label, value]) => (
      <Link
        key={String(category)}
        href={`/dashboard/hr/migration/${category}`}
        className="group rounded-[var(--sds-radius-card)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]"
        aria-label={`${label}: ${Number(value || 0).toLocaleString('fa-IR')}، مشاهده رکوردها`}
      >
        <ErpCard className="sds-card-interactive h-full p-3 text-center group-hover:border-[var(--sds-accent)]">
          <p className="text-xs text-[var(--sds-text-secondary)]">{label}</p>
          <p className="mt-2 text-xl font-black">{Number(value || 0).toLocaleString('fa-IR')}</p>
        </ErpCard>
      </Link>
    ))}</div>
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <ErpSection title="تعارض‌ها و موارد نیازمند تصمیم" description="این موارد خودکار اصلاح یا حدس زده نمی‌شوند.">
        <div className="space-y-3"><ReviewRow icon={FaUsers} label="نام‌های تکراری احتمالی" value={data?.conflicts?.duplicateNames?.length || 0} warning /><ReviewRow icon={FaExclamationTriangle} label="پرسنل غیرفعال نیازمند بررسی تاریخچه" value={data?.conflicts?.inactivePersonnelNeedReview || 0} warning />{data?.conflicts?.duplicateNames?.map((item: any) => <div key={`${item.firstName}-${item.lastName}`} className="rounded-xl border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 text-sm text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">{item.firstName} {item.lastName} · {item.count.toLocaleString('fa-IR')} رکورد</div>)}</div>
      </ErpSection>
      <ErpSection title="طبقه‌بندی استثناهای قدیمی" description="در این فاز تبدیل نمی‌شوند؛ فقط برای تصمیم فاز مرخصی گزارش می‌شوند.">
        <div className="space-y-3">{data?.exceptions?.map((item: any) => <div key={item.type} className="flex items-center justify-between rounded-xl border border-[var(--sds-border-default)] p-3 dark:border-[var(--sds-border-strong)]"><span>{hrDisplayLabel(item.type)}</span><ErpBadge tone="neutral">{item.count.toLocaleString('fa-IR')}</ErpBadge></div>)}</div>
      </ErpSection>
    </div>
    <ErpSheet open={executionOpen} onClose={() => { if (!applying) setExecutionOpen(false); }} title="اجرای کنترل‌شده مهاجرت" presentation="modal" dismissible={!applying}>
      <ErpCard tone="primary" className="p-4 sm:p-5"><div className="grid grid-cols-1 gap-5 xl:grid-cols-2"><div><HrField label="تاریخ مبنای مهاجرت" required hint="این تاریخ، تاریخ استخدام نیست؛ فقط مرز شروع داده معتبر در مدل جدید است."><HrPersianCalendar value={baselineDate} onChange={setBaselineDate} /></HrField><div className="mt-4 rounded-xl border border-[var(--sds-border-default)] p-3 text-sm dark:border-[var(--sds-border-strong)]"><label className="flex items-start gap-2"><ErpInput className="mt-1" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>پیش‌نمایش و تعارض‌ها را بررسی کرده‌ام و می‌دانم اجرای مهاجرت حذف‌کننده نیست و موارد ناشناخته را تکمیل نمی‌کند.</span></label></div><div className="mt-4"><ErpButton label="اجرای مهاجرت قابل تکرار" icon={FaPlay} disabled={applying || !baselineDate || !confirmed} onClick={apply} tone="success" /></div></div>
      <div><p className="mb-3 text-sm font-bold">دپارتمان‌هایی که منابع انسانی به‌عنوان واحد سازمانی تأیید کرده است</p><div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-[var(--sds-border-default)] p-3 dark:border-[var(--sds-border-strong)]">{data?.departments?.map((department: any) => <label key={department.id} className="flex items-center justify-between gap-3 rounded-lg p-2 hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-raised)]"><span><b>{department.namePersian || department.name}</b><small className="mr-2 text-[var(--sds-text-secondary)]">{department.name}</small></span><ErpInput type="checkbox" checked={confirmedDepartmentIds.includes(department.id)} onChange={() => toggleDepartment(department.id)} /></label>)}</div></div></div></ErpCard>
    </ErpSheet>
  </ErpPage>;
}

function ReviewRow({ icon: Icon, label, value, warning = false }: { icon: any; label: string; value: number; warning?: boolean }) { return <div className="flex items-center justify-between rounded-xl border border-[var(--sds-border-default)] p-3 dark:border-[var(--sds-border-strong)]"><span className="flex items-center gap-2"><Icon className={warning && value ? 'text-[var(--sds-warning)]' : 'text-[var(--sds-success)]'} />{label}</span><ErpBadge tone={warning && value ? 'warning' : 'success'}>{Number(value).toLocaleString('fa-IR')}</ErpBadge></div>; }
