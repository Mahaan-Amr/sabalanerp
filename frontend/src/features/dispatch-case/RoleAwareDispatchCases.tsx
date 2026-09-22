'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpInlineState, ErpLoading, ErpSection, ErpSheet } from '@/components/erp';
import { useAuth } from '@/contexts/AuthContext';
import { dispatchCasesAPI } from '@/lib/api';
import {
  dispatchActionLabel,
  dispatchCaseReference,
  dispatchDriverName,
  dispatchEventLabel,
  dispatchRecoveryLabel,
  dispatchStationLabel,
  dispatchStatusLabel,
  evidenceDetailPresentation,
} from './dispatchCasePresentation';

type Props = { workspace: 'hr' | 'vehicle-operations' | 'security' | 'logistics' | 'accounting'; subjectId?: string; loadingId?: string;
  onStaleChange?: (stale: boolean) => void };
const labels: Record<string, string> = { hr: 'منابع انسانی', 'vehicle-operations': 'عملیات خودرو', security: 'گارد', logistics: 'لجستیک', accounting: 'حسابداری' };
const statusOf = (error: any) => Number(error?.response?.status || 0);

export default function RoleAwareDispatchCases({ workspace, subjectId, loadingId, onStaleChange }: Props) {
  const { user, loading: authLoading } = useAuth();
  const storagePrefix = `dispatch-cases:last-success:${user?.id || 'anonymous'}:${workspace}:${subjectId || loadingId || 'all'}`;
  const [cases, setCases] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<any>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [technicalDetailsVisible, setTechnicalDetailsVisible] = useState(false);
  const [accessScope, setAccessScope] = useState<string | null>(null);
  const [authorizedUserId, setAuthorizedUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [denied, setDenied] = useState(false);
  const filters = useMemo(() => ({ subjectId, loadingId }), [subjectId, loadingId]);
  const storageKey = accessScope ? `${storagePrefix}:${accessScope}` : null;
  const updateStale = useCallback((value: boolean) => { setStale(value); onStaleChange?.(value); }, [onStaleChange]);

  const readSaved = useCallback((key: string | null) => {
    if (!key) return {} as any;
    try { return JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { return {} as any; }
  }, []);
  const clearAuthorizedCaches = useCallback(() => {
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(`${storagePrefix}:`)) sessionStorage.removeItem(key);
      }
    } catch { /* Storage availability must not affect authorization handling. */ }
  }, [storagePrefix]);
  const save = useCallback((next: { cases?: any[]; selected?: string | null; timeline?: any; selectedEventId?: string | null }) => {
    if (!storageKey) return;
    try {
      const previous = readSaved(storageKey);
      sessionStorage.setItem(storageKey, JSON.stringify({ ...previous, ...next, scrollY: window.scrollY,
        savedAt: new Date().toISOString() }));
    } catch { /* Last Successful View is optional when browser storage is unavailable. */ }
  }, [readSaved, storageKey]);

  const load = useCallback(async () => {
    if (authLoading || !user) { setLoading(authLoading); return; }
    setLoading(true);
    try {
      const response = await dispatchCasesAPI.list(workspace, filters);
      const next = response.data.data || [];
      const scope = String(response.data.access?.permission || 'view');
      const nextKey = `${storagePrefix}:${scope}`;
      const saved = readSaved(nextKey);
      setAccessScope(scope); setAuthorizedUserId(user.id); setCases(next); updateStale(false); setDenied(false);
      if (saved.selected && next.some((item: any) => item.id === saved.selected)) {
        setSelected(saved.selected); setSelectedEventId(saved.selectedEventId || null);
        if (saved.timeline?.case?.id === saved.selected) setTimeline(saved.timeline);
        if (Number.isFinite(saved.scrollY)) requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY }));
      }
      try { sessionStorage.setItem(nextKey, JSON.stringify({ ...saved, cases: next, savedAt: new Date().toISOString() })); } catch { /* optional cache */ }
    } catch (error) {
      const status = statusOf(error);
      if (status === 401 || status === 403) {
        clearAuthorizedCaches(); setAccessScope(null); setAuthorizedUserId(null); setCases([]); setSelected(null); setTimeline(null); setDenied(true); updateStale(false);
      } else if (storageKey) {
        const saved = readSaved(storageKey); setCases(saved.cases || []); updateStale(true);
      } else { setCases([]); updateStale(true); }
    } finally { setLoading(false); }
  }, [authLoading, clearAuthorizedCaches, filters, readSaved, storageKey, storagePrefix, updateStale, user, workspace]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected || !storageKey) return;
    const saved = readSaved(storageKey);
    if (saved.timeline?.case?.id === selected) setTimeline(saved.timeline); else setTimeline(null);
    save({ selected });
    dispatchCasesAPI.detail(workspace, selected, filters).then((response) => {
      setTimeline(response.data.data); updateStale(false); save({ selected, timeline: response.data.data });
    }).catch((error) => {
      const status = statusOf(error);
      if (status === 401 || status === 403) {
        clearAuthorizedCaches(); setAccessScope(null); setAuthorizedUserId(null); setCases([]); setSelected(null); setTimeline(null); setDenied(true); updateStale(false);
      } else if (!status || status >= 500) {
        updateStale(true);
        if (saved.timeline?.case?.id === selected) setTimeline(saved.timeline);
        else setTimeline({ case: { id: selected }, currentAction: 'LAST_SUCCESS_UNAVAILABLE', recovery: 'RETRY_WHEN_ONLINE', events: [] });
      } else { setSelected(null); setTimeline(null); }
    });
  }, [clearAuthorizedCaches, filters, readSaved, save, selected, storageKey, updateStale, workspace]);
  const selectedEvent = timeline?.events?.find((event: any) => event.id === selectedEventId) || null;
  const selectedEvidence = evidenceDetailPresentation(selectedEvent?.detail || {});
  const authorized = Boolean(user && authorizedUserId === user.id && accessScope);
  const visibleCases = authorized ? cases : [];

  return <ErpSection title={`پرونده‌های ارسال · ${labels[workspace]}`} description="نمای زمانی مشترک فقط‌خواندنی است؛ هر فرمان عملیاتی در فضای کاری مالک خود باقی می‌ماند."
    actions={[{ label: 'تازه‌سازی', onClick: () => void load(), variant: 'outline', disabled: loading }]}>
    {denied && <ErpInlineState kind="error" title="دسترسی به پرونده‌های ارسال مجاز نیست." />}
    {stale && <ErpInlineState kind="stale" title="نمای زنده در دسترس نیست؛ آخرین نمای موفق و انتخاب فعلی بدون تغییر نگه داشته شده است." />}
    {loading && !visibleCases.length ? <ErpLoading /> : visibleCases.length ? <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {visibleCases.map((item) => <ErpCard key={item.id} className="min-w-0 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><strong className="block truncate">{dispatchDriverName(item.driverName)}</strong><span className="text-xs sds-text-secondary">{dispatchCaseReference(item.loadingNumber)}</span></div><ErpBadge tone={item.status === 'EXIT_RECORDED' ? 'success' : 'info'}>{dispatchStatusLabel(item.status)}</ErpBadge></div><div className="mt-3"><ErpButton label="مشاهده مراحل ارسال" variant="ghost" onClick={() => setSelected(item.id)} /></div></ErpCard>)}
    </div> : !denied && <ErpEmptyState title="پرونده ارسالی در این دامنه وجود ندارد" />}
    <ErpSheet open={authorized && Boolean(selected)} onClose={() => { save({ selected, timeline, selectedEventId }); setSelected(null); setTimeline(null); setSelectedEventId(null); setTechnicalDetailsVisible(false); }} title="مراحل ارسال">
      {!timeline ? <ErpLoading /> : <div className="space-y-4" dir="rtl">
        <ErpInlineState kind="success" title={dispatchActionLabel(timeline.currentAction)} />
        {timeline.recovery && <ErpInlineState kind="stale" title={dispatchRecoveryLabel(timeline.recovery)} />}
        {selectedEvent && <ErpCard className="p-4"><div className="flex flex-wrap justify-between gap-2"><div><strong>جزئیات مرحله</strong><p className="mt-1 text-sm sds-text-muted">{dispatchStationLabel(selectedEvent.station)}</p></div><ErpButton label="بستن جزئیات" variant="ghost" onClick={() => { setSelectedEventId(null); setTechnicalDetailsVisible(false); }} /></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="sds-text-secondary">رویداد</dt><dd className="mt-1 font-medium sds-text-primary">{dispatchEventLabel(selectedEvent.eventType)}</dd></div><div><dt className="sds-text-secondary">زمان</dt><dd className="mt-1 font-medium sds-text-primary">{new Date(selectedEvent.occurredAt).toLocaleString('fa-IR')}</dd></div>{selectedEvidence.summary.map((field) => <div key={field.label}><dt className="sds-text-secondary">{field.label}</dt><dd className="mt-1 font-medium sds-text-primary">{field.value}</dd></div>)}</dl>{selectedEvidence.technical.length > 0 && <div className="mt-4 border-t border-[var(--sds-border-subtle)] pt-3"><ErpButton label={technicalDetailsVisible ? 'پنهان‌کردن اطلاعات تخصصی' : 'نمایش اطلاعات تخصصی سامانه'} variant="ghost" onClick={() => setTechnicalDetailsVisible((value) => !value)} />{technicalDetailsVisible && <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">{selectedEvidence.technical.map((field) => <div key={field.label} className="min-w-0"><dt className="sds-text-secondary">{field.label}</dt><dd className="mt-1 break-all font-mono sds-text-primary" dir="ltr">{field.value}</dd></div>)}</dl>}</div>}</ErpCard>}
        <ol className="space-y-3" aria-label="مراحل پرونده ارسال">{timeline.events.map((event: any) => <li key={event.id}><ErpCard className="p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{dispatchEventLabel(event.eventType)}</strong><ErpBadge tone="neutral">{dispatchStationLabel(event.station)}</ErpBadge></div><time className="mt-2 block text-xs sds-text-secondary">{new Date(event.occurredAt).toLocaleString('fa-IR')}</time><div className="mt-2"><ErpButton label="مشاهده جزئیات این مرحله" variant="ghost" onClick={() => { setTechnicalDetailsVisible(false); setSelectedEventId(event.id); save({ selected, timeline, selectedEventId: event.id }); }} /></div></ErpCard></li>)}</ol>
      </div>}
    </ErpSheet>
  </ErpSection>;
}
