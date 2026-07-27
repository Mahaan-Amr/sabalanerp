'use client';

import { useCallback, useEffect, useState } from 'react';
import moment from 'moment-jalaali';
import Link from 'next/link';
import {
  FaBriefcase, FaChevronDown, FaChevronUp, FaPause, FaPlay,
  FaPlus, FaSearch, FaStop, FaSync, FaUserPlus, FaUsers,
} from 'react-icons/fa';
import HrPersianCalendar from '@/features/hr/HrPersianCalendar';
import WorkScheduleEditor, { workScheduleFromApi, workSchedulePayload, type WorkScheduleValue } from '@/components/WorkScheduleEditor';
import {
  ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection,
} from '@/components/erp';
import { hrAPI } from '@/lib/api';
import { hiringAPI } from '@/lib/hiringApi';
import { hrDisplayLabel } from '@/features/hr/hrDisplay';
import {
  apiError, assignmentTypeLabel, dateFa, employmentStatusLabel,
  fieldClass, HrField, HrMessage, toIsoDate,
} from '@/features/hr/hrUi';

const today = () => moment().format('jYYYY/jMM/jDD');
const blankPerson = () => ({
  firstName: '', lastName: '', nationalCode: '', employeeNumber: '', userId: '',
  status: 'ACTIVE', effectiveFrom: today(), positionId: '', responsibleSupervisorAssignmentId: '', confirmDuplicate: false,
  sourceCategory: '', reason: '',
});
const blankAssignment = () => ({
  positionId: '', type: 'SECONDARY', effectiveFrom: today(), effectiveTo: '',
  responsibleSupervisorAssignmentId: '', scheduleContributing: false,
});

