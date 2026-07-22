'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FaBan, FaCheck, FaChevronDown, FaClipboardCheck, FaClock, FaPaperclip, FaPlus, FaRedo, FaRoute, FaStop, FaTimes, FaUserPlus } from 'react-icons/fa';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpShiftTimeline } from '@/components/erp';
import { securityAPI } from '@/lib/api';
import { askSecurityAction } from '@/components/SecurityNoticeHost';
import PersianCalendar from '@/lib/persian-calendar';

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';

const dateTimeFa = (value?: string | null) => value ? PersianCalendar.formatForDisplay(value, true) : '-';
const durationMinutes = (start?: string, end?: string | null) => {
  if (!start) return 0;
  const to = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.floor((to - new Date(start).getTime()) / 60000));
};
const participantName = (person: any) => `${person.firstName} ${person.lastName}`.trim() || person.username || '-';
const participantMeta = (person: any) => person.department?.namePersian || person.position || person.user?.username || '';
const logParticipantName = (participant: any) => participantName(participant.personnel || participant.user);

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
  const timelineEntries = useMemo(() => (session?.logEntries || []).map((entry: any) => ({
    id: entry.id,
    rowNumber: entry.rowNumber,
    status: entry.status,
    title: `${entry.categoryNameSnapshot}${entry.reportTypeNameSnapshot ? ` / ${entry.reportTypeNameSnapshot}` : ''}`,
    typeDescription: entry.reportType?.description || null,
    description: entry.description || null,
    participants: (entry.participants || []).map(logParticipantName),
    createdAt: entry.createdAt,
    voidReason: entry.voidReason || null,
    voidedAt: entry.voidedAt || null,
    attachments: (entry.attachments || []).map((attachment: any) => ({ id: attachment.id, name: attachment.originalName })),
  })), [session]);

  useEffect(() => {
    if (!participantPickerOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!participantPickerRef.current?.contains(event.target as Node)) setParticipantPickerOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [participantPickerOpen]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [typesResponse, logResponse, participantResponse] = await Promise.all([
        securityAPI.getInstantReportCategories(false),
        securityAPI.getActiveShiftLog(), securityAPI.getShiftLogParticipants(),
      ]);
      if (typesResponse.data.success) {
        const nextCategories = typesResponse.data.data || [];
        setCategories(nextCategories);
        setTypes(nextCategories.flatMap((category: any) => category.reportTypes || []));
      }
      if (logResponse.data.success) {
        setSession(logResponse.data.data.session);
        setPersonnel(logResponse.data.data.personnel);
        setReadOnly(Boolean(logResponse.data.data.readOnly));
      }
      if (participantResponse.data.success) setParticipants(participantResponse.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت گزارش شیفت ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حراست"
      title="گزارش شیفت"
      description={readOnly ? 'نمایش فقط‌خواندنی گزارش کامل شیفت فعال' : 'ثبت گزارش‌های لحظه‌ای و گشت‌زنی‌های شیفت فعال با زمان دقیق و سابقه ابطال.'}
      actions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: loadData, tone: 'neutral' }]}
      metrics={[
        { label: 'گزارش‌ها', value: (session?.logEntries?.length || 0).toLocaleString('fa-IR'), icon: FaClipboardCheck, tone: 'info' },
        { label: 'گشت‌زنی‌ها', value: (session?.patrolSessions?.length || 0).toLocaleString('fa-IR'), icon: FaRoute, tone: activePatrol ? 'warning' : 'success' },
      ]}
    >
      {!readOnly && message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      {readOnly && session && <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">این گزارش برای مدیر فقط‌خواندنی است و هیچ عملیات شیفتی از این صفحه در دسترس نیست.</div>}

      {!session ? (
        <ErpEmptyState icon={FaClock} title="شیفت فعال برای شما پیدا نشد" description={personnel ? 'برای ثبت گزارش، ابتدا شیفت برنامه‌ریزی‌شده خود را شروع کنید.' : 'کاربر فعلی جزو نفرات حراست نیست.'} />
      ) : (
        <>
          {!readOnly && <ErpSection title="ثبت گزارش لحظه‌ای" description="هر ردیف به شیفت فعال اضافه می‌شود و افراد مرتبط به صورت انتخابی کنار همان گزارش ذخیره می‌شوند.">
            {activePatrol && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-100">
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
                {selectedCategory?.description && <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">{selectedCategory.description}</p>}
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
                {selectedType?.description && <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">{selectedType.description}</p>}
              </label>}
              {showRelatedPersonnel && <div className="space-y-3">
                <div ref={participantPickerRef} className="relative">
                  <span className={labelClass}>افراد مرتبط</span>
                  <button
                    type="button"
                    onClick={() => setParticipantPickerOpen((current) => !current)}
                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right text-sm text-slate-900 outline-none transition hover:border-[#074747]/40 focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900"
                    aria-expanded={participantPickerOpen}
                  >
                    <span className="flex items-center gap-2">
                      <FaUserPlus className="h-4 w-4 text-[#074747] dark:text-teal-200" />
                      <span>{selectedParticipants.length ? `${selectedParticipants.length.toLocaleString('fa-IR')} نفر انتخاب شده` : 'انتخاب افراد مرتبط'}</span>
                    </span>
                    <FaChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${participantPickerOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {participantPickerOpen && (
                    <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      {participants.length === 0 ? (
                        <p className="px-3 py-4 text-center text-sm text-slate-500">فردی برای انتخاب وجود ندارد.</p>
                      ) : (
                        participants.map((user) => {
                          const selected = form.participantIds.includes(user.id);
                          return (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => toggleParticipant(user.id)}
                              className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-right text-sm transition ${selected ? 'bg-[#074747]/10 text-[#074747] dark:bg-teal-900/30 dark:text-teal-100' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                            >
                              <span className="min-w-0">
                                <span className="block font-semibold">{participantName(user)}</span>
                                {participantMeta(user) && <span className="mt-0.5 block truncate text-xs opacity-70">{participantMeta(user)}</span>}
                              </span>
                              <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${selected ? 'border-[#074747] bg-[#074747] text-white dark:border-teal-300 dark:bg-teal-500' : 'border-slate-300 text-transparent dark:border-slate-600'}`}>
                                <FaCheck className="h-3 w-3" />
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                <div className="min-h-28 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/70">
                  {selectedParticipants.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedParticipants.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => toggleParticipant(user.id)}
                          className="inline-flex items-center gap-2 rounded-full border border-[#074747]/20 bg-[#074747]/10 px-3 py-1.5 text-xs font-semibold text-[#074747] transition hover:bg-[#074747]/15 dark:border-teal-700 dark:bg-teal-900/30 dark:text-teal-100"
                          title="حذف از گزارش"
                        >
                          <span>{participantName(user)}</span>
                          <FaTimes className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4">
              <label className="block">
                <span className={labelClass}>توضیحات (اختیاری)</span>
                <textarea className={`${inputClass} min-h-28 resize-y`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <label className="block">
                <span className={labelClass}>افزودن عکس</span>
                <div className="flex min-h-12 items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 transition hover:border-[#074747]/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <FaPaperclip className="h-4 w-4 text-[#074747] dark:text-teal-200" />
                  <span className="font-medium">{images.length ? `${images.length.toLocaleString('fa-IR')} عکس انتخاب شده` : 'انتخاب عکس‌ها'}</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setImages(Array.from(event.target.files || []))} className="sr-only" />
                </div>
              </label>
            </div>
            {images.length > 0 && <div className="mt-3 flex flex-wrap gap-3">{images.map((image, index) => <div key={`${image.name}-${index}`} className="relative"><img src={URL.createObjectURL(image)} alt={image.name} className="h-20 w-20 rounded-lg object-cover" /><button type="button" className="absolute -right-2 -top-2 rounded-full bg-red-600 px-2 py-1 text-xs text-white" onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <ErpButton label="ثبت گزارش" icon={FaPlus} onClick={createEntry} disabled={saving || !form.categoryId || (showReportTypes && !form.reportTypeId) || !hasMeaningfulDetail} variant="solid" />
            </div>
            {selectedCategory?.useReportTypes && categoryTypes.length === 0 && <p className="mt-3 text-sm text-amber-700">برای این دسته‌بندی هنوز نوع گزارش فعالی تعریف نشده است.</p>}
          </ErpSection>}

          <ErpSection title="گشت‌زنی">
            {!readOnly && (!activePatrol ? (
              <ErpButton label="شروع گشت‌زنی" icon={FaRoute} onClick={startPatrol} disabled={saving} variant="solid" tone="success" />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <label>
                  <span className={labelClass}>توضیحات پایان گشت‌زنی</span>
                  <textarea className={`${inputClass} min-h-24`} value={patrolDescription} onChange={(event) => setPatrolDescription(event.target.value)} />
                  <span className="mt-2 block text-xs text-slate-500">شروع: {dateTimeFa(activePatrol.startedAt)} · مدت: {durationMinutes(activePatrol.startedAt).toLocaleString('fa-IR')} دقیقه</span>
                </label>
                <ErpButton label="پایان گشت‌زنی" icon={FaStop} onClick={finishPatrol} disabled={saving || !patrolDescription.trim()} tone="warning" variant="solid" />
              </div>
            ))}

            <div className="mt-4 space-y-3">
              {(session.patrolSessions || []).map((patrol: any) => (
                <ErpCard key={patrol.id} className="p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">شروع {dateTimeFa(patrol.startedAt)}</p>
                      <p className="mt-1 text-sm text-slate-500">پایان: {dateTimeFa(patrol.endedAt)} · مدت: {durationMinutes(patrol.startedAt, patrol.endedAt).toLocaleString('fa-IR')} دقیقه</p>
                      {patrol.description && <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{patrol.description}</p>}
                    </div>
                    <ErpBadge tone={patrol.status === 'ACTIVE' ? 'warning' : 'success'}>{patrol.status === 'ACTIVE' ? 'فعال' : 'پایان یافته'}</ErpBadge>
                  </div>
                </ErpCard>
              ))}
            </div>
          </ErpSection>

          <ErpShiftTimeline
            title="ردیف‌های گزارش شیفت"
            entries={timelineEntries}
            formatTimestamp={dateTimeFa}
            showAttachmentImages
            attachmentHref={(attachmentId) => `/api/security/shift-log/attachments/${attachmentId}`}
            onVoid={readOnly ? undefined : voidEntry}
          />
        </>
      )}
    </ErpPage>
  );
}
