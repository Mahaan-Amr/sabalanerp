'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FaBan, FaCheck, FaChevronDown, FaClipboardCheck, FaClock, FaPaperclip, FaPlus, FaRedo, FaRoute, FaStop, FaTimes, FaUserPlus } from 'react-icons/fa';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpInlineState, ErpSection, ErpSheet, ErpShiftTimeline, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
import { ErpInput, ErpPressable, ErpTextarea } from '@/components/erp';
import { securityAPI } from '@/lib/api';
import { askSecurityAction } from '@/components/SecurityNoticeHost';
import PersianCalendar from '@/lib/persian-calendar';

const inputClass = 'sds-field min-h-12 w-full px-4 py-3 text-sm';
const labelClass = 'mb-2 block text-sm font-medium sds-text-secondary ';

const dateTimeFa = (value?: string | null) => value ? PersianCalendar.formatForDisplay(value, true) : '-';
const durationMinutes = (start?: string, end?: string | null) => {
  if (!start) return 0;
  const to = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.floor((to - new Date(start).getTime()) / 60000));
};
const participantName = (person: any) => `${person.firstName} ${person.lastName}`.trim() || person.username || '-';
const participantMeta = (person: any) => person.department?.namePersian || person.position || person.user?.username || '';

export default function SecuritySupervisorReportsPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [session, setSession] = useState<any>(null);
  const [personnel, setPersonnel] = useState<any>(null);
  const [form, setForm] = useState({ categoryId: '', reportTypeId: '', description: '', participantIds: [] as string[] });
  const [participants, setParticipants] = useState<any[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [patrolDescription, setPatrolDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [entrySheetOpen, setEntrySheetOpen] = useState(false);
  const participantPickerRef = useRef<HTMLDivElement>(null);

  const activePatrol = useMemo(() => session?.patrolSessions?.find((patrol: any) => patrol.status === 'ACTIVE'), [session]);
  const selectedCategory = useMemo(() => categories.find((category) => category.id === form.categoryId), [categories, form.categoryId]);
  const categoryTypes = useMemo(() => selectedCategory?.reportTypes || [], [selectedCategory]);
  const selectedType = useMemo(() => types.find((type) => type.id === form.reportTypeId), [types, form.reportTypeId]);
  const showReportTypes = Boolean(selectedCategory?.useReportTypes);
  const showRelatedPersonnel = Boolean(selectedCategory && (showReportTypes ? selectedType?.useRelatedPersonnel : selectedCategory.useRelatedPersonnel));
  const hasMeaningfulDetail = Boolean(form.description.trim() || images.length || (showRelatedPersonnel && form.participantIds.length));
  const selectedParticipants = useMemo(
    () => participants.filter((user) => form.participantIds.includes(user.id)),
    [form.participantIds, participants]
  );
  const timelineEntries = useMemo(() => session?.timeline || [], [session]);

  useEffect(() => {
    if (!participantPickerOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!participantPickerRef.current?.contains(event.target as Node)) setParticipantPickerOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [participantPickerOpen]);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const results = await Promise.allSettled([
        securityAPI.getInstantReportCategories(false),
        securityAPI.getActiveShiftLog(), securityAPI.getShiftLogParticipants(),
      ]);
      const [typesResult, logResult, participantResult] = results;
      const typesResponse = typesResult.status === 'fulfilled' ? typesResult.value : null;
      const logResponse = logResult.status === 'fulfilled' ? logResult.value : null;
      const participantResponse = participantResult.status === 'fulfilled' ? participantResult.value : null;
      if (typesResponse?.data.success) {
        const nextCategories = typesResponse.data.data || [];
        setCategories(nextCategories);
        setTypes(nextCategories.flatMap((category: any) => category.reportTypes || []));
      }
      if (logResponse?.data.success) {
        setSession(logResponse.data.data.session);
        setPersonnel(logResponse.data.data.personnel);
        setReadOnly(Boolean(logResponse.data.data.readOnly));
        setError('');
      }
      if (participantResponse?.data.success) setParticipants(participantResponse.data.data || []);
      if (results.some((result) => result.status === 'rejected')) setError('بخشی از اطلاعات گزارش شیفت دریافت نشد؛ اطلاعات موفق نمایش داده می‌شود.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت گزارش شیفت ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => { void loadData(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [session?.id]);

  const createEntry = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = new FormData();
      payload.append('categoryId', form.categoryId);
      payload.append('reportTypeId', form.reportTypeId);
      payload.append('description', form.description);
      payload.append('participantIds', JSON.stringify(form.participantIds));
      images.forEach((image) => payload.append('images', image));
      await securityAPI.createShiftLogEntry(payload);
      setForm({ categoryId: '', reportTypeId: '', description: '', participantIds: [] });
      setImages([]);
      setMessage('گزارش لحظه‌ای ثبت شد.');
      setEntrySheetOpen(false);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت گزارش لحظه‌ای ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const voidEntry = async (entry: any) => {
    const reason = await askSecurityAction({ title: 'ابطال گزارش', inputLabel: `دلیل ابطال ردیف ${entry.rowNumber.toLocaleString('fa-IR')}` });
    if (!reason?.trim()) return;
    setSaving(true);
    setError('');
    try {
      await securityAPI.voidShiftLogEntry(entry.id, reason.trim());
      setMessage('گزارش باطل شد.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ابطال گزارش ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const startPatrol = async () => {
    setSaving(true);
    setError('');
    try {
      await securityAPI.startPatrol();
      setMessage('گشت‌زنی شروع شد.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'شروع گشت‌زنی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const finishPatrol = async () => {
    if (!activePatrol || !patrolDescription.trim()) return;
    setSaving(true);
    setError('');
    try {
      await securityAPI.finishPatrol(activePatrol.id, patrolDescription.trim());
      setPatrolDescription('');
      setMessage('گشت‌زنی پایان یافت.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'پایان گشت‌زنی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const toggleParticipant = (participantId: string) => {
    setForm((current) => ({
      ...current,
      participantIds: current.participantIds.includes(participantId)
        ? current.participantIds.filter((id) => id !== participantId)
        : [...current.participantIds, participantId],
    }));
  };

  return (
    <ErpWorkspacePage className="guard-workspace" title="گزارش شیفت" context={session ? `${dateTimeFa(session.slot?.startsAt)} تا ${dateTimeFa(session.slot?.endsAt)}` : undefined} primaryAction={!readOnly && session ? { label: 'ثبت گزارش', icon: FaPlus, onClick: () => setEntrySheetOpen(true), variant: 'solid' } : undefined} secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: () => loadData() }]}>
      {loading && !session ? <ErpSkeleton lines={6} /> : <>
      {!readOnly && message && <ErpInlineState kind="success" title={message} />}
      {error && <ErpInlineState kind={session ? 'stale' : 'error'} title={session ? 'آخرین به‌روزرسانی ناموفق بود؛ گزارش قبلی نمایش داده می‌شود.' : error} action={{ label: 'تلاش مجدد', onClick: () => loadData() }} />}
      {readOnly && session && <div className="flex items-center gap-2"><ErpStatus label="فقط‌خواندنی مدیر" tone="info" /><span className="text-xs sds-text-muted">کنترل‌های عملیاتی در دسترس نیست.</span></div>}
      {session?.corrections?.length > 0 && (
        <ErpSection title="اصلاح زمان‌های شیفت">
          <div className="flex flex-wrap items-center gap-2"><ErpStatus label="اصلاح‌شده توسط مدیر" tone="warning" /><span className="text-xs sds-text-muted">{session.corrections.length.toLocaleString('fa-IR')} اصلاح حسابرسی‌شده</span></div>
          <div className="mt-3 divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">
            {session.corrections.map((item: any) => <div key={item.id} className="py-2 text-sm"><p className="font-semibold">{item.correctedByName} · {dateTimeFa(item.correctedAt)}</p><p className="mt-1 text-xs sds-text-muted">زمان مؤثر: {dateTimeFa(item.effectiveStartedAt)} تا {dateTimeFa(item.effectiveEndedAt)}</p><p className="mt-1">{item.reason}</p></div>)}
          </div>
        </ErpSection>
      )}

      {!session ? (
        <ErpEmptyState icon={FaClock} title="شیفت فعال برای شما پیدا نشد" description={personnel ? 'برای ثبت گزارش، ابتدا شیفت برنامه‌ریزی‌شده خود را شروع کنید.' : 'کاربر فعلی جزو نفرات گارد نیست.'} />
      ) : (
        <>
          {!readOnly && <ErpSheet open={entrySheetOpen} onClose={() => setEntrySheetOpen(false)} title="ثبت گزارش لحظه‌ای">
            {activePatrol && (
              <div className="mb-4 rounded-lg border border-[var(--sds-warning)] bg-[var(--sds-warning-soft)] p-3 text-[var(--sds-warning)] dark:border-[var(--sds-warning)] dark:bg-[var(--sds-warning-soft)] dark:text-[var(--sds-warning)]">
                <p className="text-sm font-semibold text-[var(--sds-warning)] dark:text-[var(--sds-warning)]">
                  گشت‌زنی فعال است؛ عکس‌ها را از همین گزارش لحظه‌ای به عنوان شواهد همان بازه ثبت کنید.
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(320px,0.9fr)]">
              <label className="block">
                <span className={labelClass}>دسته‌بندی گزارش لحظه‌ای</span>
                <EnhancedDropdown
                  value={form.categoryId}
                  onChange={(categoryId) => setForm((current) => ({ ...current, categoryId, reportTypeId: '', participantIds: [] }))}
                  placeholder="انتخاب دسته‌بندی"
                  options={categories.map((category) => ({ value: category.id, label: category.name }))}
                  searchable
                  required
                />
                {selectedCategory?.description && <p className="mt-2 text-xs leading-6 sds-text-muted ">{selectedCategory.description}</p>}
              </label>
              {showReportTypes && <label className="block">
                <span className={labelClass}>نوع گزارش لحظه‌ای</span>
                <EnhancedDropdown
                  value={form.reportTypeId}
                  onChange={(reportTypeId) => setForm((current) => ({ ...current, reportTypeId }))}
                  placeholder="انتخاب کنید"
                  options={categoryTypes.map((type: any) => ({ value: type.id, label: type.name }))}
                  searchable
                  required
                  disabled={!form.categoryId}
                />
                {selectedType?.description && <p className="mt-2 text-xs leading-6 sds-text-muted ">{selectedType.description}</p>}
              </label>}
              {showRelatedPersonnel && <div className="space-y-3">
                <div ref={participantPickerRef} className="relative">
                  <span className={labelClass}>افراد مرتبط</span>
                  <ErpPressable
                    type="button"
                    onClick={() => setParticipantPickerOpen((current) => !current)}
                    className="sds-field flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-right text-sm"
                    aria-expanded={participantPickerOpen}
                  >
                    <span className="flex items-center gap-2">
                      <FaUserPlus className="h-4 w-4 text-[var(--sds-accent)] dark:text-[var(--sds-accent)]" />
                      <span>{selectedParticipants.length ? `${selectedParticipants.length.toLocaleString('fa-IR')} نفر انتخاب شده` : 'انتخاب افراد مرتبط'}</span>
                    </span>
                    <FaChevronDown className={`h-3.5 w-3.5 sds-text-muted transition ${participantPickerOpen ? 'rotate-180' : ''}`} />
                  </ErpPressable>
                  {participantPickerOpen && (
                    <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-panel)] p-2 shadow-lg dark:border-[var(--sds-border-default)] dark:bg-[var(--sds-surface-panel)]">
                      {participants.length === 0 ? (
                        <p className="px-3 py-4 text-center text-sm sds-text-muted">فردی برای انتخاب وجود ندارد.</p>
                      ) : (
                        participants.map((user) => {
                          const selected = form.participantIds.includes(user.id);
                          return (
                            <ErpPressable
                              key={user.id}
                              type="button"
                              onClick={() => toggleParticipant(user.id)}
                              className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-right text-sm transition ${selected ? 'bg-[var(--sds-accent-soft)] text-[var(--sds-accent)]' : 'sds-text-secondary hover:bg-[var(--sds-surface-subtle)]'}`}
                            >
                              <span className="min-w-0">
                                <span className="block font-semibold">{participantName(user)}</span>
                                {participantMeta(user) && <span className="mt-0.5 block truncate text-xs opacity-70">{participantMeta(user)}</span>}
                              </span>
                              <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${selected ? 'border-[var(--sds-accent)] bg-[var(--sds-accent)] text-[var(--sds-on-accent)]' : 'border-[var(--sds-border-default)] text-transparent'}`}>
                                <FaCheck className="h-3 w-3" />
                              </span>
                            </ErpPressable>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                <div className="min-h-28 rounded-lg border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-panel)] p-3 dark:border-[var(--sds-border-default)] dark:bg-[var(--sds-surface-panel)]">
                  {selectedParticipants.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedParticipants.map((user) => (
                        <ErpPressable
                          key={user.id}
                          type="button"
                          onClick={() => toggleParticipant(user.id)}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--sds-accent)] bg-[var(--sds-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--sds-accent)] transition"
                          title="حذف از گزارش"
                        >
                          <span>{participantName(user)}</span>
                          <FaTimes className="h-3 w-3" />
                        </ErpPressable>
                      ))}
                    </div>
                  )}
                </div>
              </div>}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4">
              <label className="block">
                <span className={labelClass}>توضیحات (اختیاری)</span>
                <ErpTextarea className={`${inputClass} min-h-28 resize-y`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <label className="block">
                <span className={labelClass}>افزودن عکس</span>
                <div className="flex min-h-12 items-center gap-3 rounded-lg border border-dashed border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-4 py-3 text-sm sds-text-secondary transition hover:border-[var(--sds-accent)] dark:border-[var(--sds-border-default)] dark:bg-[var(--sds-surface-subtle)] ">
                  <FaPaperclip className="h-4 w-4 text-[var(--sds-accent)] dark:text-[var(--sds-accent)]" />
                  <span className="font-medium">{images.length ? `${images.length.toLocaleString('fa-IR')} عکس انتخاب شده` : 'انتخاب عکس‌ها'}</span>
                  <ErpInput type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setImages(Array.from(event.target.files || []))} className="sr-only" />
                </div>
              </label>
            </div>
            {images.length > 0 && <div className="mt-3 flex flex-wrap gap-3">{images.map((image, index) => <div key={`${image.name}-${index}`} className="relative"><img src={URL.createObjectURL(image)} alt={image.name} className="h-20 w-20 rounded-lg object-cover" /><ErpPressable type="button" tone="danger" variant="solid" aria-label={`حذف ${image.name}`} className="absolute -right-2 -top-2 h-11 w-11 rounded-full p-0 text-xs" onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</ErpPressable></div>)}</div>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <ErpButton label="ثبت گزارش" icon={FaPlus} onClick={createEntry} disabled={saving || !form.categoryId || (showReportTypes && !form.reportTypeId) || !hasMeaningfulDetail} variant="solid" />
            </div>
            {selectedCategory?.useReportTypes && categoryTypes.length === 0 && <p className="mt-3 text-sm text-[var(--sds-warning)]">برای این دسته‌بندی هنوز نوع گزارش فعالی تعریف نشده است.</p>}
          </ErpSheet>}

          <ErpSection title="گشت‌زنی">
            {!readOnly && (!activePatrol ? (
              <ErpButton label="شروع گشت‌زنی" icon={FaRoute} onClick={startPatrol} disabled={saving} variant="solid" tone="success" />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <label>
                  <span className={labelClass}>توضیحات پایان گشت‌زنی</span>
                  <ErpTextarea className={`${inputClass} min-h-24`} value={patrolDescription} onChange={(event) => setPatrolDescription(event.target.value)} />
                  <span className="mt-2 block text-xs sds-text-muted">شروع: {dateTimeFa(activePatrol.startedAt)} · مدت: {durationMinutes(activePatrol.startedAt).toLocaleString('fa-IR')} دقیقه</span>
                </label>
                <ErpButton label="پایان گشت‌زنی" icon={FaStop} onClick={finishPatrol} disabled={saving || !patrolDescription.trim()} tone="warning" variant="solid" />
              </div>
            ))}

          </ErpSection>

          <ErpShiftTimeline
            title="خط زمانی شیفت"
            entries={timelineEntries}
            formatTimestamp={dateTimeFa}
            showAttachmentImages
            attachmentHref={(attachmentId) => `/api/security/shift-log/attachments/${attachmentId}`}
            onVoid={readOnly ? undefined : voidEntry}
          />
        </>
      )}
      </>}
    </ErpWorkspacePage>
  );
}
