'use client';
import { ErpInlineState } from "@/components/erp";

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FaCheckCircle, FaExclamationTriangle, FaPlay, FaSync } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpLoading, ErpPage, ErpSection, ErpSheet } from '@/components/erp';
import { apiError } from '@/features/hr/hrUi';
import {
  migrationAttentionFlagLabel,
  migrationPrimaryStateLabel,
  reconciliationFilterHref,
} from '@/features/hr/hrMigrationReconciliationViewModel';
import { hrAPI } from '@/lib/api';

type Summary = {
  total: number;
  blockers: number;
  clearForCutover: number;
  byPrimaryState: Record<string, number>;
  byAttentionFlag: Record<string, number>;
  canCutOver: boolean;
};

type BackfillReport = {
  totals: { safeBackfills: number; actionableConflicts: number; neutralLegacyOutcomes: number; blockingFailures: number };
  canCutOver: boolean;
};

export default function HrMigrationPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dryRun, setDryRun] = useState<BackfillReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [workspace, preview] = await Promise.all([
        hrAPI.getMigrationReconciliation(),
        hrAPI.previewHrRedesignBackfill(),
      ]);
      setSummary(workspace.data.data.summary);
      setDryRun(preview.data.data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const apply = async () => {
    try {
      setPending(true);
      setError('');
      setSuccess('');
      await hrAPI.applyHrRedesignBackfill();
      setSuccess('تطبیق کنترل‌شده و قابل‌تکرار اجرا شد. نتیجه تازه در همین صفحه نمایش داده می‌شود.');
      setConfirmOpen(false);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setPending(false);
    }
  };

  if (loading && !summary) return <ErpLoading />;
  const returnPath = '/dashboard/hr/migration?focus=cutover';
  const canCutOver = Boolean(summary?.canCutOver && dryRun?.canCutOver);
  const reconciliationBlockers = Number(summary?.blockers || 0);
  const previewBlockers = Number(dryRun?.totals.actionableConflicts || 0) + Number(dryRun?.totals.blockingFailures || 0);

  return (
    <ErpPage
      eyebrow="منابع انسانی · تطبیق داده"
      title="آمادگی Cutover منابع انسانی"
      description="هر ردیف یک وضعیت اصلی صادقانه و پرچم‌های مستقل دارد؛ فقط پرچم‌های باز مرز Cutover را می‌بندند."
      backHref="/dashboard/hr"
      actions={[
        { label: 'اجرای دوباره پیش‌نمایش', icon: FaSync, onClick: load, tone: 'neutral' },
        { label: 'اجرای تطبیق کنترل‌شده', icon: FaPlay, onClick: () => setConfirmOpen(true), tone: 'success' },
      ]}
    >
      {error && <ErpInlineState kind="error" title={error} />}
      {success && <ErpInlineState kind="success" title={success} />}

      <ErpCard tone={canCutOver ? 'success' : 'warning'} className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-[var(--sds-text-secondary)]">مرز Cutover</p>
            <h2 className="mt-1 text-xl font-black">
              {canCutOver ? 'آماده عبور' : `${(reconciliationBlockers + previewBlockers).toLocaleString('fa-IR')} مانع Cutover`}
            </h2>
          </div>
          {canCutOver
            ? <FaCheckCircle aria-hidden className="text-2xl text-[var(--sds-success)]" />
            : <FaExclamationTriangle aria-hidden className="text-2xl text-[var(--sds-warning)]" />}
        </div>
      </ErpCard>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricLink label="همه ردیف‌ها" value={summary?.total || 0} href={reconciliationFilterHref({}, returnPath)} />
        <MetricLink label="مسدودکننده Cutover" value={summary?.blockers || 0} href={reconciliationFilterHref({ cutoverBlocker: true }, returnPath)} tone="warning" />
        <MetricLink label="بدون مانع" value={summary?.clearForCutover || 0} href={reconciliationFilterHref({ cutoverBlocker: false }, returnPath)} tone="success" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ErpSection title="وضعیت‌های اصلی" description="جمع این وضعیت‌ها دقیقاً با کل ردیف‌ها برابر است.">
          <div className="space-y-2">
            {Object.entries(summary?.byPrimaryState || {}).map(([code, count]) => (
              <FilterRow key={code} label={migrationPrimaryStateLabel(code)} count={count} href={reconciliationFilterHref({ primaryState: code }, returnPath)} danger={code === 'CLASSIFICATION_ERROR'} />
            ))}
          </div>
        </ErpSection>
        <ErpSection title="پرچم‌های نیازمند اقدام" description="هر پرچم جمعیت دقیق و اقدام مستقل خود را دارد.">
          <div className="space-y-2">
            {Object.entries(summary?.byAttentionFlag || {}).map(([code, count]) => (
              <FilterRow key={code} label={migrationAttentionFlagLabel(code)} count={count} href={reconciliationFilterHref({ attentionFlag: code }, returnPath)} danger />
            ))}
            {!Object.keys(summary?.byAttentionFlag || {}).length && <p className="py-5 text-center text-sm text-[var(--sds-text-secondary)]">پرچم بازی وجود ندارد.</p>}
          </div>
        </ErpSection>
      </div>

      {dryRun && (
        <ErpSection title="آخرین پیش‌نمایش قابل‌تکرار">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PreviewMetric label="تغییر امن" value={dryRun.totals.safeBackfills} />
            <PreviewMetric label="تعارض عملیاتی" value={dryRun.totals.actionableConflicts} />
            <PreviewMetric label="نتیجه خنثی" value={dryRun.totals.neutralLegacyOutcomes} />
            <PreviewMetric label="شکست فنی" value={dryRun.totals.blockingFailures} />
          </div>
        </ErpSection>
      )}

      <ErpSheet open={confirmOpen} onClose={() => { if (!pending) setConfirmOpen(false); }} title="اجرای تطبیق کنترل‌شده" presentation="modal" dismissible={!pending}>
        <ErpCard className="p-5">
          <p className="text-sm leading-7 text-[var(--sds-text-secondary)]">این اجرا قابل‌تکرار است، واقعیت تاریخی تازه‌ای نمی‌سازد و تصمیم‌های ثبت‌شده بازبین را حفظ می‌کند. ردیف دارای ابهام هویتی از عملیات خودکار خودش کنار گذاشته می‌شود و اجرای سایر ردیف‌ها ادامه دارد.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ErpButton label="اجرا" icon={FaPlay} tone="success" disabled={pending} onClick={apply} />
            <ErpButton label="انصراف" tone="neutral" disabled={pending} onClick={() => setConfirmOpen(false)} />
          </div>
        </ErpCard>
      </ErpSheet>
    </ErpPage>
  );
}

function MetricLink({ label, value, href, tone = 'neutral' }: { label: string; value: number; href: string; tone?: 'neutral' | 'success' | 'warning' }) {
  return <Link href={href} className="group rounded-[var(--sds-radius-card)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]"><ErpCard tone={tone} interactive className="h-full p-4"><p className="text-sm text-[var(--sds-text-secondary)]">{label}</p><p className="mt-2 text-2xl font-black">{value.toLocaleString('fa-IR')}</p></ErpCard></Link>;
}

function FilterRow({ label, count, href, danger = false }: { label: string; count: number; href: string; danger?: boolean }) {
  return <Link href={href} className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--sds-radius-control)] border border-[var(--sds-border-default)] p-3 outline-none hover:bg-[var(--sds-surface-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]"><span className="font-bold">{label}</span><ErpBadge tone={danger ? 'warning' : 'neutral'}>{count.toLocaleString('fa-IR')}</ErpBadge></Link>;
}

function PreviewMetric({ label, value }: { label: string; value: number }) {
  return <ErpCard className="p-3 text-center"><p className="text-xs text-[var(--sds-text-secondary)]">{label}</p><p className="mt-2 text-lg font-black">{value.toLocaleString('fa-IR')}</p></ErpCard>;
}
