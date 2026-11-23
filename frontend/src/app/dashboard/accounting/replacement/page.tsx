'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FaArchive, FaCheckCircle, FaExclamationTriangle, FaHistory, FaSearch, FaShieldAlt, FaSync } from 'react-icons/fa';
import { accountingAPI } from '@/lib/api';
import AccountingSepidarSourceRecord, { sepidarTableTitle } from '@/features/accounting/AccountingSepidarSourceRecord';
import AccountingParallelComparison from '@/features/accounting/AccountingParallelComparison';
import { evidenceTypeTitle } from '@/features/accounting/AccountingLedgerEvidence';
import {
  readReplacementAudit, readReplacementOverview, readReplacementSnapshots, ReplacementAuditCheck, SepidarReadinessCheck,
  useReplacementRead, type ReplacementException,
} from '@/features/accounting/AccountingReplacementChecks';
import { accountingFailureMessage } from '@/features/accounting/accountingUi';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpMetricGrid, ErpPage, ErpSection, ErpSearchableSelect, ErpSkeleton } from '@/components/erp';

const faDate = (value: unknown) => value ? new Date(String(value)).toLocaleString('fa-IR') : '—';
const faAmount = (value: unknown) => Number(value ?? 0).toLocaleString('fa-IR');
const statusFa: Record<string, string> = {
  PREVIEWED: 'پیش‌نمایش‌شده', ARCHIVED: 'بایگانی‌شده', RECONCILED: 'تطبیق‌شده', PREPARED: 'آماده انتقال', AUTHORITY_TRANSFERRED: 'مرجعیت منتقل‌شده',
  ROLLED_BACK: 'بازیابی‌شده به نقطه امن', PAUSED_FIX_FORWARD: 'متوقف برای اصلاح رو به جلو', BLOCKED: 'متوقف', FAILED: 'ناموفق', RETRY: 'در انتظار تلاش دوباره', OPEN: 'باز',
};

const readReplacementBook = async (_key: string, signal: AbortSignal) => {
  const response = await accountingAPI.getLedgerContext(signal);
  const id: string | undefined = response.data.data?.books?.[0]?.id;
  if (!id) throw new Error('دفتر اصلی حسابداری هنوز ایجاد نشده است.');
  return id;
};
const denied = (status?: number) => status === 401 || status === 403;
const statusOf = (error: unknown) => (error as { response?: { status?: number } })?.response?.status;
const title = 'مهاجرت، تطبیق و بازیابی';

export default function AccountingReplacementPage() {
  const [accessDenied, setAccessDenied] = useState(false);
  const book = useReplacementRead('ledger', readReplacementBook, 'دریافت دفتر اصلی حسابداری انجام نشد.');
  const onDenied = useCallback(() => setAccessDenied(true), []);
  if (book.data && !accessDenied) return <ReplacementWorkspace key={book.data} bookId={book.data} refreshBook={book.retry} onDenied={onDenied} />;
  const permissionFailure = accessDenied || denied(book.status);
  return <ErpPage title={title} backHref="/dashboard/accounting" actions={[{
    label: 'به‌روزرسانی', icon: FaSync, onClick: () => { setAccessDenied(false); book.retry(); }, disabled: book.pending,
  }]}>
    {permissionFailure ? <ErpInlineState kind="permission" title="دسترسی به جایگزینی حسابداری تأیید نشد." />
      : book.error ? <ErpInlineState kind="error" title={book.error} /> : <ErpLoading />}
  </ErpPage>;
}

