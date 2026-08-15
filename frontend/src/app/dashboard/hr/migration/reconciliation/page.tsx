'use client';
import { ErpInlineState } from "@/components/erp";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FaClipboardCheck, FaExclamationTriangle } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpSelect, ErpSheet, ErpTextarea } from '@/components/erp';
import { apiError } from '@/features/hr/hrUi';
import {
  allowedReviewOutcomes,
  migrationAttentionFlagLabel,
  migrationPrimaryStateLabel,
  migrationSourceTypeLabel,
  safeMigrationReturnPath,
} from '@/features/hr/hrMigrationReconciliationViewModel';
import { hrAPI } from '@/lib/api';

type ReconciliationRecord = {
  id: string;
  sourceType: string;
  sourceId: string;
  primaryState: string;
  stateVersion: number;
  attentionFlags: string[];
  cutoverBlocker: boolean;
  classifiedAt: string;
  latestReview: { outcome: string; reason: string; reviewedAt: string } | null;
  technicalEvidence: { unexpectedPrimaryState: string | null; unexpectedFlags: string[] } | null;
};

type WorkspaceResponse = {
  matchingCount: number;
  records: ReconciliationRecord[];
};

export default function HrMigrationReconciliationPage() {
  const searchParams = useSearchParams();
  const filters = useMemo(() => ({
    primaryState: searchParams.get('primaryState') || undefined,
    attentionFlag: searchParams.get('attentionFlag') || undefined,
    sourceType: searchParams.get('sourceType') || undefined,
    cutoverBlocker: searchParams.has('cutoverBlocker') ? searchParams.get('cutoverBlocker') === 'true' : undefined,
  }), [searchParams]);
  const backHref = safeMigrationReturnPath(searchParams.get('return'));
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ReconciliationRecord | null>(null);
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await hrAPI.getMigrationReconciliation(filters);
      setData(response.data.data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  const openReview = (record: ReconciliationRecord) => {
    const options = allowedReviewOutcomes(record.attentionFlags, record.primaryState);
    setSelected(record);
    setOutcome(options[0]?.value || '');
    setReason('');
  };

  const submitReview = async () => {
    if (!selected || !outcome || !reason.trim()) return;
    try {
      setPending(true);
      setError('');
      await hrAPI.reviewMigrationReconciliation(selected.id, { outcome, reason: reason.trim() });
      setSelected(null);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setPending(false);
    }
  };

  if (loading && !data) return <ErpLoading />;
  const title = filters.primaryState
    ? migrationPrimaryStateLabel(filters.primaryState)
    : filters.attentionFlag
      ? migrationAttentionFlagLabel(filters.attentionFlag)
      : filters.cutoverBlocker === true
        ? 'مسدودکننده‌های Cutover'
        : filters.cutoverBlocker === false
          ? 'ردیف‌های بدون مانع'
          : 'همه ردیف‌های تطبیق';
  const reviewOptions = selected ? allowedReviewOutcomes(selected.attentionFlags, selected.primaryState) : [];

  return (
    <ErpPage
      eyebrow="منابع انسانی · تطبیق داده"
      title={title}
      description="این جمعیت دقیقاً با فیلتر انتخاب‌شده از خلاصه Cutover تطبیق دارد."
      backHref={backHref}
      metrics={[{ label: 'تعداد دقیق', value: Number(data?.matchingCount || 0).toLocaleString('fa-IR'), icon: FaClipboardCheck, tone: filters.cutoverBlocker ? 'warning' : 'info' }]}
    >
      {error && <ErpInlineState kind="error" title={error} />}
      <div className="space-y-3">
        {data?.records.map((record) => {
          const actions = allowedReviewOutcomes(record.attentionFlags, record.primaryState);
          return (
            <ErpCard key={record.id} tone={record.cutoverBlocker ? 'warning' : 'neutral'} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[var(--sds-text-secondary)]">{migrationSourceTypeLabel(record.sourceType)}</p>
                  <h2 className="mt-1 break-all font-black" dir="ltr">{record.sourceId}</h2>
                </div>
                <ErpBadge tone={record.primaryState === 'CLASSIFICATION_ERROR' ? 'danger' : record.cutoverBlocker ? 'warning' : 'success'}>
                  {migrationPrimaryStateLabel(record.primaryState)}
                </ErpBadge>
              </div>

              {!!record.attentionFlags.length && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {record.attentionFlags.map((flag) => <ErpBadge key={flag} tone="warning">{migrationAttentionFlagLabel(flag)}</ErpBadge>)}
                </div>
              )}

              {record.technicalEvidence && (
                <div className="mt-4 rounded-[var(--sds-radius-control)] border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] p-3 text-sm text-[var(--sds-danger)]">
                  <p className="flex items-center gap-2 font-bold"><FaExclamationTriangle aria-hidden />شاهد فنی طبقه‌بندی</p>
                  {record.technicalEvidence.unexpectedPrimaryState && <p className="mt-2" dir="ltr">state: {record.technicalEvidence.unexpectedPrimaryState}</p>}
                  {!!record.technicalEvidence.unexpectedFlags.length && <p className="mt-1" dir="ltr">flags: {record.technicalEvidence.unexpectedFlags.join(', ')}</p>}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--sds-border-subtle)] pt-4">
                <p className="text-xs text-[var(--sds-text-secondary)]">نسخه {record.stateVersion.toLocaleString('fa-IR')} · {new Date(record.classifiedAt).toLocaleString('fa-IR')}</p>
                {actions.length > 0 && <ErpButton label="ثبت نتیجه بازبینی" icon={FaClipboardCheck} tone="primary" onClick={() => openReview(record)} />}
              </div>
              {record.latestReview && <p className="mt-3 text-xs text-[var(--sds-text-secondary)]">آخرین بازبینی: {record.latestReview.reason}</p>}
            </ErpCard>
          );
        })}
        {!data?.records.length && <ErpEmptyState title="ردیفی با این فیلتر وجود ندارد" description="به خلاصه Cutover برگردید و فیلتر دیگری را انتخاب کنید." />}
      </div>

      <ErpSheet open={Boolean(selected)} onClose={() => { if (!pending) setSelected(null); }} title="ثبت نتیجه بازبینی" presentation="modal" dismissible={!pending}>
        <ErpSection title={selected ? `${migrationSourceTypeLabel(selected.sourceType)} · ${selected.sourceId}` : ''} description="فقط نتیجه‌ای را ثبت کنید که با شاهد واقعی تأیید شده است؛ این فرم هویت، تاریخ یا نگاشت تازه‌ای نمی‌سازد.">
          <label className="block text-sm font-bold" htmlFor="reconciliation-outcome">نتیجه</label>
          <ErpSelect id="reconciliation-outcome" className="mt-2" value={outcome} onChange={(event) => setOutcome(event.target.value)} disabled={pending}>
            {reviewOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </ErpSelect>
          <label className="mt-4 block text-sm font-bold" htmlFor="reconciliation-reason">دلیل و شاهد</label>
          <ErpTextarea id="reconciliation-reason" className="mt-2" value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending} required />
          <div className="mt-5 flex flex-wrap gap-3">
            <ErpButton label="ثبت بازبینی" tone="primary" disabled={pending || !outcome || !reason.trim()} onClick={submitReview} />
            <ErpButton label="انصراف" tone="neutral" disabled={pending} onClick={() => setSelected(null)} />
          </div>
        </ErpSection>
      </ErpSheet>
    </ErpPage>
  );
}
