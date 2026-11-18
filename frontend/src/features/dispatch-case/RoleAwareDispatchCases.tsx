'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { FaChevronDown, FaChevronUp, FaListAlt } from 'react-icons/fa';
import { ErpListContent, ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpInlineState, ErpLoading, ErpPressable, ErpSection, ErpSheet, type ErpAction, type ErpColumn } from '@/components/erp';
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

type DispatchCaseRow = {
  id: string;
  loadingId?: string | null;
  loadingNumber?: string | null;
  driverName?: string;
  status: string;
};

type Props = { workspace: 'hr' | 'vehicle-operations' | 'security' | 'logistics' | 'accounting'; subjectId?: string; loadingId?: string;
  onStaleChange?: (stale: boolean) => void;
  tableFilter?: (item: DispatchCaseRow) => boolean;
  tableColumns?: ErpColumn<DispatchCaseRow>[];
  tableRowActions?: (item: DispatchCaseRow) => ErpAction[];
};
const labels: Record<string, string> = { hr: 'منابع انسانی', 'vehicle-operations': 'عملیات خودرو', security: 'گارد', logistics: 'لجستیک', accounting: 'حسابداری' };
const statusOf = (error: any) => Number(error?.response?.status || 0);

export default function RoleAwareDispatchCases({ workspace, subjectId, loadingId, onStaleChange, tableFilter, tableColumns, tableRowActions }: Props) {
  const { user, loading: authLoading } = useAuth();
  const storagePrefix = `dispatch-cases:last-success:${user?.id || 'anonymous'}:${workspace}:${subjectId || loadingId || 'all'}`;
  const [cases, setCases] = useState<DispatchCaseRow[]>([]);
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
  const save = useCallback((next: { timeline?: any }) => {
    if (!storageKey) return;
    try {
      const previous = readSaved(storageKey);
      sessionStorage.setItem(storageKey, JSON.stringify({ cases: previous.cases, ...next, savedAt: new Date().toISOString() }));
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
      try {
        sessionStorage.setItem(nextKey, JSON.stringify({ timeline: saved.timeline, cases: next, savedAt: new Date().toISOString() }));
      } catch { /* optional cache */ }
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
    let active = true;
    dispatchCasesAPI.detail(workspace, selected, filters).then((response) => {
      if (!active) return;
      setTimeline(response.data.data); updateStale(false); save({ timeline: response.data.data });
    }).catch((error) => {
      if (!active) return;
      const status = statusOf(error);
      if (status === 401 || status === 403) {
        clearAuthorizedCaches(); setAccessScope(null); setAuthorizedUserId(null); setCases([]); setSelected(null); setTimeline(null); setDenied(true); updateStale(false);
      } else if (!status || status >= 500) {
        updateStale(true);
        if (saved.timeline?.case?.id === selected) setTimeline(saved.timeline);
        else setTimeline({ case: { id: selected }, currentAction: 'LAST_SUCCESS_UNAVAILABLE', recovery: 'RETRY_WHEN_ONLINE', events: [] });
      } else { setSelected(null); setTimeline(null); }
    });
    return () => { active = false; };
  }, [clearAuthorizedCaches, filters, readSaved, save, selected, storageKey, updateStale, workspace]);
  const detailId = useId();
  const revealDetail = useCallback((panel: HTMLDivElement | null) => {
    panel?.scrollIntoView({ block: 'nearest' });
  }, []);
  const selectedEvent = timeline?.events?.find((event: any) => event.id === selectedEventId) || null;
  const selectedEvidence = evidenceDetailPresentation(selectedEvent?.detail || {});
  const authorized = Boolean(user && authorizedUserId === user.id && accessScope);
  const visibleCases = authorized ? cases : [];

  return <ErpSection title={`پرونده‌های ارسال · ${labels[workspace]}`} description="نمای زمانی مشترک فقط‌خواندنی است؛ هر فرمان عملیاتی در فضای کاری مالک خود باقی می‌ماند."
    actions={[{ label: 'تازه‌سازی', onClick: () => void load(), variant: 'outline', disabled: loading }]}>
    {denied && <ErpInlineState kind="error" title="دسترسی به پرونده‌های ارسال مجاز نیست." />}
    {stale && <ErpInlineState kind="stale" title="نمای زنده در دسترس نیست؛ آخرین نمای موفق و انتخاب فعلی بدون تغییر نگه داشته شده است." />}
    {tableFilter ? <ErpListContent
      rows={visibleCases.filter(tableFilter)}
      rowKey={item => item.id}
      mobileLayout="table"
      columns={[
        { id: 'loading', header: 'بارگیری', cell: item => dispatchCaseReference(item.loadingNumber) },
        ...(tableColumns ?? []),
        { id: 'driver', header: 'راننده', cell: item => dispatchDriverName(item.driverName) },
        { id: 'status', header: 'وضعیت', cell: item => <ErpBadge tone={item.status === 'EXIT_RECORDED' ? 'success' : 'info'}>{dispatchStatusLabel(item.status)}</ErpBadge> },
      ]}
      rowActions={item => [
        { label: 'مشاهده مراحل ارسال', icon: FaListAlt, onClick: () => setSelected(item.id) },
        ...(tableRowActions?.(item) ?? []),
      ]}
      isLoading={loading && !visibleCases.length}
      emptyState={!denied && <ErpEmptyState title={visibleCases.length ? 'پرونده‌ای مطابق جست‌وجو پیدا نشد' : 'پرونده ارسالی در این دامنه وجود ندارد'} />}
    /> : loading && !visibleCases.length ? <ErpLoading /> : visibleCases.length ? <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {visibleCases.map((item) => <ErpCard key={item.id} className="min-w-0 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><strong className="block truncate">{dispatchDriverName(item.driverName)}</strong><span className="text-xs sds-text-secondary">{dispatchCaseReference(item.loadingNumber)}</span></div><ErpBadge tone={item.status === 'EXIT_RECORDED' ? 'success' : 'info'}>{dispatchStatusLabel(item.status)}</ErpBadge></div><div className="mt-3"><ErpButton label="مشاهده مراحل ارسال" variant="ghost" onClick={() => setSelected(item.id)} /></div></ErpCard>)}
    </div> : !denied && <ErpEmptyState title="پرونده ارسالی در این دامنه وجود ندارد" />}
    <ErpSheet open={authorized && Boolean(selected)} onClose={() => { setSelected(null); setTimeline(null); setSelectedEventId(null); setTechnicalDetailsVisible(false); }} title="مراحل ارسال" presentation={workspace === "accounting" ? "modal" : "sheet"}>
      {!timeline ? <ErpLoading /> : <div className="space-y-3" dir="rtl">
        <ErpInlineState kind="success" title={dispatchActionLabel(timeline.currentAction)} />
        {timeline.recovery && <ErpInlineState kind="stale" title={dispatchRecoveryLabel(timeline.recovery)} />}
        <ol className="space-y-2" aria-label="مراحل پرونده ارسال">
          {timeline.events.map((event: any, index: number) => {
            const expanded = selectedEvent?.id === event.id;
            return <li key={event.id}>
              <ErpCard>
                <ErpPressable type="button" tone="primary" variant="ghost"
                  className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-start"
                  aria-label={expanded ? 'بستن جزئیات' : 'مشاهده جزئیات این مرحله'}
                  aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
                  onClick={() => { setTechnicalDetailsVisible(false); setSelectedEventId(expanded ? null : event.id); }}>
                  <span className="min-w-0">
                    <strong className="flex items-baseline gap-2 text-sm sds-text-primary">
                      <span className="shrink-0 tabular-nums sds-text-secondary">{(index + 1).toLocaleString('fa-IR', { useGrouping: false })}.</span>
                      <span className="min-w-0 break-words">{dispatchEventLabel(event.eventType, event.detail)}</span>
                    </strong>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <ErpBadge tone="neutral">{dispatchStationLabel(event.station)}</ErpBadge>
                      <time className="text-xs sds-text-secondary">{new Date(event.occurredAt).toLocaleString('fa-IR')}</time>
                    </span>
                  </span>
                  {expanded
                    ? <FaChevronUp aria-hidden="true" className="mx-2 h-4 w-4 shrink-0" />
                    : <FaChevronDown aria-hidden="true" className="mx-2 h-4 w-4 shrink-0" />}
                </ErpPressable>
                {expanded && <div ref={revealDetail} id={detailId} className="mx-3 border-t border-[var(--sds-border-subtle)] py-2">
                  <h3 className="text-sm font-semibold">جزئیات مرحله</h3>
                  {selectedEvidence.summary.length > 0 && <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    {selectedEvidence.summary.map((field) => <div key={field.label} className="min-w-0">
                      <dt className="sds-text-secondary">{field.label}</dt>
                      <dd className="break-words font-medium sds-text-primary">{field.value}</dd>
                    </div>)}
                  </dl>}
                  {!selectedEvidence.summary.length && !selectedEvidence.technical.length &&
                    <p className="mt-1 text-sm sds-text-secondary">جزئیات بیشتری برای این مرحله ثبت نشده است.</p>}
                  {selectedEvidence.technical.length > 0 && <div className="mt-2">
                    <ErpButton label={technicalDetailsVisible ? 'پنهان‌کردن اطلاعات تخصصی' : 'نمایش اطلاعات تخصصی سامانه'} variant="ghost" onClick={() => setTechnicalDetailsVisible((value) => !value)} />
                    {technicalDetailsVisible && <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                      {selectedEvidence.technical.map((field) => <div key={field.label} className="min-w-0">
                        <dt className="sds-text-secondary">{field.label}</dt>
                        <dd className="break-all font-mono sds-text-primary" dir="ltr">{field.value}</dd>
                      </div>)}
                    </dl>}
                  </div>}
                </div>}
              </ErpCard>
            </li>;
          })}
        </ol>
      </div>}
    </ErpSheet>
  </ErpSection>;
}
