'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FaArchive, FaCheckCircle, FaExclamationTriangle, FaHistory, FaSearch, FaShieldAlt, FaSync } from 'react-icons/fa';
import { accountingAPI } from '@/lib/api';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpMetricGrid, ErpPage, ErpSection, ErpSelect } from '@/components/erp';

const faDate = (value: unknown) => value ? new Date(String(value)).toLocaleString('fa-IR') : '—';
const faAmount = (value: unknown) => Number(value ?? 0).toLocaleString('fa-IR');
const statusFa: Record<string, string> = {
  PREVIEWED: 'پیش‌نمایش‌شده', RECONCILED: 'تطبیق‌شده', PREPARED: 'آماده انتقال', AUTHORITY_TRANSFERRED: 'مرجعیت منتقل‌شده',
  ROLLED_BACK: 'بازیابی‌شده به نقطه امن', PAUSED_FIX_FORWARD: 'متوقف برای اصلاح رو به جلو', BLOCKED: 'متوقف', FAILED: 'ناموفق', RETRY: 'در انتظار تلاش دوباره', OPEN: 'باز',
};

export default function AccountingReplacementPage() {
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; title: string }>();
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveRows, setArchiveRows] = useState<any[]>([]);
  const [bookId, setBookId] = useState('');
  const [sourceSnapshots, setSourceSnapshots] = useState<any[]>([]);
  const [sourceTable, setSourceTable] = useState('ACC.Voucher');
  const [sourcePage, setSourcePage] = useState(0);
  const [sourceRecords, setSourceRecords] = useState<any>();
  const [voucherYear, setVoucherYear] = useState('1405');
  const [voucherPage, setVoucherPage] = useState(0);
  const [sourceVouchers, setSourceVouchers] = useState<any>();
  const [sourceVoucher, setSourceVoucher] = useState<any>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ledger = await accountingAPI.getLedgerContext();
      const id = ledger.data.data?.books?.[0]?.id;
      if (!id) throw new Error('دفتر اصلی حسابداری هنوز ایجاد نشده است.');
      setBookId(id);
      const response = await accountingAPI.getReplacementOverview(id);
      setData(response.data.data);
      try {
        const sources = await accountingAPI.getSepidarSourceSnapshots(id);
        setSourceSnapshots(sources.data.data ?? []);
      } catch (sourceError: any) {
        if (sourceError.response?.status !== 403) throw sourceError;
        setSourceSnapshots([]);
      }
      setMessage(undefined);
    } catch (error: any) {
      setMessage({ kind: 'error', title: error.response?.data?.message || error.message || 'دریافت وضعیت جایگزینی حسابداری انجام نشد.' });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const searchArchive = async () => {
    if (!archiveQuery.trim()) return;
    try {
      const response = await accountingAPI.searchLegacyAccountingArchive(bookId, archiveQuery.trim());
      setArchiveRows(response.data.data ?? []);
    } catch (error: any) { setMessage({ kind: 'error', title: error.response?.data?.message || 'جست‌وجوی بایگانی قدیمی انجام نشد.' }); }
  };
  const browseSource = async (table: string, page: number) => {
    const snapshot = sourceSnapshots.find((item) => item.status === 'COMPLETE');
    if (!snapshot || !bookId) return;
    try {
      const response = await accountingAPI.getSepidarSourceRecords(bookId, snapshot.id, table, page);
      setSourceTable(table);
      setSourcePage(page);
      setSourceRecords(response.data.data);
    } catch (error: any) { setMessage({ kind: 'error', title: error.response?.data?.message || 'نمایش داده‌های منبع انجام نشد.' }); }
  };
  const browseVouchers = async (year: string, page: number) => {
    const snapshot = sourceSnapshots.find((item) => item.status === 'COMPLETE');
    if (!snapshot || !bookId) return;
    try {
      const response = await accountingAPI.getSepidarVouchers(bookId, snapshot.id, year, page);
      setVoucherYear(year);
      setVoucherPage(page);
      setSourceVouchers(response.data.data);
      setSourceVoucher(undefined);
    } catch (error: any) { setMessage({ kind: 'error', title: error.response?.data?.message || 'نمایش اسناد سپیدار انجام نشد.' }); }
  };
  const inspectVoucher = async (voucherKey: string) => {
    const snapshot = sourceSnapshots.find((item) => item.status === 'COMPLETE');
    if (!snapshot || !bookId) return;
    try {
      const response = await accountingAPI.getSepidarVoucher(bookId, snapshot.id, voucherKey);
      setSourceVoucher(response.data.data);
    } catch (error: any) { setMessage({ kind: 'error', title: error.response?.data?.message || 'نمایش ردیف‌های سند انجام نشد.' }); }
  };
  const transferred = data?.cutovers?.find((item: any) => item.authorityTransferredAt);
  const acceptedParallel = (data?.parallelRuns ?? []).filter((item: any) => item.accepted);
  const fullClose = acceptedParallel.some((item: any) => item.fullClose);
  const latestRecovery = data?.recoveryProofs?.[0];
  const categoryCounts = useMemo(() => (data?.exceptions ?? []).reduce((result: Record<string, number>, item: any) => {
    result[item.category] = (result[item.category] ?? 0) + 1; return result;
  }, {}), [data?.exceptions]);

  if (loading && !data) return <ErpPage title="مهاجرت، تطبیق و بازیابی" backHref="/dashboard/accounting"><ErpLoading /></ErpPage>;
  return <ErpPage eyebrow="حسابداری" title="مهاجرت، تطبیق و بازیابی" description="کنترل یکپارچهٔ انتقال از سپیدار، اجرای موازی، مرجعیت نهایی و بازیابی اثبات‌شده." backHref="/dashboard/accounting"
    actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, disabled: loading }]}>
    {message && <ErpInlineState kind={message.kind} title={message.title} />}
    <ErpMetricGrid items={[
      { label: 'اجرای مهاجرت', value: (data?.migrations?.length ?? 0).toLocaleString('fa-IR'), icon: FaHistory, tone: 'info' },
      { label: 'ماه موازی پذیرفته', value: acceptedParallel.length.toLocaleString('fa-IR'), hint: fullClose ? 'دارای بستن کامل' : 'بستن کامل هنوز ثبت نشده', icon: FaCheckCircle, tone: acceptedParallel.length >= 2 && fullClose ? 'success' : 'warning' },
      { label: 'بازیابی اثبات‌شده', value: latestRecovery?.proven ? 'آماده' : 'ناقص', hint: latestRecovery ? `هدف: ${latestRecovery.rpoMinutes} دقیقه / ${latestRecovery.rtoMinutes} دقیقه` : 'مدرکی ثبت نشده', icon: FaShieldAlt, tone: latestRecovery?.proven ? 'success' : 'danger' },
      { label: 'استثنای عملیاتی', value: (data?.exceptions?.length ?? 0).toLocaleString('fa-IR'), icon: FaExclamationTriangle, tone: data?.exceptions?.length ? 'danger' : 'success' },
    ]} />

    <ErpSection title="وضعیت مرجعیت" description="زمان انتقال و اولین ثبت مرجع تغییرپذیر نیستند.">
      <ErpCard>
        {transferred ? <div className="grid gap-3 md:grid-cols-3">
          <div><span className="sds-text-secondary text-sm">سامانه مرجع</span><p className="mt-1 font-semibold">سابالان ERP</p></div>
          <div><span className="sds-text-secondary text-sm">سپیدار</span><p className="mt-1 font-semibold">فقط‌خواندنی</p></div>
          <div><span className="sds-text-secondary text-sm">زمان انتقال</span><p className="mt-1 font-semibold">{faDate(transferred.authorityTransferredAt)}</p></div>
          {transferred.status === 'PAUSED_FIX_FORWARD' && <div className="md:col-span-3"><ErpInlineState kind="error" title="ثبت مرجع آغاز شده است؛ عملیات متوقف و فقط اصلاح رو به جلو مجاز است." /></div>}
        </div> : <ErpInlineState kind="stale" title="مرجعیت هنوز منتقل نشده است؛ هیچ جایگزینی جزئی مجاز نیست." />}
      </ErpCard>
    </ErpSection>

    <ErpSection title="اجراهای مهاجرت و تطبیق">
      {!data?.migrations?.length ? <ErpEmptyState title="اجرای مهاجرتی ثبت نشده است." description="ابتدا بستهٔ هش‌شدهٔ سپیدار و نسخهٔ نگاشت را در مسیر عملیاتی بارگذاری کنید." /> :
        <div className="grid gap-3 lg:grid-cols-2">{data.migrations.map((run: any) => <ErpCard key={run.id}>
          <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{run.sourceSystem} · نگاشت نسخهٔ {Number(run.mappingVersion).toLocaleString('fa-IR')}</p><p className="sds-text-secondary mt-1 text-sm">{faDate(run.previewedAt)}</p></div><ErpBadge tone={run.status === 'RECONCILED' ? 'success' : 'warning'}>{statusFa[run.status] ?? run.status}</ErpBadge></div>
          <div className="sds-text-secondary mt-3 grid grid-cols-3 gap-2 text-sm"><span>ورودی: {run.inputCount.toLocaleString('fa-IR')}</span><span>پذیرفته: {run.acceptedCount.toLocaleString('fa-IR')}</span><span>ردشده: {run.rejectedCount.toLocaleString('fa-IR')}</span></div>
        </ErpCard>)}</div>}
    </ErpSection>

    <ErpSection title="پشتیبان کامل سپیدار" description="نسخهٔ اصلی فقط‌خواندنی است. رکوردهای این بخش سند حسابداری سابالان نیستند و در گزارش‌های عملیاتی جمع نمی‌شوند.">
      {!sourceSnapshots.length ? <ErpEmptyState title="نسخهٔ پشتیبان وارد نشده است." /> : sourceSnapshots.map((snapshot: any) => <ErpCard key={snapshot.id} className="mb-3">
        <div className="flex flex-wrap items-center gap-2"><strong>{snapshot.sourceDatabase}</strong><ErpBadge tone={snapshot.status === 'COMPLETE' ? 'success' : 'warning'}>{snapshot.status === 'COMPLETE' ? 'ورود کامل' : 'ورود در جریان'}</ErpBadge></div>
        <p className="sds-text-secondary mt-2 text-sm">{Number(snapshot.importedRecordCount).toLocaleString('fa-IR')} از {Number(snapshot.expectedRecordCount).toLocaleString('fa-IR')} رکورد در {Number(snapshot.tableCount).toLocaleString('fa-IR')} جدول · {faDate(snapshot.completedAt ?? snapshot.startedAt)}</p>
        {snapshot.status === 'COMPLETE' && <div className="mt-4 grid gap-3">
          <ErpField label="جدول سپیدار"><ErpSelect value={sourceTable} onChange={(event) => { setSourceTable(event.target.value); setSourcePage(0); setSourceRecords(undefined); }}>
            {(snapshot.tables ?? []).filter((item: any) => item.exact_rows > 0).map((item: any) => <option key={item.table_name} value={item.table_name}>{item.table_name} · {Number(item.exact_rows).toLocaleString('fa-IR')}</option>)}
          </ErpSelect></ErpField>
          <div><ErpButton label="نمایش رکوردها" onClick={() => void browseSource(sourceTable, 0)} /></div>
          {sourceRecords?.table === sourceTable && <><p className="sds-text-secondary text-sm">{Number(sourceRecords.total).toLocaleString('fa-IR')} رکورد · صفحهٔ {(sourcePage + 1).toLocaleString('fa-IR')}</p>
            <div className="grid gap-2">{sourceRecords.records.map((record: any) => <ErpCard key={record.id}>
              <div className="flex flex-wrap items-center gap-2"><strong>{String(record.payload.Title ?? record.payload.Description ?? record.payload.Number ?? record.payload.Code ?? record.sourceKey)}</strong><ErpBadge tone="neutral">شناسهٔ {record.sourceKey}</ErpBadge></div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">{Object.entries(record.payload).filter(([, value]) => value !== null && value !== '').map(([key, value]) => <div key={key} className="min-w-0"><dt className="sds-text-secondary">{key}</dt><dd className="break-words">{String(value)}</dd></div>)}</dl>
            </ErpCard>)}</div>
            <div className="flex flex-wrap gap-2"><ErpButton label="صفحهٔ قبل" variant="outline" disabled={sourcePage === 0} onClick={() => void browseSource(sourceTable, sourcePage - 1)} /><ErpButton label="صفحهٔ بعد" variant="outline" disabled={(sourcePage + 1) * sourceRecords.pageSize >= sourceRecords.total} onClick={() => void browseSource(sourceTable, sourcePage + 1)} /></div>
          </>}
        </div>}
      </ErpCard>)}
    </ErpSection>

    {sourceSnapshots.some((item) => item.status === 'COMPLETE') && <ErpSection title="اسناد حسابداری سپیدار" description="اسناد و ردیف‌های هر دو سال مالی با شماره، تاریخ، حساب و تفصیل منبع نمایش داده می‌شوند؛ وضعیت عددی سپیدار هنوز تفسیر نشده است.">
      <ErpCard>
        <div className="flex flex-wrap items-end gap-3"><ErpField label="سال مالی"><ErpSelect value={voucherYear} onChange={(event) => { setVoucherYear(event.target.value); setVoucherPage(0); setSourceVouchers(undefined); setSourceVoucher(undefined); }}><option value="1404">۱۴۰۴</option><option value="1405">۱۴۰۵</option></ErpSelect></ErpField><ErpButton label="نمایش اسناد" onClick={() => void browseVouchers(voucherYear, 0)} /></div>
        {sourceVouchers?.year === voucherYear && <div className="mt-4 grid gap-2">
          <p className="sds-text-secondary text-sm">{Number(sourceVouchers.total).toLocaleString('fa-IR')} سند · صفحهٔ {(voucherPage + 1).toLocaleString('fa-IR')}</p>
          {sourceVouchers.vouchers.map((entry: any) => <ErpCard key={entry.sourceKey}>
            <div className="flex flex-wrap items-center justify-between gap-2"><div><strong>سند شمارهٔ {String(entry.payload.Number ?? entry.sourceKey)}</strong><p className="sds-text-secondary mt-1 text-sm">{faDate(entry.payload.Date)} · {String(entry.payload.Description ?? 'بدون شرح')}</p></div><ErpButton label="ردیف‌های سند" variant="outline" onClick={() => void inspectVoucher(entry.sourceKey)} /></div>
          </ErpCard>)}
          <div className="flex flex-wrap gap-2"><ErpButton label="صفحهٔ قبل" variant="outline" disabled={voucherPage === 0} onClick={() => void browseVouchers(voucherYear, voucherPage - 1)} /><ErpButton label="صفحهٔ بعد" variant="outline" disabled={(voucherPage + 1) * sourceVouchers.pageSize >= sourceVouchers.total} onClick={() => void browseVouchers(voucherYear, voucherPage + 1)} /></div>
        </div>}
        {sourceVoucher && <div className="mt-6 grid gap-2"><h3 className="font-semibold">ردیف‌های سند شمارهٔ {String(sourceVoucher.voucher.payload.Number ?? sourceVoucher.voucher.sourceKey)}</h3>
          {sourceVoucher.lines.map((line: any) => <ErpCard key={line.sourceKey}><div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><span>ردیف {Number(line.RowNumber).toLocaleString('fa-IR')}</span><span>حساب: {String(line.accountCode ?? '—')} · {String(line.accountTitle ?? 'نامشخص')}</span><span>تفصیل: {String(line.detailCode ?? '—')} · {String(line.detailTitle ?? '—')}</span><span>بدهکار: {faAmount(line.Debit)} · بستانکار: {faAmount(line.Credit)} ریال</span></div>{line.Description && <p className="sds-text-secondary mt-2 text-sm">{String(line.Description)}</p>}</ErpCard>)}
        </div>}
      </ErpCard>
    </ErpSection>}

    <ErpSection title="مرکز استثنا" description="خطاهای ثبت، نگاشت، مالیات، بانک، چک، بستن دوره، مهاجرت، ممیزی، پشتیبان، صف و اتصال با مالک و مسیر اقدام.">
      {Object.keys(categoryCounts).length > 0 && <div className="mb-3 flex flex-wrap gap-2">{Object.entries(categoryCounts).map(([category, count]) => <ErpBadge key={category} tone="danger">{category}: {Number(count).toLocaleString('fa-IR')}</ErpBadge>)}</div>}
      {!data?.exceptions?.length ? <ErpEmptyState title="استثنای بازی وجود ندارد." /> : <div className="grid gap-3">{data.exceptions.map((item: any) => <ErpCard key={`${item.category}-${item.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ErpBadge tone="danger">{item.category}</ErpBadge><strong>{item.title}</strong></div><p className="sds-text-secondary mt-2 text-sm">مالک: {item.owner} · عمر: {Number(item.ageHours).toLocaleString('fa-IR')} ساعت · منبع: {item.source}</p></div><ErpButton label="رسیدگی" href={item.resolutionHref} variant="outline" tone="danger" /></div>
      </ErpCard>)}</div>}
    </ErpSection>

    <ErpSection title="بایگانی فقط‌خواندنی سپیدار" description="سوابق قدیمی قابل جست‌وجو هستند و هرگز به‌صورت سند جدید سابالان نمایش داده نمی‌شوند.">
      <div className="flex flex-col gap-2 sm:flex-row"><label className="block flex-1"><span className="sds-text-secondary mb-2 block text-sm">عبارت جست‌وجو</span><ErpInput value={archiveQuery} onChange={(event) => setArchiveQuery(event.target.value)} placeholder="شماره سند، شرح یا شناسه منبع" /></label><div className="self-end"><ErpButton label="جست‌وجو" icon={FaSearch} onClick={searchArchive} disabled={!archiveQuery.trim()} /></div></div>
      {archiveRows.length > 0 && <div className="mt-4 grid gap-3">{archiveRows.map((item) => <ErpCard key={item.id}><div className="flex items-center gap-2"><FaArchive className="sds-text-secondary" /><strong>{item.sourceId}</strong><ErpBadge tone="neutral">فقط‌خواندنی</ErpBadge></div><p className="sds-text-secondary mt-2 break-all text-xs">اثر انگشت: {item.sourceHash}</p></ErpCard>)}</div>}
    </ErpSection>
  </ErpPage>;
}
