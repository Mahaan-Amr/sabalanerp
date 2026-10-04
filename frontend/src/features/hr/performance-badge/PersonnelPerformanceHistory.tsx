'use client';

import { useEffect, useState } from 'react';
import { ErpBadge, ErpButton, ErpCard, ErpInlineState, ErpLoading } from '@/components/erp';
import { personnelPerformanceAPI } from '@/lib/api';
import { dateFa, dateTimeFa, apiError } from '@/features/hr/hrUi';
import { PERFORMANCE_BADGE_ROADMAP } from './performanceBadgeModel';
import { FloatingPerformanceStone } from './FloatingPerformanceStone';

type Result = { id: string; status: string; levelCode?: string; score?: string | null; finalizedAt?: string | null; evaluationDate: string; evaluatorNameFa: string; supersededAt?: string | null };
type LegacyResult = { id: string; status: string; levelLabelFa: string; displayScore?: string | null; acceptedAt: string; measurementTo: string };
export function PersonnelPerformanceHistory({ personnelId, allowed, summary = false }: { personnelId: string; allowed: boolean; summary?: boolean }) {
  const [results, setResults] = useState<Result[]>([]);
  const [legacy, setLegacy] = useState<LegacyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => { setPage(1); }, [personnelId]);
  useEffect(() => {
    let active = true;
    if (!allowed) { setResults([]); setLegacy([]); return; }
    setLoading(true); setError('');
    if (page === 1) { setResults([]); setLegacy([]); }
    personnelPerformanceAPI.simpleHistory(personnelId, page).then(({ data }) => {
      if (!active) return;
      setResults(previous => page === 1 ? data.evaluations || [] : [...previous, ...(data.evaluations || [])]);
      setLegacy(previous => page === 1 ? data.legacyEvaluations || [] : [...previous, ...(data.legacyEvaluations || [])]);
      setHasMore(Boolean(data.hasMore || data.legacyHasMore));
    }).catch(cause => { if (active) setError(apiError(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [personnelId, allowed, page]);
  if (!allowed) return <ErpInlineState kind="empty" title="دسترسی به امتیاز و سوابق ارزیابی ندارید." />;
  if (error) return <ErpInlineState kind="error" title={error} />;
  if (loading && page === 1) return <ErpLoading />;
  const final = results.filter(result => result.status === 'FINAL');
  const latest = final.filter(result => !result.supersededAt).sort((a, b) => (b.finalizedAt || '').localeCompare(a.finalizedAt || ''))[0];
  if (summary) return <div className="grid grid-cols-2 gap-3"><ErpCard className="p-4"><p className="text-xs text-[var(--sds-text-secondary)]">امتیاز آخرین نتیجهٔ نهایی ثبت‌شده</p><p className="mt-1 font-bold">{latest?.score ?? '—'}</p></ErpCard><ErpCard className="p-4"><p className="text-xs text-[var(--sds-text-secondary)]">تاریخ نهایی‌شدن نتیجه</p><p className="mt-1 font-bold">{dateTimeFa(latest?.finalizedAt)}</p></ErpCard></div>;
  return <div className="space-y-3"><p className="font-bold">سوابق نتایج نهایی</p>{!final.length && !legacy.length && <ErpInlineState kind="empty" title="نتیجهٔ نهایی ثبت نشده است." />}{final.map(result => {
    const index = PERFORMANCE_BADGE_ROADMAP.findIndex(stage => stage.code === result.levelCode);
    return <ErpCard key={result.id} className="flex items-center gap-3 p-3"><FloatingPerformanceStone index={index} size="list" /><div><p className="font-bold">{index >= 0 ? PERFORMANCE_BADGE_ROADMAP[index].labelFa : 'نتیجهٔ نهایی'}{result.supersededAt && <ErpBadge>اصلاح‌شده</ErpBadge>}</p><p className="mt-1 text-sm">امتیاز: {result.score ?? '—'} · ارزیاب: {result.evaluatorNameFa}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">ارزیابی: {dateFa(result.evaluationDate)} · نهایی‌شده: {dateTimeFa(result.finalizedAt)}</p></div></ErpCard>;
  })}{legacy.map(result => <ErpCard key={result.id} className="space-y-1 p-3"><p className="font-bold">{result.levelLabelFa} <ErpBadge>سابقهٔ پیشین</ErpBadge></p><p className="text-sm">امتیاز: {result.displayScore ?? '—'} · پایان بازه: {dateFa(result.measurementTo)} · تصویب: {dateTimeFa(result.acceptedAt)}</p></ErpCard>)}{hasMore && <ErpButton label="نمایش بیشتر" variant="soft" disabled={loading} onClick={() => setPage(value => value + 1)} />}</div>;
}
