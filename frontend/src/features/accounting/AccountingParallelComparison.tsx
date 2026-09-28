'use client';

import { useEffect, useState } from 'react';
import { accountingAPI } from '@/lib/api';
import { ErpButton, ErpCard, ErpField, ErpInlineState, ErpInput, ErpSearchableSelect, ErpSection } from '@/components/erp';

type Report = { id?: string; exact: boolean; acceptedPeriod: false; sourceCount: number; targetCount: number;
  sourceDebitRials: string; targetDebitRials: string; outputHash: string; snapshotId: string;
  differences: Array<{ code: string; sourceKey: string | null; targetId: string | null; message: string }> };

export default function AccountingParallelComparison({ bookId, snapshots }: { bookId: string; snapshots: Array<{ id: string; status: string; completedAt: string }> }) {
  const [context, setContext] = useState<{ periods: Array<{ id: string; title: string }>; targets: Array<{ id: string; referenceNumber: string; description: string }> }>({ periods: [], targets: [] });
  const [periodId, setPeriodId] = useState(''); const [snapshotId, setSnapshotId] = useState('');
  const [sourceKey, setSourceKey] = useState(''); const [targetId, setTargetId] = useState(''); const [reason, setReason] = useState('');
  const [report, setReport] = useState<Report>(); const [pending, setPending] = useState(false);
  const [differencePage, setDifferencePage] = useState(0);
  const [error, setError] = useState(''); const [authorized, setAuthorized] = useState(true);
  useEffect(() => {
    let active = true;
    if (!bookId) return;
    setTargetId(''); setReport(undefined); setDifferencePage(0);
    accountingAPI.getAccountingParallelContext(bookId, periodId || undefined).then((response) => {
      if (!active) return;
      setContext(response.data.data); setError(''); setAuthorized(true);
      const latest = response.data.data.reports?.find((item: { controlPayload: Report }) => item.controlPayload.snapshotId === snapshotId); if (latest) setReport(latest.controlPayload);
    }).catch((failure) => { if (active) { setAuthorized(failure.response?.status !== 403); setError(failure.response?.data?.message || 'دریافت دوره‌ها و اسناد مستقل انجام نشد.'); } });
    return () => { active = false; };
  }, [bookId, periodId, snapshotId]);
  const compare = async (withPair: boolean) => {
    setPending(true); setError('');
    try {
      const response = await accountingAPI.compareAccountingParallelEvents({ bookId, periodId, snapshotId,
        pair: withPair ? { sourceKey, targetId, reason } : undefined });
      setReport(response.data.data); setDifferencePage(0);
    } catch (failure: any) { setError(failure.response?.data?.message || 'مقایسهٔ رویدادهای موازی انجام نشد.'); }
    finally { setPending(false); }
  };
  if (!authorized) return null;
  return <ErpSection title="تطبیق رویدادهای اجرای موازی" description="سند عملیاتی مستقل سبلان را به همان رویداد سپیدار پیوند دهید. نتیجهٔ مقایسه به‌تنهایی پذیرش یک ماه یا بستن کامل دوره نیست.">
    <ErpCard>
      <div className="grid gap-3 md:grid-cols-2">
        <ErpField label="دوره"><ErpSearchableSelect value={periodId} disabled={pending} onChange={(event) => setPeriodId(event.target.value)}><option value="">انتخاب دوره</option>{context.periods.map((period) => <option key={period.id} value={period.id}>{period.title}</option>)}</ErpSearchableSelect></ErpField>
        <ErpField label="نسخهٔ کامل سپیدار"><ErpSearchableSelect value={snapshotId} disabled={pending} onChange={(event) => { setSnapshotId(event.target.value); setReport(undefined); }}><option value="">انتخاب نسخه</option>{snapshots.filter((snapshot) => snapshot.status === 'COMPLETE').map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{new Date(snapshot.completedAt).toLocaleString('fa-IR')}</option>)}</ErpSearchableSelect></ErpField>
        <ErpField label="شناسهٔ سند منبع سپیدار"><ErpInput value={sourceKey} disabled={pending} onChange={(event) => setSourceKey(event.target.value)} /></ErpField>
        <ErpField label="سند عملیاتی مستقل سبلان"><ErpSearchableSelect value={targetId} disabled={pending} onChange={(event) => setTargetId(event.target.value)}><option value="">انتخاب سند قطعی</option>{context.targets.map((target) => <option key={target.id} value={target.id}>{target.referenceNumber} · {target.description}</option>)}</ErpSearchableSelect></ErpField>
        <div className="md:col-span-2"><ErpField label="دلیل پیوند یا اصلاح پیوند"><ErpInput value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} /></ErpField></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ErpButton label={pending ? 'در حال مقایسه…' : 'مقایسهٔ دوره'} disabled={!periodId || !snapshotId || pending} onClick={() => compare(false)} variant="outline" />
        <ErpButton label="ثبت پیوند و مقایسه" disabled={!periodId || !snapshotId || !sourceKey.trim() || !targetId || !reason.trim() || pending} onClick={() => compare(true)} />
      </div>
      {error && <div className="mt-3"><ErpInlineState kind="error" title={error} /></div>}
      {report && <div className="mt-3 grid gap-3">
        <ErpInlineState kind={report.exact ? 'success' : 'stale'} title={report.exact ? 'رویدادهای پیوندشده و پوشش دفتر دقیقاً برابرند؛ پذیرش ماه هنوز انجام نشده است.' : `${report.differences.length.toLocaleString('fa-IR')} اختلاف نیازمند رسیدگی است.`} />
        <p>رویداد سپیدار: {report.sourceCount.toLocaleString('fa-IR')} · سند مستقل سبلان: {report.targetCount.toLocaleString('fa-IR')}</p>
        <p>جمع بدهکار سپیدار: {BigInt(report.sourceDebitRials).toLocaleString('fa-IR')} · سبلان: {BigInt(report.targetDebitRials).toLocaleString('fa-IR')} ریال</p>
        <p className="sds-text-secondary text-sm">اثر انگشت مقایسه: <span dir="ltr" className="break-all">{report.outputHash}</span></p>
        {report.differences.slice(differencePage * 50, (differencePage + 1) * 50).map((item, index) => <p key={index}>{item.sourceKey ? `سند سپیدار ${item.sourceKey}: ` : ''}{item.targetId ? `سند سبلان ${context.targets.find((target) => target.id === item.targetId)?.referenceNumber ?? 'خارج از فهرست فعلی'}: ` : ''}{item.message}</p>)}
        {report.differences.length > 50 && <div className="flex flex-wrap items-center gap-2">
          <ErpButton label="اختلاف‌های قبلی" variant="outline" disabled={differencePage === 0} onClick={() => setDifferencePage((page) => page - 1)} />
          <span>صفحهٔ {(differencePage + 1).toLocaleString('fa-IR')} از {Math.ceil(report.differences.length / 50).toLocaleString('fa-IR')}</span>
          <ErpButton label="اختلاف‌های بعدی" variant="outline" disabled={(differencePage + 1) * 50 >= report.differences.length} onClick={() => setDifferencePage((page) => page + 1)} />
        </div>}
      </div>}
    </ErpCard>
  </ErpSection>;
}
