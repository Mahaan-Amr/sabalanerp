'use client';

import { useCallback, useEffect, type ReactNode } from 'react';
import { ErpButton, ErpInlineState, ErpSection, ErpSkeleton } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { useAccountingPanelRead } from './useAccountingPanelRead';

export type ReplacementVerificationTiming = { completedAt: string; durationMs: number };

export interface ReplacementException {
  id: string;
  category: string;
  title: string;
  owner: string;
  ageHours: number;
  source: string;
  resolutionHref: string;
}

interface AuditVerification {
  auditVerification: { valid: boolean; failedSequence: string | null };
  exception: ReplacementException | null;
  verificationTiming: ReplacementVerificationTiming;
}

interface SepidarReadiness {
  officialReportsBlocked: boolean;
  sourceCoverage: { missingEarlyDetail: boolean };
  inventory1405: { unvaluedUnlinkedDeliveries: number; negativeStockSummaries: number };
  verificationTiming: ReplacementVerificationTiming;
}

export const readReplacementAudit = async (bookId: string, signal: AbortSignal): Promise<AuditVerification> =>
  (await accountingAPI.verifyReplacementAudit(bookId, signal)).data.data;

export const readReplacementOverview = async (bookId: string, signal: AbortSignal) =>
  (await accountingAPI.getReplacementOverview(bookId, { includeAudit: false, signal })).data.data;

export const readReplacementSnapshots = async (bookId: string, signal: AbortSignal) =>
  (await accountingAPI.getSepidarSourceSnapshots(bookId, signal)).data.data as Array<{
    id: string; status: string; completedAt: string; startedAt: string;
    importedRecordCount: number; expectedRecordCount: number; tableCount: number;
    tables: Array<{ exact_rows: number; table_name: string }>;
  }>;

export function useReplacementRead<T>(key: string, read: (key: string, signal: AbortSignal) => Promise<T>, failureMessage: string, refreshKey?: number) {
  const load = useCallback((signal: AbortSignal) => read(key, signal), [key, read]);
  const { loading: pending, refresh: retry, ...state } = useAccountingPanelRead(key, load, failureMessage, refreshKey);
  return { ...state, pending, retry };
}

export function ReplacementCheckTiming({ completedAt, durationMs }: ReplacementVerificationTiming) {
  return <p className="sds-text-secondary text-sm">
    آخرین نتیجه{' '}<time dateTime={completedAt}>{new Date(completedAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })}</time>
    {' · '}{durationMs.toLocaleString('fa-IR')} میلی‌ثانیه
  </p>;
}

function ReplacementCheckPanel({ title, pending, error, timing, onRetry, children }: {
  title: string; pending: boolean; error?: string; timing?: ReplacementVerificationTiming;
  onRetry: () => void; children?: ReactNode;
}) {
  return <section aria-label={title}>
    <ErpSection title={title}>
      <div className="grid gap-3">
        {pending && <ErpSkeleton lines={1} label="در حال بررسی" />}
        {error && <ErpInlineState kind="error" title={error} />}
        {(pending || error) && timing && <ErpInlineState kind="stale" title="نتیجهٔ آخرین بررسی کامل‌شده" />}
        {children}
        {timing && <ReplacementCheckTiming {...timing} />}
        <div><ErpButton label="بررسی دوباره" variant="outline" disabled={pending} onClick={onRetry} /></div>
      </div>
    </ErpSection>
  </section>;
}

export function ReplacementAuditCheck({ check }: { check: ReturnType<typeof useReplacementRead<AuditVerification>> }) {
  const audit = check.data?.auditVerification;
  return <ReplacementCheckPanel title="بررسی زنجیره ممیزی جایگزینی" pending={check.pending} error={check.error}
    timing={check.data?.verificationTiming} onRetry={check.retry}>
    {audit && <ErpInlineState kind={audit.valid ? 'success' : 'error'} title={audit.valid ? 'زنجیره ممیزی معتبر است.' : 'زنجیره ممیزی آسیب دیده یا ناقص است.'} />}
  </ReplacementCheckPanel>;
}

export function SepidarReadinessCheck({ bookId, snapshotId, refresh, onDenied }: {
  bookId: string; snapshotId: string; refresh: number; onDenied: (status: number) => void;
}) {
  const read = useCallback(async (id: string, signal: AbortSignal): Promise<SepidarReadiness> =>
    (await accountingAPI.getSepidarSourceReadiness(bookId, id, signal)).data.data, [bookId]);
  const check = useReplacementRead(snapshotId, read, 'بررسی آمادگی منبع سپیدار انجام نشد.', refresh);
  const { retry, status } = check;
  useEffect(() => { if (status === 401 || status === 403) onDenied(status); }, [status, onDenied]);
  const data = check.data;
  return <ReplacementCheckPanel title="آمادگی منبع سپیدار" pending={check.pending} error={check.error}
    timing={data?.verificationTiming} onRetry={retry}>
    {data && <>
      <ErpInlineState kind={data.officialReportsBlocked ? 'error' : 'success'}
        title={data.officialReportsBlocked ? 'گزارش رسمی مسدود است.' : 'بررسی آمادگی منبع مانعی نشان نداد.'} />
      <p className="sds-text-secondary text-sm">
        {data.sourceCoverage.missingEarlyDetail && 'ریزگردش آغاز ۱۴۰۴ در پشتیبان نیست. '}
        {data.inventory1405.unvaluedUnlinkedDeliveries.toLocaleString('fa-IR')} خروج بدون بها و سند ·{' '}
        {data.inventory1405.negativeStockSummaries.toLocaleString('fa-IR')} خلاصهٔ موجودی منفی در ۱۴۰۵
      </p>
    </>}
  </ReplacementCheckPanel>;
}