export default function HrPersonnelPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [foundation, setFoundation] = useState<any>({ positions: [], availableUsers: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(blankPerson);
  const [supervisors, setSupervisors] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assignmentRelationship, setAssignmentRelationship] = useState<string | null>(null);
  const [assignment, setAssignment] = useState(blankAssignment);
  const [assignmentSupervisors, setAssignmentSupervisors] = useState<any[]>([]);
  const [endDates, setEndDates] = useState<Record<string, string>>({});
  const [authorities, setAuthorities] = useState<string[]>([]);
  const canCreateExceptionalPersonnel = authorities.includes('HR_MANAGER');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [people, base, authorityResponse] = await Promise.all([
        hrAPI.getPersonnel(search ? { search } : undefined),
        hrAPI.getFoundation(),
        hiringAPI.myAuthorities(),
      ]);
      setRows(people.data.data);
      setFoundation(base.data.data);
      setAuthorities(authorityResponse.data.data || []);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (focus) setExpanded(focus);
  }, []);
  useEffect(() => {
    const fetchCandidates = async () => {
      if (!form.positionId || !form.effectiveFrom) return setSupervisors([]);
      try {
        const response = await hrAPI.getSupervisorCandidates({
          positionId: form.positionId,
          effectiveFrom: toIsoDate(form.effectiveFrom),
        });
        setSupervisors(response.data.data);
      } catch { setSupervisors([]); }
    };
    void fetchCandidates();
  }, [form.positionId, form.effectiveFrom]);
  useEffect(() => {
    const fetchCandidates = async () => {
      if (!assignment.positionId || !assignment.effectiveFrom) return setAssignmentSupervisors([]);
      try {
        const response = await hrAPI.getSupervisorCandidates({
          positionId: assignment.positionId,
          effectiveFrom: toIsoDate(assignment.effectiveFrom),
          effectiveTo: assignment.effectiveTo ? toIsoDate(assignment.effectiveTo) : undefined,
        });
        setAssignmentSupervisors(response.data.data);
      } catch { setAssignmentSupervisors([]); }
    };
    void fetchCandidates();
  }, [assignment.positionId, assignment.effectiveFrom, assignment.effectiveTo]);

  const run = async (action: () => Promise<any>, message: string, reset?: () => void) => {
    try {
      setSaving(true); setError(''); setSuccess('');
      await action();
      reset?.();
      setSuccess(message);
      await load();
    } catch (err) { setError(apiError(err)); }
    finally { setSaving(false); }
  };

  if (loading && !rows.length) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="منابع انسانی · پرسنل"
      title="پرسنل و روابط استخدامی"
      description="هویت فرد از دسترسی سامانه جداست؛ رابطه استخدامی و تخصیص جایگاه تاریخ خود را حفظ می‌کنند."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, tone: 'neutral' }]}
      backHref="/dashboard/hr"
    >
      {error && <HrMessage>{error}</HrMessage>}
      {success && <HrMessage tone="success">{success}</HrMessage>}

      {canCreateExceptionalPersonnel ? <ErpSection title="ثبت استثنایی پرسنل" description="فقط برای مهاجرت داده، اصلاح سابقه یا انتقال سازمانی؛ جذب عادی باید از پرونده متقاضی انجام شود.">
        <ErpCard className="p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <HrField label="نام" required><input className={fieldClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></HrField>
            <HrField label="نام خانوادگی" required><input className={fieldClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></HrField>
            <HrField label="کد ملی" hint="در ثبت اولیه می‌تواند خالی بماند."><input className={fieldClass} inputMode="numeric" value={form.nationalCode} onChange={(e) => setForm({ ...form, nationalCode: e.target.value })} /></HrField>
            <HrField label="شماره پرسنلی"><input className={fieldClass} value={form.employeeNumber} onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })} /></HrField>
            <HrField label="وضعیت شروع" required>
              <select className={fieldClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="ACTIVE">فعال</option><option value="PLANNED">برنامه‌ریزی‌شده</option>
              </select>
            </HrField>
            <HrField label="تاریخ شروع" required><HrPersianCalendar value={form.effectiveFrom} onChange={(effectiveFrom) => setForm({ ...form, effectiveFrom })} /></HrField>
            <HrField label="جایگاه اصلی" required>
              <select className={fieldClass} value={form.positionId} onChange={(e) => setForm({ ...form, positionId: e.target.value, responsibleSupervisorAssignmentId: '' })}>
                <option value="">انتخاب جایگاه</option>
                {foundation.positions.filter((item: any) => item.isActive && item.vacancy > 0).map((item: any) => <option key={item.id} value={item.id}>{item.title} · {item.vacancy.toLocaleString('fa-IR')} جای خالی</option>)}
              </select>
            </HrField>
            <HrField label="کاربر سامانه" hint="اختیاری؛ تنها برای دسترسی ERP.">
              <select className={fieldClass} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">بدون حساب کاربری</option>
                {foundation.availableUsers.map((item: any) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName} · {item.username}</option>)}
              </select>
            </HrField>
            {supervisors.length > 1 && (
              <div className="md:col-span-2">
                <HrField label="سرپرست مسئول" required hint="جایگاه سرپرست چند متصدی دارد؛ یک فرد را صریح انتخاب کنید.">
                  <select className={fieldClass} value={form.responsibleSupervisorAssignmentId} onChange={(e) => setForm({ ...form, responsibleSupervisorAssignmentId: e.target.value })}>
                    <option value="">انتخاب سرپرست</option>
                    {supervisors.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.positionTitle}</option>)}
                  </select>
                </HrField>
              </div>
            )}
            <label className="flex items-center gap-2 self-end rounded-xl border border-slate-300 px-3 py-2.5 text-sm dark:border-slate-700">
              <input type="checkbox" checked={form.confirmDuplicate} onChange={(e) => setForm({ ...form, confirmDuplicate: e.target.checked })} />
              نام‌های مشابه را بررسی کرده‌ام
            </label>
            <HrField label="منبع ثبت استثنایی" required>
              <select className={fieldClass} value={form.sourceCategory} onChange={(e) => setForm({ ...form, sourceCategory: e.target.value })}>
                <option value="">انتخاب منبع</option>
                <option value="DATA_MIGRATION">مهاجرت داده</option>
                <option value="HISTORICAL_CORRECTION">اصلاح سابقه</option>
                <option value="ORGANIZATIONAL_TRANSFER">انتقال سازمانی</option>
              </select>
            </HrField>
            <div className="md:col-span-2 xl:col-span-3">
              <HrField label="دلیل ثبت استثنایی" required hint="این توضیح به‌صورت دائمی در رویداد ممیزی نگهداری می‌شود.">
                <textarea className={fieldClass} rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </HrField>
            </div>
          </div>
          <div className="mt-4">
            <ErpButton
              label="ثبت استثنایی پرسنل" icon={FaUserPlus}
              disabled={saving || !form.firstName.trim() || !form.lastName.trim() || !form.positionId || !form.effectiveFrom || !form.sourceCategory || form.reason.trim().length < 10 || (supervisors.length > 1 && !form.responsibleSupervisorAssignmentId)}
              onClick={() => run(
                () => hrAPI.createExceptionalPersonnel({ ...form, effectiveFrom: toIsoDate(form.effectiveFrom) }),
                'پرسنل استثنایی، رابطه استخدامی، تخصیص اصلی و رویداد ممیزی ثبت شد.',
                () => setForm(blankPerson()),
              )}
            />
          </div>
        </ErpCard>
      </ErpSection> : <ErpSection title="ایجاد پرسنل جدید" description="مسیر عادی ایجاد پرسنل از پرونده جذب و پس از تکمیل کنترل‌های استخدام انجام می‌شود.">
        <ErpCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">برای نیروی جدید، ابتدا پرونده متقاضی را ایجاد و چرخه جذب را کامل کنید.</p>
          <Link className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white" href="/dashboard/hr/hiring">رفتن به جذب و پرونده‌های متقاضیان</Link>
        </ErpCard>
      </ErpSection>}

      <ErpSection title="فهرست پرسنل" description={`${rows.length.toLocaleString('fa-IR')} پرونده`} actions={[{ label: 'جستجو', icon: FaSearch, onClick: load, tone: 'neutral' }]}>
        <div className="mb-4"><input className={fieldClass} placeholder="نام، کد ملی یا شماره پرسنلی" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="space-y-3">
          {rows.map((person) => (
            <PersonnelCard
              key={person.id} person={person} open={expanded === person.id}
              onToggle={() => setExpanded(expanded === person.id ? null : person.id)}
              saving={saving} foundation={foundation} assignment={assignment} setAssignment={setAssignment}
              assignmentRelationship={assignmentRelationship} setAssignmentRelationship={setAssignmentRelationship}
              assignmentSupervisors={assignmentSupervisors} endDates={endDates} setEndDates={setEndDates} run={run} authorities={authorities}
            />
          ))}
          {!rows.length && <ErpEmptyState icon={FaUsers} title="پرسنلی برای نمایش وجود ندارد" />}
        </div>
      </ErpSection>
    </ErpPage>
  );
}

