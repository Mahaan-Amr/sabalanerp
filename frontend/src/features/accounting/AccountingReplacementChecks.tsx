'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ErpButton, ErpInlineState, ErpSection, ErpSkeleton } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage } from './accountingUi';

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

export function useReplacementRead<T>(key: string, read: (key: string, signal: AbortSignal) => Promise<T>, failureMessage: string, refresh = 0) {
  const [retryCount, setAttempt] = useState(0);
  const attempt = retryCount + refresh;
  const retry = useCallback(() => setAttempt(previous => previous + 1), []);
  const activeRequest = useRef<AbortController>();
  const [settled, setSettled] = useState<{
    key: string; attempt: number; data?: T; error?: string; status?: number;
  }>();

  useEffect(() => {
    if (!key) return;
    const request = new AbortController();
    activeRequest.current = request;
    void read(key, request.signal).then(data => {
      if (!request.signal.aborted) setSettled({ key, attempt, data });
    }).catch((reason: { response?: { status?: number } }) => {
      if (request.signal.aborted) return;
      const status = reason?.response?.status;
      setSettled(previous => ({
        key, attempt, status, error: accountingFailureMessage(reason,
          reason instanceof Error && /^[\u0600-\u06ff]/.test(reason.message) ? reason.message : failureMessage),
        data: status !== 401 && status !== 403 && previous?.key === key ? previous.data : undefined,
      }));
    });
    return () => request.abort();
  }, [key, attempt, read, failureMessage]);

  const discard = useCallback(() => {
    activeRequest.current?.abort();
    setSettled(undefined);
  }, []);
  const previous = key !== '' && settled?.key === key ? settled : undefined;
  const pending = Boolean(key) && previous?.attempt !== attempt;
  return { data: previous?.data, error: pending ? undefined : previous?.error, status: previous?.status, pending, retry, discard };
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