function ReplacementWorkspace({ bookId, refreshBook, onDenied }: { bookId: string; refreshBook: () => void; onDenied: () => void }) {
  const overview = useReplacementRead(bookId, readReplacementOverview, 'دریافت وضعیت جایگزینی حسابداری انجام نشد.');
  const audit = useReplacementRead(bookId, readReplacementAudit, 'بررسی زنجیره ممیزی جایگزینی انجام نشد.');
  const sources = useReplacementRead(bookId, readReplacementSnapshots, 'فهرست پشتیبان‌های سپیدار دریافت نشد.');
  const [sourceDenied, setSourceDenied] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [archiveError, setArchiveError] = useState<string>();
  const [sourceError, setSourceError] = useState<string>();
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveRows, setArchiveRows] = useState<any[]>([]);
  const [sourceTable, setSourceTable] = useState('ACC.Voucher');
  const [sourcePage, setSourcePage] = useState(0);
  const [sourceRecords, setSourceRecords] = useState<any>();
  const [browsedSnapshotId, setBrowsedSnapshotId] = useState('');
  const [voucherYear, setVoucherYear] = useState('1405');
  const [voucherPage, setVoucherPage] = useState(0);
  const [sourceVouchers, setSourceVouchers] = useState<any>();
  const [sourceVoucher, setSourceVoucher] = useState<any>();
  const sourceRequest = useRef<AbortController>();
  const archiveRequest = useRef<AbortController>();
  const discardSnapshots = sources.discard;
  const sourceSnapshots = (!sourceDenied && sources.data) || [];
  const activeSnapshot = sourceSnapshots.find(item => item.status === 'COMPLETE');
  const data = overview.data;

  const clearSource = useCallback(() => {
    sourceRequest.current?.abort();
    setSourceRecords(undefined);
    setBrowsedSnapshotId('');
    setSourceVouchers(undefined);
    setSourceVoucher(undefined);
    setSourceError(undefined);
  }, []);
  const handleSourceDenial = useCallback((status: number) => {
    if (status === 401) onDenied();
    else {
      clearSource();
      discardSnapshots();
      setSourceDenied(true);
    }
  }, [clearSource, discardSnapshots, onDenied]);

  useEffect(() => {
    if (denied(overview.status) || denied(audit.status) || sources.status === 401) onDenied();
    if (sources.status === 403) clearSource();
  }, [overview.status, audit.status, sources.status, onDenied, clearSource]);
  useEffect(() => {
    clearSource();
  }, [activeSnapshot?.id, clearSource]);
  useEffect(() => () => {
    sourceRequest.current?.abort();
    archiveRequest.current?.abort();
  }, []);

  const searchArchive = async () => {
    if (!archiveQuery.trim()) return;
    archiveRequest.current?.abort();
    const request = new AbortController();
    archiveRequest.current = request;
    setArchiveError(undefined);
    try {
      const response = await accountingAPI.searchLegacyAccountingArchive(bookId, archiveQuery.trim(), request.signal);
      if (!request.signal.aborted) setArchiveRows(response.data.data ?? []);
    } catch (reason) {
      if (request.signal.aborted) return;
      if (denied(statusOf(reason))) onDenied();
      else setArchiveError(accountingFailureMessage(reason, 'جست‌وجوی بایگانی قدیمی انجام نشد.'));
    }
  };
  const readSource = async (operation: (signal: AbortSignal) => Promise<void>, failureMessage: string) => {
    sourceRequest.current?.abort();
    const request = new AbortController();
    sourceRequest.current = request;
    setSourceError(undefined);
    try { await operation(request.signal); }
    catch (reason) {
      if (request.signal.aborted) return;
      const status = statusOf(reason);
      if (status === 401 || status === 403) handleSourceDenial(status);
      else setSourceError(accountingFailureMessage(reason, failureMessage));
    }
  };
  const browseSource = async (snapshotId: string, table: string, page: number) => {
    if (!sourceSnapshots.some(item => item.id === snapshotId && item.status === 'COMPLETE')) return;
    await readSource(async signal => {
      const response = await accountingAPI.getSepidarSourceRecords(bookId, snapshotId, table, page, signal);
      if (signal.aborted) return;
      setSourceTable(table);
      setSourcePage(page);
      setBrowsedSnapshotId(snapshotId);
      setSourceRecords(response.data.data);
    }, 'نمایش داده‌های منبع انجام نشد.');
  };
  const browseVouchers = async (year: string, page: number) => {
    if (!activeSnapshot) return;
    await readSource(async signal => {
      const response = await accountingAPI.getSepidarVouchers(bookId, activeSnapshot.id, year, page, signal);
      if (signal.aborted) return;
      setVoucherYear(year);
      setVoucherPage(page);
      setSourceVouchers(response.data.data);
      setSourceVoucher(undefined);
    }, 'نمایش اسناد سپیدار انجام نشد.');
  };
  const inspectVoucher = async (voucherKey: string) => {
    if (!activeSnapshot) return;
    await readSource(async signal => {
      const response = await accountingAPI.getSepidarVoucher(bookId, activeSnapshot.id, voucherKey, signal);
      if (signal.aborted) return;
      setSourceVoucher(response.data.data);
    }, 'نمایش ردیف‌های سند انجام نشد.');
  };
  const transferred = data?.cutovers?.find((item: any) => item.authorityTransferredAt);
  const acceptedParallel = (data?.parallelRuns ?? []).filter((item: any) => item.accepted);
  const fullClose = acceptedParallel.some((item: any) => item.fullClose);
  const latestRecovery = data?.recoveryProofs?.[0];
  const postedSepidar = (data?.sepidarLedger ?? []).filter((item: any) => item.status === 'POSTED').reduce((sum: number, item: any) => sum + Number(item.count), 0);
  const draftSepidar = (data?.sepidarLedger ?? []).filter((item: any) => item.status === 'DRAFT').reduce((sum: number, item: any) => sum + Number(item.count), 0);
  const exceptions: ReplacementException[] = [...(data?.exceptions ?? [])];
  if (audit.data?.exception) {
    const recoveryException = exceptions.findIndex(item => item.id === 'recovery-proof-missing');
    exceptions.splice(recoveryException === -1 ? exceptions.length : recoveryException, 0, audit.data.exception);
  }
  const categoryCounts = exceptions.reduce((result: Record<string, number>, item) => {
    result[item.category] = (result[item.category] ?? 0) + 1; return result;
  }, {});

  const refreshWorkspace = () => {
    refreshBook();
    overview.retry();
    audit.retry();
    sources.retry();
    setSourceDenied(false);
    setRefresh(value => value + 1);
  };
  return <ErpPage eyebrow="حسابداری" title={title} description="کنترل یکپارچهٔ انتقال از سپیدار، اجرای موازی، مرجعیت نهایی و بازیابی اثبات‌شده." backHref="/dashboard/accounting"
    actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: refreshWorkspace, disabled: overview.pending }]}>
    {overview.error && <ErpInlineState kind="error" title={overview.error} />}
    {overview.pending && !data && <ErpLoading />}
    {data && <>
    <ErpMetricGrid items={[
      { label: 'اسناد سپیدار در دفترکل', value: postedSepidar.toLocaleString('fa-IR'), hint: `${draftSepidar.toLocaleString('fa-IR')} پیش‌نویس باقی‌مانده`, icon: FaCheckCircle, tone: draftSepidar === 0 && postedSepidar > 0 ? 'success' : 'warning' },
      { label: 'اجرای مهاجرت', value: (data?.migrations?.length ?? 0).toLocaleString('fa-IR'), icon: FaHistory, tone: 'info' },
      { label: 'ماه موازی پذیرفته', value: acceptedParallel.length.toLocaleString('fa-IR'), hint: fullClose ? 'دارای بستن کامل' : 'بستن کامل هنوز ثبت نشده', icon: FaCheckCircle, tone: acceptedParallel.length >= 2 && fullClose ? 'success' : 'warning' },
      { label: 'بازیابی اثبات‌شده', value: latestRecovery?.proven ? 'آماده' : 'ناقص', hint: latestRecovery ? `هدف: ${latestRecovery.rpoMinutes} دقیقه / ${latestRecovery.rtoMinutes} دقیقه` : 'مدرکی ثبت نشده', icon: FaShieldAlt, tone: latestRecovery?.proven ? 'success' : 'danger' },
      { label: 'استثنای عملیاتی', value: exceptions.length.toLocaleString('fa-IR'), hint: audit.pending || audit.error ? 'وضعیت ممیزی در پنل بررسی' : undefined, icon: FaExclamationTriangle, tone: exceptions.length ? 'danger' : audit.pending || audit.error ? 'warning' : 'success' },
    ]} />

    <ErpSection title="وضعیت مرجعیت" description="زمان انتقال و اولین ثبت مرجع تغییرپذیر نیستند.">
      <ErpCard>
        {transferred ? <div className="grid gap-3 md:grid-cols-3">
          <div><span className="sds-text-secondary text-sm">سامانه مرجع</span><p className="mt-1 font-semibold">سبلان</p></div>
          <div><span className="sds-text-secondary text-sm">سپیدار</span><p className="mt-1 font-semibold">فقط‌خواندنی</p></div>
          <div><span className="sds-text-secondary text-sm">زمان انتقال</span><p className="mt-1 font-semibold">{faDate(transferred.authorityTransferredAt)}</p></div>
          {transferred.status === 'PAUSED_FIX_FORWARD' && <div className="md:col-span-3"><ErpInlineState kind="error" title="ثبت مرجع آغاز شده است؛ عملیات متوقف و فقط اصلاح رو به جلو مجاز است." /></div>}
        </div> : <ErpInlineState kind="stale" title={`دفترکل محلی ${postedSepidar.toLocaleString('fa-IR')} سند سپیدار را قطعی کرده است؛ انتقال مرجعیت تولید هنوز ثبت نشده است.`} />}
      </ErpCard>
    </ErpSection>

    <ErpSection title="ثبت عملیاتی اسناد سپیدار" description="اسناد قطعی در دفترکل و تراز آزمایشی سبلان اثر دارند. بایگانی منبع و زیرسیستم‌های فروش، خزانه و انبار جداگانه‌اند.">
      <ErpCard>
        <div className="grid gap-2 text-sm sm:grid-cols-2">{['1404', '1405'].map((year) => <p key={year}>سال {year}: {(data?.sepidarLedger ?? []).filter((item: any) => item.year === year && item.status === 'POSTED').reduce((sum: number, item: any) => sum + Number(item.count), 0).toLocaleString('fa-IR')} قطعی · {(data?.sepidarLedger ?? []).filter((item: any) => item.year === year && item.status === 'DRAFT').reduce((sum: number, item: any) => sum + Number(item.count), 0).toLocaleString('fa-IR')} پیش‌نویس</p>)}</div>
        <div className="mt-3"><ErpButton label="بازکردن دفترکل" href="/dashboard/accounting/ledger" variant="outline" /></div>
        {!activeSnapshot && <ErpInlineState kind="stale" title="در بررسی تاریخی، ریزگردش آغاز ۱۴۰۴ در پشتیبان نبود و بهای خروج و موجودی منفی انبار ۱۴۰۵ حل نشده بود." />}
      </ErpCard>
    </ErpSection>

    <ErpSection title="اجراهای مهاجرت و تطبیق">
      {!data?.migrations?.length ? <ErpEmptyState title="اجرای مهاجرتی ثبت نشده است." description="ابتدا بستهٔ هش‌شدهٔ سپیدار و نسخهٔ نگاشت را در مسیر عملیاتی بارگذاری کنید." /> :
        <div className="grid gap-3 lg:grid-cols-2">{data.migrations.map((run: any) => <ErpCard key={run.id}>
          <div className="flex flex-wrap items-start justify-between gap-3 [&>*]:min-w-0 [&>*]:max-w-full [&>*]:break-words"><div><p className="font-semibold">سپیدار · نگاشت نسخهٔ {Number(run.mappingVersion).toLocaleString('fa-IR')}</p><p className="sds-text-secondary mt-1 text-sm">{faDate(run.previewedAt)}</p></div><ErpBadge tone={run.status === 'RECONCILED' ? 'success' : 'warning'}>{statusFa[run.status] ?? 'نیازمند بررسی'}</ErpBadge></div>
          <div className="sds-text-secondary mt-3 grid grid-cols-3 gap-2 text-sm"><span>ورودی: {run.inputCount.toLocaleString('fa-IR')}</span><span>پذیرفته: {run.acceptedCount.toLocaleString('fa-IR')}</span><span>ردشده: {run.rejectedCount.toLocaleString('fa-IR')}</span></div>
        </ErpCard>)}</div>}
    </ErpSection>
    </>}

    <ReplacementAuditCheck check={audit} />
    {activeSnapshot && <SepidarReadinessCheck key={activeSnapshot.id} bookId={bookId} snapshotId={activeSnapshot.id} refresh={refresh} onDenied={handleSourceDenial} />}
    {sources.data && !sourceDenied && <AccountingParallelComparison bookId={bookId} snapshots={sourceSnapshots} refresh={refresh}
      writable={!sources.pending && !sources.error} onDenied={handleSourceDenial} />}
    {!sourceDenied && !denied(sources.status) && <>
    <ErpSection title="پشتیبان کامل سپیدار" description="نسخهٔ اصلی فقط‌خواندنی است. رکوردهای این بخش سند حسابداری سابالان نیستند و در گزارش‌های عملیاتی جمع نمی‌شوند.">
      {sources.pending && <ErpSkeleton lines={1} label="در حال دریافت پشتیبان‌های سپیدار" />}
      {sources.error && <ErpInlineState kind="error" title={sources.error} action={{ label: 'تلاش دوباره', onClick: sources.retry }} />}
      {sourceError && <ErpInlineState kind="error" title={sourceError} />}
      {sources.data && !sources.pending && !sources.error && !sourceSnapshots.length && <ErpEmptyState title="نسخهٔ پشتیبان وارد نشده است." />}
      {sourceSnapshots.map(snapshot => <ErpCard key={snapshot.id} className="mb-3">
        <div className="flex flex-wrap items-center gap-2"><strong>نسخهٔ پشتیبان سپیدار</strong><ErpBadge tone={snapshot.status === 'COMPLETE' ? 'success' : 'warning'}>{snapshot.status === 'COMPLETE' ? 'ورود کامل' : 'ورود در جریان'}</ErpBadge></div>
        <p className="sds-text-secondary mt-2 text-sm">{Number(snapshot.importedRecordCount).toLocaleString('fa-IR')} از {Number(snapshot.expectedRecordCount).toLocaleString('fa-IR')} رکورد در {Number(snapshot.tableCount).toLocaleString('fa-IR')} جدول · {faDate(snapshot.completedAt ?? snapshot.startedAt)}</p>
        {snapshot.status === 'COMPLETE' && <div className="mt-4 grid gap-3">
          <ErpField label="جدول سپیدار"><ErpSearchableSelect value={sourceTable} onChange={(event) => { setSourceTable(event.target.value); setSourcePage(0); setSourceRecords(undefined); }}>
            {(snapshot.tables ?? []).filter((item: any) => item.exact_rows > 0).map((item: any, index: number) => <option key={item.table_name} value={item.table_name}>{sepidarTableTitle(item.table_name, index)} · {Number(item.exact_rows).toLocaleString('fa-IR')}</option>)}
          </ErpSearchableSelect></ErpField>
          <div><ErpButton label="نمایش رکوردها" onClick={() => void browseSource(snapshot.id, sourceTable, 0)} /></div>
          {browsedSnapshotId === snapshot.id && sourceRecords?.table === sourceTable && <><p className="sds-text-secondary text-sm">{Number(sourceRecords.total).toLocaleString('fa-IR')} رکورد · صفحهٔ {(sourcePage + 1).toLocaleString('fa-IR')}</p>
            <div className="grid gap-2">{sourceRecords.records.map((record: any) => <AccountingSepidarSourceRecord key={record.id} record={record} />)}</div>
            <div className="flex flex-wrap gap-2"><ErpButton label="صفحهٔ قبل" variant="outline" disabled={sourcePage === 0} onClick={() => void browseSource(snapshot.id, sourceTable, sourcePage - 1)} /><ErpButton label="صفحهٔ بعد" variant="outline" disabled={(sourcePage + 1) * sourceRecords.pageSize >= sourceRecords.total} onClick={() => void browseSource(snapshot.id, sourceTable, sourcePage + 1)} /></div>
          </>}
        </div>}
      </ErpCard>)}
    </ErpSection>

    {activeSnapshot && <ErpSection title="اسناد حسابداری سپیدار" description="اسناد و ردیف‌های هر دو سال مالی با شماره، تاریخ، حساب و تفصیل منبع نمایش داده می‌شوند؛ وضعیت عددی سپیدار هنوز تفسیر نشده است.">
      <ErpCard>
        <div className="flex flex-wrap items-end gap-3"><ErpField label="سال مالی"><ErpSearchableSelect value={voucherYear} onChange={(event) => { setVoucherYear(event.target.value); setVoucherPage(0); setSourceVouchers(undefined); setSourceVoucher(undefined); }}><option value="1404">۱۴۰۴</option><option value="1405">۱۴۰۵</option></ErpSearchableSelect></ErpField><ErpButton label="نمایش اسناد" onClick={() => void browseVouchers(voucherYear, 0)} /></div>
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
    </>}

    {data && <ErpSection title="مرکز استثنا" description="خطاهای ثبت، نگاشت، مالیات، بانک، چک، بستن دوره، مهاجرت، ممیزی، پشتیبان، صف و اتصال با مالک و مسیر اقدام.">
      {Object.keys(categoryCounts).length > 0 && <div className="mb-3 flex flex-wrap gap-2">{Object.entries(categoryCounts).map(([category, count]) => <ErpBadge key={category} tone="danger">{category}: {Number(count).toLocaleString('fa-IR')}</ErpBadge>)}</div>}
      {!exceptions.length ? <ErpEmptyState title={audit.pending || audit.error ? 'استثنای دیگری ثبت نشده است.' : 'استثنای بازی وجود ندارد.'} /> : <div className="grid gap-3">{exceptions.map(item => <ErpCard key={`${item.category}-${item.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ErpBadge tone="danger">{item.category}</ErpBadge><strong>{item.title}</strong></div><p className="sds-text-secondary mt-2 text-sm">مالک: {item.owner} · عمر: {Number(item.ageHours).toLocaleString('fa-IR')} ساعت · منبع: {evidenceTypeTitle(String(item.source).split(':')[0])} · شناسهٔ <bdi>{String(item.source).includes(':') ? String(item.source).split(':').slice(1).join(':') : item.id}</bdi></p></div><ErpButton label="رسیدگی" href={item.resolutionHref} variant="outline" tone="danger" /></div>
      </ErpCard>)}</div>}
    </ErpSection>}

    <ErpSection title="بایگانی فقط‌خواندنی سپیدار" description="سوابق قدیمی قابل جست‌وجو هستند و هرگز به‌صورت سند جدید سابالان نمایش داده نمی‌شوند.">
      {archiveError && <ErpInlineState kind="error" title={archiveError} />}
      <div className="flex flex-col gap-2 sm:flex-row"><label className="block flex-1"><span className="sds-text-secondary mb-2 block text-sm">عبارت جست‌وجو</span><ErpInput value={archiveQuery} onChange={(event) => setArchiveQuery(event.target.value)} placeholder="شماره سند، شرح یا شناسه منبع" /></label><div className="self-end"><ErpButton label="جست‌وجو" icon={FaSearch} onClick={searchArchive} disabled={!archiveQuery.trim()} /></div></div>
      {archiveRows.length > 0 && <div className="mt-4 grid gap-3">{archiveRows.map((item) => <ErpCard key={item.id}><div className="flex items-center gap-2"><FaArchive className="sds-text-secondary" /><strong>{item.sourceId}</strong><ErpBadge tone="neutral">فقط‌خواندنی</ErpBadge></div><p className="sds-text-secondary mt-2 break-all text-xs">اثر انگشت: {item.sourceHash}</p></ErpCard>)}</div>}
    </ErpSection>
  </ErpPage>;
}