function PersonnelCard(props: any) {
  const { person, open, onToggle, saving, foundation, assignment, setAssignment, assignmentRelationship, setAssignmentRelationship, assignmentSupervisors, endDates, setEndDates, run, authorities } = props;
  const relationship = person.hrEmploymentRelationships?.[0];
  const primary = relationship?.assignments?.find((item: any) => item.type === 'PRIMARY' && !item.effectiveTo);
  return (
    <ErpCard className="p-4">
      <button type="button" className="flex w-full items-start justify-between gap-3 text-right" onClick={onToggle}>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">{person.firstName} {person.lastName}</p>
            <ErpBadge tone={relationship?.status === 'ACTIVE' ? 'success' : relationship?.status === 'PLANNED' ? 'info' : relationship?.status === 'SUSPENDED' ? 'warning' : 'neutral'}>
              {relationship ? employmentStatusLabel[relationship.status] : 'فاقد رابطه استخدامی'}
            </ErpBadge>
            {person.user && <ErpBadge tone={person.user.isActive ? 'primary' : 'neutral'}>ERP: {person.user.username}</ErpBadge>}
          </div>
          <p className="mt-1 text-xs text-slate-500">{person.employeeNumber || 'بدون شماره پرسنلی'} · {primary ? `${primary.position.title} / ${primary.position.organizationalUnit.name}` : 'فاقد تخصیص اصلی جاری'}</p>
        </div>
        {open ? <FaChevronUp /> : <FaChevronDown />}
      </button>
      {relationship?.hiringApplication && <Link className="mt-2 inline-block text-xs font-bold text-emerald-700 hover:underline" href={`/dashboard/hr/hiring/${relationship.hiringApplication.id}`}>ایجادشده از پرونده جذب · مشاهده پرونده</Link>}
      {!relationship?.hiringApplication && person.hrPersonnelAudits?.[0]?.eventType === 'EXCEPTIONAL_PERSONNEL_REGISTERED' && <p className="mt-2 text-xs font-bold text-amber-700">ثبت استثنایی · {person.hrPersonnelAudits[0].reason}</p>}
      {open && (
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Info label="کد ملی" value={person.nationalCode || 'ثبت نشده'} />
            <Info label="شروع رابطه" value={dateFa(relationship?.effectiveFrom)} />
            <Info label="وضعیت" value={relationship ? employmentStatusLabel[relationship.status] : '—'} />
            <Info label="تعداد تخصیص‌ها" value={(relationship?.assignments?.length || 0).toLocaleString('fa-IR')} />
          </div>
          <PersonnelScheduleEditor key={`${person.workSchedules?.[0]?.id || 'new-schedule'}-${person.workScheduleChanges?.[0]?.id || 'no-change'}`} person={person} saving={saving} run={run} />
          {relationship && (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {relationship.status === 'PLANNED' && !relationship.hiringApplication && <ErpButton label="فعال‌سازی" icon={FaPlay} tone="success" variant="soft" onClick={() => run(() => hrAPI.updateRelationshipStatus(relationship.id, { status: 'ACTIVE' }), 'رابطه استخدامی فعال شد.')} />}
                {relationship.status === 'PLANNED' && relationship.hiringApplication && <Link className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700" href={`/dashboard/hr/hiring/${relationship.hiringApplication.id}`}>تکمیل پیش‌نیازها و فعال‌سازی در پرونده جذب</Link>}
                {relationship.status === 'ACTIVE' && <ErpButton label="تعلیق" icon={FaPause} tone="warning" variant="soft" onClick={() => run(() => hrAPI.updateRelationshipStatus(relationship.id, { status: 'SUSPENDED' }), 'رابطه استخدامی معلق شد.')} />}
                {relationship.status === 'SUSPENDED' && <ErpButton label="بازگشت به فعال" icon={FaPlay} tone="success" variant="soft" onClick={() => run(() => hrAPI.updateRelationshipStatus(relationship.id, { status: 'ACTIVE' }), 'رابطه استخدامی دوباره فعال شد.')} />}
                <ErpButton label="افزودن مسئولیت" icon={FaPlus} variant="soft" onClick={() => { setAssignmentRelationship(assignmentRelationship === relationship.id ? null : relationship.id); setAssignment(blankAssignment()); }} />
              </div>
              {assignmentRelationship === relationship.id && (
                <AssignmentForm relationship={relationship} saving={saving} foundation={foundation} assignment={assignment} setAssignment={setAssignment} supervisors={assignmentSupervisors} run={run} close={() => setAssignmentRelationship(null)} />
              )}
              <div className="mt-4 space-y-2">
                {relationship.assignments.map((item: any) => (
                  <AssignmentRow key={item.id} item={item} endDate={endDates[item.id] || ''} setEndDate={(value: string) => setEndDates({ ...endDates, [item.id]: value })} run={run} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </ErpCard>
  );
}

function PersonnelScheduleEditor({ person, saving, run }: any) {
  const schedule = person.workSchedules?.[0];
  const change = person.workScheduleChanges?.[0];
  const draftSchedule = change?.effectiveFrom && Array.isArray(change.daysJson)
    ? { effectiveFrom: change.effectiveFrom, days: change.daysJson }
    : schedule;
  const [value, setValue] = useState<WorkScheduleValue>(() => workScheduleFromApi(draftSchedule));
  const [proposalNote, setProposalNote] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const capabilities = person.workScheduleCapabilities || {};

  return (
    <div className="mt-4">
      <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
        <p className="font-bold">گردش تغییر ساعت کاری</p>
        <p className="mt-1 text-xs text-slate-500">
          سرپرست مسئول پیشنهاد می‌دهد؛ کارشناس منابع انسانی آماده و ارسال می‌کند؛ مدیر منابع انسانی دیگری تأیید می‌کند.
        </p>
        <p className="mt-2">وضعیت آخرین درخواست: {change ? hrDisplayLabel(change.status) : 'بدون درخواست باز'}</p>
        {change?.returnReason && <p className="mt-1 text-rose-700">دلیل بازگشت: {change.returnReason}</p>}
      </div>
      {capabilities.canPropose && (
        <div className="mt-3 space-y-3">
          <WorkScheduleEditor value={value} onChange={setValue} />
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input className={fieldClass} placeholder="دلیل پیشنهاد سرپرست مسئول" value={proposalNote} onChange={(event) => setProposalNote(event.target.value)} />
          <ErpButton
            label="ثبت پیشنهاد توسط سرپرست مسئول"
            disabled={saving || !proposalNote.trim() || !value.effectiveDate}
            onClick={() => run(() => hrAPI.proposePersonnelWorkSchedule(person.id, { ...workSchedulePayload(value), proposalNote: proposalNote.trim() }), 'پیشنهاد تغییر ساعت کاری ثبت شد.')}
          />
          </div>
        </div>
      )}
      {change && capabilities.canPrepare && (
        <div className="mt-3">
          <WorkScheduleEditor value={value} onChange={setValue} />
          <div className="mt-3 flex flex-wrap gap-2">
            <ErpButton
              label="ذخیره پیش‌نویس توسط کارشناس منابع انسانی"
              icon={FaSync}
              disabled={saving || !value.effectiveDate}
              onClick={() => run(() => hrAPI.preparePersonnelWorkSchedule(person.id, change.id, workSchedulePayload(value)), 'پیش‌نویس برنامه کاری ذخیره شد.')}
            />
            {capabilities.canSubmit && (
              <ErpButton
                label="ارسال برای تأیید مدیر منابع انسانی"
                disabled={saving}
                onClick={() => run(() => hrAPI.submitPersonnelWorkSchedule(person.id, change.id), 'برنامه کاری برای تأیید ارسال شد.')}
                tone="success"
              />
            )}
          </div>
        </div>
      )}
      {change?.status === 'SUBMITTED' && (capabilities.canApprove || capabilities.canReturn) && (
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
          <input className={fieldClass} placeholder="دلیل بازگرداندن برای اصلاح" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} />
          {capabilities.canReturn && <ErpButton
            label="بازگرداندن"
            disabled={saving || !returnReason.trim()}
            onClick={() => run(() => hrAPI.returnPersonnelWorkSchedule(person.id, change.id, returnReason), 'برنامه کاری برای اصلاح بازگردانده شد.')}
            tone="warning"
          />}
          {capabilities.canApprove && <ErpButton
            label="تأیید و ایجاد نسخه اجرایی"
            disabled={saving}
            onClick={() => run(() => hrAPI.approvePersonnelWorkSchedule(person.id, change.id), 'نسخه اجرایی برنامه کاری تأیید شد.')}
            tone="success"
          />}
        </div>
      )}
      {!change && schedule && (
        <div className="mt-3">
          <WorkScheduleEditor value={workScheduleFromApi(schedule)} onChange={() => undefined} />
        </div>
      )}
    </div>
  );
}

function AssignmentForm({ relationship, saving, foundation, assignment, setAssignment, supervisors, run, close }: any) {
  const hasCurrentPrimary = relationship.assignments.some((item: any) => item.type === 'PRIMARY' && !item.effectiveTo);
  const saveAssignment = () => {
    const payload = { ...assignment, effectiveFrom: toIsoDate(assignment.effectiveFrom), effectiveTo: assignment.effectiveTo ? toIsoDate(assignment.effectiveTo) : null };
    if (assignment.type === 'PRIMARY' && hasCurrentPrimary) return hrAPI.transferPrimaryAssignment(relationship.id, payload);
    return hrAPI.createAssignment(relationship.id, payload);
  };
  return (
    <ErpCard tone="primary" className="mt-4 p-4">
      <p className="mb-3 font-bold">تخصیص ثانویه یا سرپرستی موقت</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <HrField label="نوع" required><select className={fieldClass} value={assignment.type} onChange={(e) => setAssignment({ ...assignment, type: e.target.value })}><option value="PRIMARY">{hasCurrentPrimary ? 'انتقال/ارتقای جایگاه اصلی' : 'تخصیص اصلی'}</option><option value="SECONDARY">ثانویه (مصرف ظرفیت)</option><option value="ACTING">سرپرستی موقت (بدون مصرف ظرفیت)</option></select></HrField>
        <HrField label="جایگاه" required><select className={fieldClass} value={assignment.positionId} onChange={(e) => setAssignment({ ...assignment, positionId: e.target.value, responsibleSupervisorAssignmentId: '' })}><option value="">انتخاب جایگاه</option>{foundation.positions.filter((item: any) => item.isActive && (assignment.type === 'ACTING' || item.vacancy > 0)).map((item: any) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></HrField>
        <HrField label="شروع" required><HrPersianCalendar value={assignment.effectiveFrom} onChange={(effectiveFrom) => setAssignment({ ...assignment, effectiveFrom })} /></HrField>
        <HrField label="پایان"><HrPersianCalendar value={assignment.effectiveTo} onChange={(effectiveTo) => setAssignment({ ...assignment, effectiveTo })} /></HrField>
        {supervisors.length > 1 && <HrField label="سرپرست مسئول" required><select className={fieldClass} value={assignment.responsibleSupervisorAssignmentId} onChange={(e) => setAssignment({ ...assignment, responsibleSupervisorAssignmentId: e.target.value })}><option value="">انتخاب</option>{supervisors.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></HrField>}
        <label className="flex items-center gap-2 self-end rounded-xl border border-slate-300 px-3 py-2.5 text-sm dark:border-slate-700"><input type="checkbox" checked={assignment.scheduleContributing} onChange={(e) => setAssignment({ ...assignment, scheduleContributing: e.target.checked })} />ساعات آن جزو برنامه مورد انتظار باشد</label>
      </div>
      <div className="mt-3"><ErpButton label={assignment.type === 'PRIMARY' && hasCurrentPrimary ? 'ثبت انتقال/ارتقا' : 'ثبت تخصیص'} icon={FaBriefcase} disabled={saving || !assignment.positionId || !assignment.effectiveFrom || (supervisors.length > 1 && !assignment.responsibleSupervisorAssignmentId)} onClick={() => run(saveAssignment, assignment.type === 'PRIMARY' && hasCurrentPrimary ? 'تخصیص اصلی پیشین بسته و تخصیص جدید ثبت شد.' : 'تخصیص تاریخ‌دار ثبت شد.', close)} /></div>
    </ErpCard>
  );
}

function AssignmentRow({ item, endDate, setEndDate, run }: any) {
  const supervisor = item.responsibleSupervisorAssignment?.employmentRelationship?.personnel;
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">{item.position.title} <ErpBadge tone={item.type === 'PRIMARY' ? 'primary' : item.type === 'ACTING' ? 'warning' : 'info'}>{assignmentTypeLabel[item.type]}</ErpBadge></p><p className="mt-1 text-xs text-slate-500">{dateFa(item.effectiveFrom)} تا {dateFa(item.effectiveTo)} · سرپرست مسئول: {supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : 'تعیین نشده'}</p></div>
        {!item.effectiveTo && item.type !== 'PRIMARY' && <div className="flex items-end gap-2"><div className="w-40"><HrPersianCalendar value={endDate} onChange={setEndDate} placeholder="تاریخ پایان" /></div><ErpButton label="پایان تخصیص" icon={FaStop} tone="danger" variant="ghost" disabled={!endDate} onClick={() => run(() => hrAPI.endAssignment(item.id, toIsoDate(endDate)), 'تخصیص در تاریخ انتخاب‌شده پایان یافت.')} /></div>}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}
