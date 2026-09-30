'use client';

import { useEffect, useState } from 'react';
import { accountingAPI } from '@/lib/api';
import { ErpButton, ErpCard, ErpField, ErpInlineState, ErpInput, ErpSearchableSelect, ErpSection } from '@/components/erp';

type Difference = { code: string; sourceKey: string | null; targetId: string | null; message: string; identity?: string;
  sourceDebitRials?: string | null; targetDebitRials?: string | null; amountRials?: string | null; itemCount?: number };
type DifferenceCase = { id: string; sourceId: string; status: string; assignedUserId: string | null; ownerName?: string;
  resolutionEvidence: { comparisonId: string; snapshotId: string; difference: Difference; cause?: string; resolution?: string } };
type Report = { id?: string; exact: boolean; acceptedPeriod: false; sourceCount: number; targetCount: number;
  sourceDebitRials: string; targetDebitRials: string; outputHash: string; snapshotId: string;
  differences: Difference[] };

export default function AccountingParallelComparison({ bookId, snapshots }: { bookId: string; snapshots: Array<{ id: string; status: string; completedAt: string }> }) {
  const [context, setContext] = useState<{ periods: Array<{ id: string; title: string }>; targets: Array<{ id: string; referenceNumber: string; description: string }> }>({ periods: [], targets: [] });
  const [periodId, setPeriodId] = useState(''); const [snapshotId, setSnapshotId] = useState('');
  const [sourceKey, setSourceKey] = useState(''); const [targetId, setTargetId] = useState(''); const [reason, setReason] = useState('');
  const [report, setReport] = useState<Report>(); const [pending, setPending] = useState(false);
  const [differencePage, setDifferencePage] = useState(0);
  const [cases, setCases] = useState<DifferenceCase[]>([]);
  const [selected, setSelected] = useState<{ comparisonId: string; difference: Difference }>();
  const [cause, setCause] = useState(''); const [resolution, setResolution] = useState(''); const [caseMessage, setCaseMessage] = useState('');
  const [error, setError] = useState(''); const [authorized, setAuthorized] = useState(true);
  useEffect(() => {
    let active = true;
    if (!bookId) return;
    setTargetId(''); setReport(undefined); setDifferencePage(0); setSelected(undefined); setCases([]); setCaseMessage('');
    accountingAPI.getAccountingParallelContext(bookId, periodId || undefined).then((response) => {
      if (!active) return;
      setContext(response.data.data); setCases((response.data.data.cases ?? []).filter((item: DifferenceCase) => item.resolutionEvidence.snapshotId === snapshotId)); setError(''); setAuthorized(true);
      const latest = response.data.data.reports?.find((item: { controlPayload: Report }) => item.controlPayload.snapshotId === snapshotId); if (latest) setReport({ ...latest.controlPayload, id: latest.id });
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
  const selectedCase = selected ? cases.find((item) => item.sourceId === `${selected.comparisonId}:${selected.difference.identity}`) : undefined;
  const selectDifference = (comparisonId: string, difference: Difference, existing?: DifferenceCase) => {
    setSelected({ comparisonId, difference }); setCause(existing?.resolutionEvidence.cause ?? ''); setResolution(existing?.resolutionEvidence.resolution ?? ''); setCaseMessage(''); setError('');
  };
  const manageDifference = async (action: 'OPEN' | 'NOTE' | 'RESOLVE') => {
    if (!selected?.difference.identity) return;
    setPending(true); setError(''); setCaseMessage('');
    try {
      const response = await accountingAPI.manageAccountingParallelDifference({ bookId, comparisonId: selected.comparisonId,
        differenceIdentity: selected.difference.identity, action, cause, resolution });
      const saved = response.data.data;
      setCases((prior) => [...prior.filter((item) => item.id !== saved.id), saved]);
      setCaseMessage(action === 'OPEN' ? (saved.assignedToCaller ? 'رسیدگی به اختلاف به عهدهٔ شما ثبت شده است.' : `این پرونده به عهدهٔ ${saved.ownerName} است.`) : action === 'NOTE' ? 'علت و اقدام ثبت شد؛ اختلاف هنوز باز است.' : 'رفع اختلاف با مقایسهٔ تازهٔ شواهد واقعی ثبت شد.');
    } catch (failure: any) { setError(failure.response?.data?.message || 'رسیدگی به اختلاف ثبت نشد.'); }
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
        {report.differences.slice(differencePage * 50, (differencePage + 1) * 50).map((item, index) => <div key={item.identity ?? index} className="grid gap-2">
          <p>{item.sourceKey ? `سند سپیدار ${item.sourceKey}: ` : ''}{item.targetId ? `سند سبلان ${context.targets.find((target) => target.id === item.targetId)?.referenceNumber ?? 'خارج از فهرست فعلی'}: ` : ''}{item.message}</p>
          {item.identity && report.id && <ErpButton label={`رسیدگی به اختلاف ${item.sourceKey ?? item.targetId ?? 'پوشش دوره'}`} variant="outline" disabled={pending} onClick={() => selectDifference(report.id!, item, cases.find((row) => row.sourceId === `${report.id}:${item.identity}`))} />}
        </div>)}
        {report.differences.length > 50 && <div className="flex flex-wrap items-center gap-2">
          <ErpButton label="اختلاف‌های قبلی" variant="outline" disabled={differencePage === 0} onClick={() => setDifferencePage((page) => page - 1)} />
          <span>صفحهٔ {(differencePage + 1).toLocaleString('fa-IR')} از {Math.ceil(report.differences.length / 50).toLocaleString('fa-IR')}</span>
          <ErpButton label="اختلاف‌های بعدی" variant="outline" disabled={(differencePage + 1) * 50 >= report.differences.length} onClick={() => setDifferencePage((page) => page + 1)} />
        </div>}
      </div>}
      {cases.length > 0 && <div className="mt-3 grid gap-2">
        <ErpField label="پرونده‌های رسیدگی"><ErpSearchableSelect value={selectedCase?.id ?? ''} disabled={pending} onChange={(event) => {
          const existing = cases.find((item) => item.id === event.target.value);
          if (existing) selectDifference(existing.resolutionEvidence.comparisonId, existing.resolutionEvidence.difference, existing);
        }}><option value="">انتخاب پرونده</option>{cases.map((item) => <option key={item.id} value={item.id}>{item.resolutionEvidence.difference.message} · {item.resolutionEvidence.difference.sourceKey ?? item.resolutionEvidence.difference.targetId ?? 'پوشش دوره'} · {item.status === 'RESOLVED' ? 'رفع‌شده' : 'باز'}</option>)}</ErpSearchableSelect></ErpField>
      </div>}
      {selected && <div className="mt-3"><ErpCard>
        <p>{selected.difference.message}</p>
        <p>خطوط درگیر: {selected.difference.itemCount?.toLocaleString('fa-IR') ?? 'نامشخص'} · اختلاف جمع بدهکار: {selected.difference.amountRials == null ? 'قابل محاسبه نیست' : `${BigInt(selected.difference.amountRials).toLocaleString('fa-IR')} ریال`}</p>
        <p className="sds-text-secondary text-sm">برابری جمع، برابری حساب و هویت طرف‌ها را اثبات نمی‌کند. توضیح، اختلاف واقعی را رفع نمی‌کند.</p>
        {selectedCase && <p>مسئول: {selectedCase.ownerName ?? 'مدیر حسابداری'} · وضعیت پرونده: {selectedCase.status === 'RESOLVED' ? 'رفع‌شده با شاهد اصلاح' : 'در حال رسیدگی'}</p>}
        <div className="mt-3 grid gap-3">
          <ErpField label="علت اختلاف"><ErpInput value={cause} maxLength={2000} disabled={pending || selectedCase?.status === 'RESOLVED'} onChange={(event) => setCause(event.target.value)} /></ErpField>
          <ErpField label="اقدام و شاهد اصلاح"><ErpInput value={resolution} maxLength={2000} disabled={pending || selectedCase?.status === 'RESOLVED'} onChange={(event) => setResolution(event.target.value)} /></ErpField>
          <div className="flex flex-wrap gap-2">
            <ErpButton label="به عهده گرفتن رسیدگی" disabled={pending || Boolean(selectedCase)} onClick={() => manageDifference('OPEN')} />
            <ErpButton label="ثبت علت و اقدام" variant="outline" disabled={pending || !selectedCase || selectedCase.status === 'RESOLVED' || !cause.trim() || !resolution.trim()} onClick={() => manageDifference('NOTE')} />
            <ErpButton label="مقایسهٔ تازه و ثبت رفع اختلاف" variant="outline" disabled={pending || !selectedCase || selectedCase.status === 'RESOLVED' || !cause.trim() || !resolution.trim()} onClick={() => manageDifference('RESOLVE')} />
          </div>
          {caseMessage && <ErpInlineState kind="success" title={caseMessage} />}
          {error && <ErpInlineState kind="error" title={error} />}
        </div>
      </ErpCard></div>}
    </ErpCard>
  </ErpSection>;
}
