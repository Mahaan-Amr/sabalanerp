'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpSheet,
} from '@/components/erp';
import { accountingAPI } from '@/lib/api';

type Context = any;
type Tab = 'journal' | 'balance' | 'identities' | 'chart' | 'settings';
type Message = { kind: 'success' | 'error'; title: string };
type VoucherLine = {
  accountId: string; debitRials: string; creditRials: string; description: string;
  partyId: string; financialAccountId: string;
  dimensions: Record<string, string>; originalAmount: string; originalCurrency: string;
  exchangeRate: string; exchangeRateDate: string; exchangeRateSource: string;
  rawAmountBeforeRounding: string; roundingRuleVersion: string;
};

const integer = (value: unknown) => {
  try { return BigInt(String(value || '0')); } catch { return BigInt(0); }
};
const digits = (value: unknown) => integer(value).toLocaleString('fa-IR');
const dateFa = (value: string) => value ? new Date(value).toLocaleDateString('fa-IR') : '—';
const statusFa: Record<string, string> = { DRAFT: 'پیش‌نویس', ACTIVE: 'فعال', OPEN: 'باز', SOFT_CLOSED: 'بسته موقت', HARD_CLOSED: 'بسته قطعی', POSTED: 'قطعی', REVERSED: 'برگشت‌شده' };
const levelFa: Record<string, string> = { GROUP: 'گروه', KOL: 'کل', MOIN: 'معین' };
const numericInput = (value: string) => value
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/\D/g, '');
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
  return value;
};
const sha256 = async (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const emptyVoucherLine = (): VoucherLine => ({
  accountId: '', debitRials: '', creditRials: '', description: '', dimensions: {},
  partyId: '', financialAccountId: '',
  originalAmount: '', originalCurrency: 'IRR', exchangeRate: '', exchangeRateDate: '', exchangeRateSource: '',
  rawAmountBeforeRounding: '', roundingRuleVersion: 'ریال-صحیح-نیم-به-بالا-نسخه-۱',
});
const twelvePeriodTemplate = (startsAt: string, endsAt: string) => {
  if (!startsAt || !endsAt) return [];
  const first = new Date(`${startsAt}T00:00:00.000Z`);
  return [...Array.from({ length: 12 }, (_item, index) => {
    const start = new Date(first);
    start.setUTCMonth(first.getUTCMonth() + index);
    const next = new Date(first);
    next.setUTCMonth(first.getUTCMonth() + index + 1);
    next.setUTCDate(next.getUTCDate() - 1);
    return { titlePersian: `دوره ${Number(index + 1).toLocaleString('fa-IR')}`, startsAt: isoDate(start), endsAt: index === 11 ? endsAt : isoDate(next), isAdjustment: false };
  }), { titlePersian: 'دوره تعدیلات پایان سال', startsAt: endsAt, endsAt, isAdjustment: true }];
};

export default function AccountingLedgerPage() {
  const [context, setContext] = useState<Context>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('journal');
  const [message, setMessage] = useState<Message>();
  const [journal, setJournal] = useState<any[]>([]);
  const [balance, setBalance] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [fiscalYearId, setFiscalYearId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [setup, setSetup] = useState({ code: '1', namePersian: '', nationalId: '', economicCode: '', activeFrom: '', bookCode: '1', bookName: 'دفتر اصلی', groupLength: '1', kolLength: '2', moinLength: '3' });
  const [account, setAccount] = useState<any>({ code: '', titlePersian: '', level: 'GROUP', parentId: '', contraAccountId: '', normalSide: 'DEBIT', statementRole: 'ASSET', currencyBehavior: 'BASE_ONLY', partyRequirement: 'FORBIDDEN', financialAccountRequirement: 'FORBIDDEN', effectiveFrom: '', dimensionRules: {} });
  const [dimension, setDimension] = useState({ code: '', titlePersian: '', sourceKind: 'دستی', effectiveFrom: '' });
  const [dimensionMember, setDimensionMember] = useState({ dimensionTypeId: '', sourceId: '', code: '', titlePersian: '', effectiveFrom: '' });
  const [financialAccount, setFinancialAccount] = useState({ kind: 'BANK', titlePersian: '', institutionName: '', branchName: '', accountNumber: '', iban: '', currency: 'IRR', activeFrom: '' });
  const [fiscal, setFiscal] = useState({ code: '', titlePersian: '', startsAt: '', endsAt: '', periods: [{ titlePersian: 'دوره یک', startsAt: '', endsAt: '', isAdjustment: false }] });
  const [voucher, setVoucher] = useState({ description: '', documentDate: '', occurredAt: '', discoveredAt: '', lines: [emptyVoucherLine(), emptyVoucherLine()] });
  const [createdVoucher, setCreatedVoucher] = useState<any>();
  const [saving, setSaving] = useState(false);
  const [postTarget, setPostTarget] = useState<any>();
  const [postReason, setPostReason] = useState('');
  const [postOverride, setPostOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [reverseTarget, setReverseTarget] = useState<any>();
  const [reverseReason, setReverseReason] = useState('');
  const [reverseDate, setReverseDate] = useState('');
  const [emergencyReverseConfirmed, setEmergencyReverseConfirmed] = useState(false);
  const [periodReason, setPeriodReason] = useState('');
  const [auditHealth, setAuditHealth] = useState<{ valid: boolean; checkedEntries: number; failedSequence: string | null }>();
  const [evidenceDetail, setEvidenceDetail] = useState<any>();
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const loadContext = useCallback(async () => {
    setLoading(true);
    try {
      const response = await accountingAPI.getLedgerContext();
      const next = response.data.data;
      setContext(next);
      const year = next?.books?.[0]?.fiscalYears?.[0];
      setFiscalYearId((current) => current || year?.id || '');
      setPeriodId((current) => current || year?.periods?.find((item: any) => item.status === 'OPEN')?.id || '');
    } catch (error: any) {
      setMessage({ kind: 'error', title: error.response?.data?.error || 'خواندن دفترکل ناموفق بود.' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadContext(); }, [loadContext]);

  const book = context?.books?.[0];
  const year = book?.fiscalYears?.find((item: any) => item.id === fiscalYearId) || book?.fiscalYears?.[0];
  const accounts = book?.accounts || [];
  const postingAccounts = accounts.filter((item: any) => item.level === 'MOIN' && !item.retiredAt);
  const scheme = book?.codeSchemes?.[0];
  const dimensionTypes = book?.dimensionTypes || [];

  const refreshReports = useCallback(async () => {
    if (!book?.id || !year?.id) return;
    try {
      const params = { bookId: book.id, fiscalYearId: year.id, periodId: periodId || undefined };
      const [journalResponse, balanceResponse, draftResponse] = await Promise.all([
        accountingAPI.getLedgerJournal(params), accountingAPI.getLedgerTrialBalance(params),
        accountingAPI.getLedgerVouchers({ ...params, status: 'DRAFT' }),
      ]);
      setJournal(journalResponse.data.data || []);
      setBalance(balanceResponse.data.data || []);
      setDrafts(draftResponse.data.data || []);
    } catch (error: any) {
      setMessage({ kind: 'error', title: error.response?.data?.error || 'به‌روزرسانی گزارش دفترکل ناموفق بود.' });
    }
  }, [book?.id, year?.id, periodId]);

  useEffect(() => { void refreshReports(); }, [refreshReports]);

  const totals = useMemo(() => balance.reduce((result, item) => ({
    debit: result.debit + integer(item.debitRials),
    credit: result.credit + integer(item.creditRials),
  }), { debit: BigInt(0), credit: BigInt(0) }), [balance]);
  const canWrite = ['ACCOUNTANT', 'ACCOUNTING_MANAGER'].includes(context?.accessProfile);
  const canManage = context?.accessProfile === 'ACCOUNTING_MANAGER';
  const canOverride = canWrite && (canManage || context?.isGlobalAdmin === true);
  const voucherTotals = useMemo(() => voucher.lines.reduce((sum, line) => ({
    debit: sum.debit + integer(line.debitRials), credit: sum.credit + integer(line.creditRials),
  }), { debit: BigInt(0), credit: BigInt(0) }), [voucher.lines]);
  const requiredDimensionsMissing = voucher.lines.some((line) => {
    const selected = postingAccounts.find((item: any) => item.id === line.accountId);
    return selected?.dimensionRules?.some((rule: any) => rule.requirement === 'REQUIRED' && !line.dimensions[rule.dimensionTypeId]);
  });

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setSaving(true); setMessage(undefined);
    try { await operation(); setMessage({ kind: 'success', title: success }); await loadContext(); }
    catch (error: any) { setMessage({ kind: 'error', title: error.response?.data?.error || 'انجام عملیات ناموفق بود.' }); }
    finally { setSaving(false); }
  };

  const openEvidence = async (voucherId: string) => {
    setEvidenceLoading(true); setMessage(undefined);
    try {
      const response = await accountingAPI.getLedgerVoucherEvidence(voucherId, 'بازبینی شواهد قطعی سند در دفتر روزنامه');
      setEvidenceDetail(response.data.data);
    } catch (error: any) {
      setMessage({ kind: 'error', title: error.response?.data?.error || 'خواندن شواهد سند ناموفق بود.' });
    } finally { setEvidenceLoading(false); }
  };

  if (loading) return <ErpLoading />;

  if (!context?.configured) return (
    <ErpPage eyebrow="حسابداری" title="راه‌اندازی دفترکل" description="واحد گزارشگر، دفتر اصلی و نسخه نخست کدینگ را ثبت کنید." backHref="/dashboard/accounting">
      {message && <ErpInlineState kind={message.kind} title={message.title} />}
      {!canManage ? <ErpEmptyState title="راه‌اندازی دفترکل فقط برای مدیر حسابداری مجاز است." description="برای ادامه با مدیر حسابداری یا مدیر سامانه تماس بگیرید." /> : <>
      <ErpSection title="واحد گزارشگر و دفتر اصلی">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label><span className="mb-2 block text-sm">نام فارسی شرکت</span><ErpInput value={setup.namePersian} onChange={(event) => setSetup({ ...setup, namePersian: event.target.value })} /></label>
          <label><span className="mb-2 block text-sm">شناسه ملی</span><ErpInput value={setup.nationalId} onChange={(event) => setSetup({ ...setup, nationalId: event.target.value })} /></label>
          <label><span className="mb-2 block text-sm">کد اقتصادی</span><ErpInput value={setup.economicCode} onChange={(event) => setSetup({ ...setup, economicCode: event.target.value })} /></label>
          <label><span className="mb-2 block text-sm">تاریخ شروع فعالیت</span><ErpInput type="date" value={setup.activeFrom} onChange={(event) => setSetup({ ...setup, activeFrom: event.target.value })} /></label>
          <label><span className="mb-2 block text-sm">عنوان دفتر</span><ErpInput value={setup.bookName} onChange={(event) => setSetup({ ...setup, bookName: event.target.value })} /></label>
          <label><span className="mb-2 block text-sm">طول کد گروه، کل و معین</span><div className="grid grid-cols-3 gap-2"><ErpInput aria-label="طول کد گروه" value={setup.groupLength} onChange={(event) => setSetup({ ...setup, groupLength: event.target.value })} /><ErpInput aria-label="طول کد کل" value={setup.kolLength} onChange={(event) => setSetup({ ...setup, kolLength: event.target.value })} /><ErpInput aria-label="طول کد معین" value={setup.moinLength} onChange={(event) => setSetup({ ...setup, moinLength: event.target.value })} /></div></label>
        </div>
        <div className="mt-4 flex justify-end"><ErpButton label={saving ? 'در حال ثبت…' : 'ایجاد دفترکل ریالی'} disabled={saving || !setup.namePersian || !setup.activeFrom} onClick={() => run(() => accountingAPI.setupLedger({ legalEntity: { code: setup.code, namePersian: setup.namePersian, nationalId: setup.nationalId || undefined, economicCode: setup.economicCode || undefined, activeFrom: setup.activeFrom }, book: { code: setup.bookCode, namePersian: setup.bookName }, scheme: { groupLength: Number(setup.groupLength), kolLength: Number(setup.kolLength), moinLength: Number(setup.moinLength) } }), 'دفترکل ریالی ایجاد شد.')} /></div>
      </ErpSection>
      </>}
    </ErpPage>
  );

  return (
    <ErpPage eyebrow="حسابداری" title="دفترکل و کدینگ" description={`${context.namePersian} · ارز قانونی: ریال`} backHref="/dashboard/accounting" actions={[{ label: 'به‌روزرسانی', onClick: refreshReports, tone: 'neutral' }]}>
      {message && <ErpInlineState kind={message.kind} title={message.title} />}
      <ErpSection>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label><span className="mb-2 block text-sm">سال مالی</span><ErpSelect value={year?.id || ''} onChange={(event) => { setFiscalYearId(event.target.value); setPeriodId(''); }}>{book?.fiscalYears?.map((item: any) => <option key={item.id} value={item.id}>{item.titlePersian}</option>)}</ErpSelect></label>
          <label><span className="mb-2 block text-sm">دوره</span><ErpSelect value={periodId} onChange={(event) => setPeriodId(event.target.value)}><option value="">تمام سال</option>{year?.periods?.map((item: any) => <option key={item.id} value={item.id}>{item.titlePersian} · {statusFa[item.status]}</option>)}</ErpSelect></label>
          <ErpCard className="p-3"><span className="text-xs text-[var(--sds-text-muted)]">وضعیت سال مالی</span><div className="mt-2"><ErpBadge tone={year?.status === 'ACTIVE' ? 'success' : 'warning'}>{statusFa[year?.status] || 'تعریف‌نشده'}</ErpBadge></div></ErpCard>
          <ErpCard className="p-3"><span className="text-xs text-[var(--sds-text-muted)]">کدینگ فعال</span><strong className="mt-2 block">نسخه {Number(scheme?.version || 0).toLocaleString('fa-IR')}</strong></ErpCard>
        </div>
      </ErpSection>
      <ErpSegmentedControl value={tab} onChange={setTab} options={[
        { value: 'journal', label: 'دفتر روزنامه' }, { value: 'balance', label: 'تراز آزمایشی' },
        ...(canWrite ? [{ value: 'identities' as const, label: 'طرف‌ها و حساب‌های مالی' }] : []),
        ...(canManage ? [{ value: 'chart' as const, label: 'کدینگ حساب‌ها' }, { value: 'settings' as const, label: 'تنظیمات دفتر' }] : []),
      ]} />

      {tab === 'journal' && <>
        {canWrite && <ErpSection title="ثبت سند دستی" description="ثبت اولیه بدون اثر رسمی است؛ اثر قانونی فقط پس از قطعی‌سازی ساخته می‌شود.">
          {!year || !periodId || postingAccounts.length < 2 ? <ErpEmptyState title="برای ثبت سند، سال مالی باز و دست‌کم دو حساب معین لازم است." /> : <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label><span className="mb-2 block text-sm">شرح سند</span><ErpInput value={voucher.description} onChange={(event) => setVoucher({ ...voucher, description: event.target.value })} /></label>
              <label><span className="mb-2 block text-sm">تاریخ سند</span><ErpInput type="date" value={voucher.documentDate} onChange={(event) => setVoucher({ ...voucher, documentDate: event.target.value })} /></label>
              <label><span className="mb-2 block text-sm">تاریخ وقوع</span><ErpInput type="date" value={voucher.occurredAt} onChange={(event) => setVoucher({ ...voucher, occurredAt: event.target.value })} /></label>
              <label><span className="mb-2 block text-sm">تاریخ کشف، در صورت نیاز</span><ErpInput type="date" value={voucher.discoveredAt} onChange={(event) => setVoucher({ ...voucher, discoveredAt: event.target.value })} /></label>
            </div>
            <div className="mt-4 space-y-3">{voucher.lines.map((line, index) => {
              const selected = postingAccounts.find((item: any) => item.id === line.accountId);
              const rules = selected?.dimensionRules?.filter((rule: any) => rule.requirement !== 'FORBIDDEN') || [];
              const updateLine = (change: Partial<VoucherLine>) => setVoucher((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item) }));
              return <ErpCard key={index} className="p-3"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label><span className="mb-2 block text-sm">حساب آرتیکل {Number(index + 1).toLocaleString('fa-IR')}</span><ErpSelect value={line.accountId} onChange={(event) => updateLine({ accountId: event.target.value, dimensions: {}, partyId: '', financialAccountId: '' })}><option value="">انتخاب حساب</option>{postingAccounts.map((item: any) => <option key={item.id} value={item.id}>{item.code} · {item.titlePersian}</option>)}</ErpSelect></label>
                <label><span className="mb-2 block text-sm">شرح آرتیکل</span><ErpInput value={line.description} onChange={(event) => updateLine({ description: event.target.value })} /></label>
                <label><span className="mb-2 block text-sm">بدهکار ریال</span><ErpInput inputMode="numeric" value={line.debitRials} onChange={(event) => updateLine({ debitRials: numericInput(event.target.value), creditRials: numericInput(event.target.value) ? '' : line.creditRials })} /></label>
                <label><span className="mb-2 block text-sm">بستانکار ریال</span><ErpInput inputMode="numeric" value={line.creditRials} onChange={(event) => updateLine({ creditRials: numericInput(event.target.value), debitRials: numericInput(event.target.value) ? '' : line.debitRials })} /></label>
                <label><span className="mb-2 block text-sm">مبلغ خام پیش از گردکردن</span><ErpInput inputMode="decimal" value={line.rawAmountBeforeRounding} onChange={(event) => updateLine({ rawAmountBeforeRounding: event.target.value })} /></label>
                <ErpCard className="p-3"><span className="text-xs text-[var(--sds-text-muted)]">قاعده گردکردن</span><strong className="mt-2 block text-sm">ریال صحیح؛ نیم‌ریال به بالا</strong></ErpCard>
                {selected?.partyRequirement !== 'FORBIDDEN' && <label><span className="mb-2 block text-sm">طرف حساب {selected?.partyRequirement === 'REQUIRED' ? '· اجباری' : '· اختیاری'}</span><ErpSelect value={line.partyId} onChange={(event) => updateLine({ partyId: event.target.value })}><option value="">انتخاب طرف حساب</option>{context.parties?.map((item: any) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</ErpSelect></label>}
                {selected?.financialAccountRequirement !== 'FORBIDDEN' && <label><span className="mb-2 block text-sm">حساب مالی {selected?.financialAccountRequirement === 'REQUIRED' ? '· اجباری' : '· اختیاری'}</span><ErpSelect value={line.financialAccountId} onChange={(event) => updateLine({ financialAccountId: event.target.value })}><option value="">انتخاب حساب مالی</option>{context.financialAccounts?.map((item: any) => <option key={item.id} value={item.id}>{item.titlePersian}</option>)}</ErpSelect></label>}
                {rules.map((rule: any) => { const type = dimensionTypes.find((item: any) => item.id === rule.dimensionTypeId); return <label key={rule.dimensionTypeId}><span className="mb-2 block text-sm">{type?.titlePersian} {rule.requirement === 'REQUIRED' ? '· اجباری' : '· اختیاری'}</span><ErpSelect value={line.dimensions[rule.dimensionTypeId] || ''} onChange={(event) => updateLine({ dimensions: { ...line.dimensions, [rule.dimensionTypeId]: event.target.value } })}><option value="">انتخاب تفصیلی</option>{type?.members?.map((member: any) => <option key={member.id} value={member.id}>{member.titlePersian}</option>)}</ErpSelect></label>; })}
                {selected?.currencyBehavior === 'MULTI_CURRENCY' && <><label><span className="mb-2 block text-sm">مبلغ اولیه</span><ErpInput value={line.originalAmount} onChange={(event) => updateLine({ originalAmount: event.target.value })} /></label><label><span className="mb-2 block text-sm">ارز اولیه</span><ErpSelect value={line.originalCurrency} onChange={(event) => updateLine({ originalCurrency: event.target.value, exchangeRate: '', exchangeRateDate: '', exchangeRateSource: '' })}><option value="IRR">ریال ایران</option><option value="USD">دلار آمریکا</option><option value="EUR">یورو</option><option value="AED">درهم امارات</option><option value="TRY">لیر ترکیه</option><option value="CNY">یوان چین</option><option value="GBP">پوند بریتانیا</option></ErpSelect></label>{line.originalCurrency !== 'IRR' && <><label><span className="mb-2 block text-sm">نرخ تبدیل به ریال</span><ErpInput value={line.exchangeRate} onChange={(event) => updateLine({ exchangeRate: event.target.value })} /></label><label><span className="mb-2 block text-sm">تاریخ نرخ</span><ErpInput type="date" value={line.exchangeRateDate} onChange={(event) => updateLine({ exchangeRateDate: event.target.value })} /></label><label><span className="mb-2 block text-sm">منبع نرخ</span><ErpInput value={line.exchangeRateSource} onChange={(event) => updateLine({ exchangeRateSource: event.target.value })} /></label></>}</>}
              </div>{voucher.lines.length > 2 && <div className="mt-3 flex justify-end"><ErpButton label="حذف آرتیکل" tone="danger" variant="ghost" onClick={() => setVoucher((current) => ({ ...current, lines: current.lines.filter((_item, itemIndex) => itemIndex !== index) }))} /></div>}</ErpCard>;
            })}</div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><ErpBadge tone={voucherTotals.debit === voucherTotals.credit && voucherTotals.debit > BigInt(0) ? 'success' : 'warning'}>جمع بدهکار: {digits(voucherTotals.debit)} · جمع بستانکار: {digits(voucherTotals.credit)}</ErpBadge><ErpButton label="افزودن آرتیکل" variant="outline" onClick={() => setVoucher((current) => ({ ...current, lines: [...current.lines, emptyVoucherLine()] }))} /></div>
            <div className="mt-4 flex flex-wrap justify-end gap-2"><ErpButton label="ثبت پیش‌نویس" disabled={saving || !voucher.description || !voucher.documentDate || voucherTotals.debit <= BigInt(0) || voucherTotals.debit !== voucherTotals.credit || requiredDimensionsMissing || voucher.lines.some((line) => { const selected = postingAccounts.find((item: any) => item.id === line.accountId); return !line.accountId || !line.rawAmountBeforeRounding || !line.roundingRuleVersion || (selected?.partyRequirement === 'REQUIRED' && !line.partyId) || (selected?.financialAccountRequirement === 'REQUIRED' && !line.financialAccountId) || (integer(line.debitRials) === BigInt(0)) === (integer(line.creditRials) === BigInt(0)); })} onClick={async () => {
              setSaving(true); setMessage(undefined);
              try {
                const key = crypto.randomUUID();
                const header = { bookId: book.id, fiscalYearId: year.id, periodId, description: voucher.description, documentDate: voucher.documentDate, occurredAt: voucher.occurredAt || voucher.documentDate, discoveredAt: voucher.discoveredAt || null };
                const lines = await Promise.all(voucher.lines.map(async (line, index) => {
                  const dimensions = Object.entries(line.dimensions).filter(([, memberId]) => memberId).map(([typeId, memberId]) => ({ typeId, memberId })).sort((left, right) => `${left.typeId}:${left.memberId}`.localeCompare(`${right.typeId}:${right.memberId}`));
                  const evidencePayload = {
                    kind: 'MANUAL_LEDGER_LINE', voucherId: key, lineNumber: index + 1, header,
                    accountId: line.accountId, partyId: line.partyId || null, financialAccountId: line.financialAccountId || null,
                    debitRials: line.debitRials || '0', creditRials: line.creditRials || '0', description: line.description || null,
                    dimensions, originalAmount: line.originalAmount || null, originalCurrency: line.originalAmount ? line.originalCurrency : null,
                    exchangeRate: line.exchangeRate || null, exchangeRateDate: line.exchangeRateDate || null, exchangeRateSource: line.exchangeRateSource || null,
                    rawAmountBeforeRounding: line.rawAmountBeforeRounding, roundingRuleVersion: line.roundingRuleVersion,
                  };
                  return {
                    accountId: line.accountId, partyId: line.partyId || undefined, financialAccountId: line.financialAccountId || undefined,
                    debitRials: line.debitRials || '0', creditRials: line.creditRials || '0', description: line.description || undefined,
                    dimensions, originalAmount: line.originalAmount || undefined, originalCurrency: line.originalAmount ? line.originalCurrency : undefined,
                    exchangeRate: line.exchangeRate || undefined, exchangeRateDate: line.exchangeRateDate || undefined, exchangeRateSource: line.exchangeRateSource || undefined,
                    rawAmountBeforeRounding: line.rawAmountBeforeRounding, roundingRuleVersion: line.roundingRuleVersion,
                    evidence: { type: 'شاهد سند دستی', id: `${key}-${index + 1}`, version: 1, payload: evidencePayload, hash: await sha256(evidencePayload) },
                  };
                }));
                const sourcePayload = { kind: 'MANUAL_LEDGER_VOUCHER', id: key, version: 1, header, lineEvidence: lines.map((line) => ({ id: line.evidence.id, hash: line.evidence.hash })) };
                const response = await accountingAPI.createLedgerVoucher({ ...header, discoveredAt: voucher.discoveredAt || undefined, source: { type: 'سند دستی', id: key, version: 1, payload: sourcePayload, hash: await sha256(sourcePayload) }, lines }, key);
                setCreatedVoucher(response.data.data); setDrafts((current) => [response.data.data, ...current]); setMessage({ kind: 'success', title: 'پیش‌نویس متوازن ثبت شد.' });
              } catch (error: any) { setMessage({ kind: 'error', title: error.response?.data?.error || 'ثبت پیش‌نویس ناموفق بود.' }); }
              finally { setSaving(false); }
            }} />{createdVoucher?.status === 'DRAFT' && <ErpButton label="قطعی‌سازی سند" tone="success" onClick={() => setPostTarget(createdVoucher)} />}</div>
          </>}
        </ErpSection>}
        <ErpSection title="پیش‌نمایش پیش‌نویس‌ها" description="این ارقام رسمی نیستند و در مانده‌ها و دفاتر قانونی محاسبه نمی‌شوند.">
          {drafts.length === 0 ? <ErpEmptyState title="پیش‌نویس تعیین‌تکلیف‌نشده‌ای وجود ندارد." /> : <div className="grid gap-2 md:grid-cols-2">{drafts.map((item) => <ErpCard key={item.id} className="p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{item.description}</strong><span className="mt-1 block text-sm text-[var(--sds-text-muted)]">{dateFa(item.documentDate)} · {digits(item.debitTotalRials)} ریال</span></div>{canWrite && <ErpButton label="قطعی‌سازی" tone="success" variant="outline" onClick={() => setPostTarget(item)} />}</div></ErpCard>)}</div>}
        </ErpSection>
        <ErpSection title="دفتر روزنامه قطعی">
          {journal.length === 0 ? <ErpEmptyState title="سند قطعی در این محدوده وجود ندارد." /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--sds-border-default)]"><th className="p-3 text-right">شماره سند</th><th className="p-3 text-right">تاریخ</th><th className="p-3 text-right">شرح و آرتیکل‌ها</th><th className="p-3 text-right">وضعیت</th><th className="p-3 text-left">بدهکار</th><th className="p-3 text-left">بستانکار</th>{(canManage || canOverride) && <th className="p-3 text-right">عملیات</th>}</tr></thead><tbody>{journal.map((item) => <tr key={item.id} className="border-b border-[var(--sds-border-default)] align-top"><td className="p-3">{Number(item.statutoryNumber).toLocaleString('fa-IR')}</td><td className="p-3">{dateFa(item.documentDate)}</td><td className="p-3"><strong>{item.description}</strong><div className="mt-2 space-y-1 text-xs text-[var(--sds-text-muted)]">{item.lines?.map((line: any) => <div key={line.id}>{line.account?.code} · {line.account?.titlePersian} · بدهکار {digits(line.debitRials)} · بستانکار {digits(line.creditRials)}{line.description ? ` · ${line.description}` : ''}</div>)}</div></td><td className="p-3"><ErpBadge tone={item.status === 'POSTED' ? 'success' : 'warning'}>{statusFa[item.status]}</ErpBadge></td><td className="p-3 text-left">{digits(item.debitTotalRials)}</td><td className="p-3 text-left">{digits(item.creditTotalRials)}</td>{(canManage || canOverride) && <td className="p-3"><div className="flex flex-wrap gap-2">{canManage && <ErpButton label="مشاهده شواهد" variant="outline" disabled={evidenceLoading} onClick={() => void openEvidence(item.id)} />}{canOverride && item.status === 'POSTED' && <ErpButton label="برگشت سند" tone="danger" variant="outline" onClick={() => setReverseTarget(item)} />}</div></td>}</tr>)}</tbody></table></div>}
        </ErpSection>
      </>}

      {tab === 'balance' && <ErpSection title="تراز آزمایشی قطعی" description="این گزارش فقط از آرتیکل‌های قطعی ساخته می‌شود.">
        {balance.length === 0 ? <ErpEmptyState title="گردش قطعی برای نمایش وجود ندارد." /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--sds-border-default)]"><th className="p-3 text-right">کد</th><th className="p-3 text-right">عنوان حساب</th><th className="p-3 text-left">گردش بدهکار</th><th className="p-3 text-left">گردش بستانکار</th><th className="p-3 text-left">مانده</th></tr></thead><tbody>{balance.map((item) => <tr key={item.accountId} className="border-b border-[var(--sds-border-default)]"><td className="p-3">{item.code}</td><td className="p-3">{item.titlePersian}</td><td className="p-3 text-left">{digits(item.debitRials)}</td><td className="p-3 text-left">{digits(item.creditRials)}</td><td className="p-3 text-left">{digits(integer(item.debitRials) - integer(item.creditRials))}</td></tr>)}</tbody><tfoot><tr className="font-bold"><td className="p-3" colSpan={2}>جمع</td><td className="p-3 text-left">{digits(totals.debit)}</td><td className="p-3 text-left">{digits(totals.credit)}</td><td className="p-3 text-left">{digits(totals.debit - totals.credit)}</td></tr></tfoot></table></div>}
      </ErpSection>}

      {tab === 'identities' && canWrite && <>
        <ErpSection title="طرف حساب پایدار" description="هویت مشتری و تأمین‌کننده از فرایند مرجع خودش به‌صورت خودکار ساخته می‌شود؛ افزودن نقش، هویت تاریخی را بازنویسی نمی‌کند.">
          <div className="mt-4 grid gap-2 md:grid-cols-2">{context.parties?.map((item: any) => <ErpCard key={item.id} className="p-3"><strong>{item.displayName}</strong><span className="mt-1 block text-sm text-[var(--sds-text-muted)]">{item.roles?.map((role: any) => role.role === 'CUSTOMER' ? 'مشتری' : role.role === 'SUPPLIER' ? 'تأمین‌کننده' : role.role === 'EMPLOYEE' ? 'کارمند' : 'سایر').join('، ')}</span></ErpCard>)}</div>
        </ErpSection>
        {canManage && <ErpSection title="حساب‌های بانکی و صندوق">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label><span className="mb-2 block text-sm">نوع حساب مالی</span><ErpSelect value={financialAccount.kind} onChange={(event) => setFinancialAccount({ ...financialAccount, kind: event.target.value })}><option value="BANK">بانک</option><option value="CASH">صندوق</option><option value="OTHER">سایر</option></ErpSelect></label><label><span className="mb-2 block text-sm">عنوان فارسی</span><ErpInput value={financialAccount.titlePersian} onChange={(event) => setFinancialAccount({ ...financialAccount, titlePersian: event.target.value })} /></label><label><span className="mb-2 block text-sm">بانک یا مؤسسه</span><ErpInput value={financialAccount.institutionName} onChange={(event) => setFinancialAccount({ ...financialAccount, institutionName: event.target.value })} /></label><label><span className="mb-2 block text-sm">شماره حساب</span><ErpInput value={financialAccount.accountNumber} onChange={(event) => setFinancialAccount({ ...financialAccount, accountNumber: event.target.value })} /></label><label><span className="mb-2 block text-sm">شماره شبا</span><ErpInput value={financialAccount.iban} onChange={(event) => setFinancialAccount({ ...financialAccount, iban: event.target.value })} /></label><label><span className="mb-2 block text-sm">تاریخ شروع</span><ErpInput type="date" value={financialAccount.activeFrom} onChange={(event) => setFinancialAccount({ ...financialAccount, activeFrom: event.target.value })} /></label></div>
          <div className="mt-3 flex justify-end"><ErpButton label="افزودن حساب مالی" disabled={!financialAccount.titlePersian || !financialAccount.activeFrom} onClick={() => run(() => accountingAPI.createLedgerFinancialAccount({ ...financialAccount, legalEntityId: context.id }), 'حساب مالی ایجاد شد.')} /></div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">{context.financialAccounts?.map((item: any) => <ErpCard key={item.id} className="p-3"><strong>{item.titlePersian}</strong><span className="mt-1 block text-sm text-[var(--sds-text-muted)]">{item.kind === 'BANK' ? 'بانک' : item.kind === 'CASH' ? 'صندوق' : 'سایر'} · {item.currency === 'IRR' ? 'ریال' : item.currency}</span></ErpCard>)}</div>
        </ErpSection>}
      </>}

      {tab === 'chart' && <>
        <ErpSection title="افزودن حساب">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label><span className="mb-2 block text-sm">کد حساب</span><ErpInput value={account.code} onChange={(event) => setAccount({ ...account, code: numericInput(event.target.value) })} /></label>
            <label><span className="mb-2 block text-sm">عنوان فارسی</span><ErpInput value={account.titlePersian} onChange={(event) => setAccount({ ...account, titlePersian: event.target.value })} /></label>
            <label><span className="mb-2 block text-sm">سطح</span><ErpSelect value={account.level} onChange={(event) => setAccount({ ...account, level: event.target.value, parentId: '' })}><option value="GROUP">گروه</option><option value="KOL">کل</option><option value="MOIN">معین</option></ErpSelect></label>
            <label><span className="mb-2 block text-sm">والد مستقیم</span><ErpSelect disabled={account.level === 'GROUP'} value={account.parentId} onChange={(event) => setAccount({ ...account, parentId: event.target.value })}><option value="">انتخاب والد</option>{accounts.filter((item: any) => item.level === (account.level === 'MOIN' ? 'KOL' : 'GROUP')).map((item: any) => <option key={item.id} value={item.id}>{item.code} · {item.titlePersian}</option>)}</ErpSelect></label>
            <label><span className="mb-2 block text-sm">ماهیت</span><ErpSelect value={account.normalSide} onChange={(event) => setAccount({ ...account, normalSide: event.target.value })}><option value="DEBIT">بدهکار</option><option value="CREDIT">بستانکار</option></ErpSelect></label>
            <label><span className="mb-2 block text-sm">نقش صورت مالی</span><ErpSelect value={account.statementRole} onChange={(event) => setAccount({ ...account, statementRole: event.target.value })}><option value="ASSET">دارایی</option><option value="LIABILITY">بدهی</option><option value="EQUITY">حقوق مالکانه</option><option value="REVENUE">درآمد</option><option value="EXPENSE">هزینه</option><option value="MEMO">انتظامی</option></ErpSelect></label>
            <label><span className="mb-2 block text-sm">حساب کاهنده مرتبط</span><ErpSelect value={account.contraAccountId} onChange={(event) => setAccount({ ...account, contraAccountId: event.target.value })}><option value="">بدون حساب کاهنده</option>{accounts.filter((item: any) => item.id !== account.parentId).map((item: any) => <option key={item.id} value={item.id}>{item.code} · {item.titlePersian}</option>)}</ErpSelect></label>
            {account.level === 'MOIN' && <label><span className="mb-2 block text-sm">قاعده طرف حساب</span><ErpSelect value={account.partyRequirement} onChange={(event) => setAccount({ ...account, partyRequirement: event.target.value })}><option value="FORBIDDEN">ممنوع</option><option value="OPTIONAL">اختیاری</option><option value="REQUIRED">اجباری</option></ErpSelect></label>}
            {account.level === 'MOIN' && <label><span className="mb-2 block text-sm">قاعده حساب مالی</span><ErpSelect value={account.financialAccountRequirement} onChange={(event) => setAccount({ ...account, financialAccountRequirement: event.target.value })}><option value="FORBIDDEN">ممنوع</option><option value="OPTIONAL">اختیاری</option><option value="REQUIRED">اجباری</option></ErpSelect></label>}
            <label><span className="mb-2 block text-sm">تاریخ اثر</span><ErpInput type="date" value={account.effectiveFrom} onChange={(event) => setAccount({ ...account, effectiveFrom: event.target.value })} /></label>
          </div>
          {account.level === 'MOIN' && dimensionTypes.length > 0 && <div className="mt-4 grid gap-2 md:grid-cols-2">{dimensionTypes.map((item: any) => <label key={item.id}><span className="mb-2 block text-sm">قاعده بُعد «{item.titlePersian}»</span><ErpSelect value={account.dimensionRules[item.id] || ''} onChange={(event) => setAccount((current: any) => ({ ...current, dimensionRules: { ...current.dimensionRules, [item.id]: event.target.value } }))}><option value="">اعمال نمی‌شود</option><option value="REQUIRED">اجباری</option><option value="OPTIONAL">اختیاری</option><option value="FORBIDDEN">ممنوع</option></ErpSelect></label>)}</div>}
          <div className="mt-4 flex justify-end"><ErpButton label="افزودن حساب" disabled={saving || !account.code || !account.titlePersian || !account.effectiveFrom || (account.level !== 'GROUP' && !account.parentId)} onClick={() => run(() => accountingAPI.createLedgerAccount({ ...account, bookId: book.id, codeSchemeId: scheme.id, parentId: account.parentId || undefined, dimensionRules: Object.entries(account.dimensionRules || {}).filter(([, requirement]) => requirement).map(([dimensionTypeId, requirement]) => ({ dimensionTypeId, requirement })) }), 'حساب به نسخه کدینگ افزوده شد.')} /></div>
        </ErpSection>
        <ErpSection title="درخت حساب‌ها">{accounts.length === 0 ? <ErpEmptyState title="هنوز حسابی تعریف نشده است." /> : <div className="grid gap-2 md:grid-cols-2">{accounts.map((item: any) => <ErpCard key={item.id} className="p-3"><div className="flex items-center justify-between gap-3"><strong>{item.code} · {item.titlePersian}</strong><ErpBadge tone={item.retiredAt ? 'warning' : 'info'}>{item.retiredAt ? 'غیرفعال' : levelFa[item.level]}</ErpBadge></div></ErpCard>)}</div>}</ErpSection>
        <ErpSection title="ابعاد و تفصیلی‌ها">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label><span className="mb-2 block text-sm">کد بُعد</span><ErpInput value={dimension.code} onChange={(event) => setDimension({ ...dimension, code: event.target.value })} /></label><label><span className="mb-2 block text-sm">عنوان فارسی بُعد</span><ErpInput value={dimension.titlePersian} onChange={(event) => setDimension({ ...dimension, titlePersian: event.target.value })} /></label><label><span className="mb-2 block text-sm">منبع</span><ErpInput value={dimension.sourceKind} onChange={(event) => setDimension({ ...dimension, sourceKind: event.target.value })} /></label><label><span className="mb-2 block text-sm">تاریخ اثر</span><ErpInput type="date" value={dimension.effectiveFrom} onChange={(event) => setDimension({ ...dimension, effectiveFrom: event.target.value })} /></label></div>
          <div className="mt-3 flex justify-end"><ErpButton label="افزودن بُعد" disabled={!dimension.code || !dimension.titlePersian || !dimension.effectiveFrom} onClick={() => run(() => accountingAPI.createLedgerDimension({ ...dimension, bookId: book.id }), 'بُعد حسابداری ایجاد شد.')} /></div>
          {dimensionTypes.length > 0 && <><div className="my-4 border-t border-[var(--sds-border-default)]" /><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label><span className="mb-2 block text-sm">بُعد</span><ErpSelect value={dimensionMember.dimensionTypeId} onChange={(event) => setDimensionMember({ ...dimensionMember, dimensionTypeId: event.target.value })}><option value="">انتخاب بُعد</option>{dimensionTypes.map((item: any) => <option key={item.id} value={item.id}>{item.titlePersian}</option>)}</ErpSelect></label><label><span className="mb-2 block text-sm">شناسه منبع</span><ErpInput value={dimensionMember.sourceId} onChange={(event) => setDimensionMember({ ...dimensionMember, sourceId: event.target.value })} /></label><label><span className="mb-2 block text-sm">عنوان فارسی تفصیلی</span><ErpInput value={dimensionMember.titlePersian} onChange={(event) => setDimensionMember({ ...dimensionMember, titlePersian: event.target.value })} /></label><label><span className="mb-2 block text-sm">تاریخ اثر</span><ErpInput type="date" value={dimensionMember.effectiveFrom} onChange={(event) => setDimensionMember({ ...dimensionMember, effectiveFrom: event.target.value })} /></label></div><div className="mt-3 flex justify-end"><ErpButton label="افزودن تفصیلی" disabled={!dimensionMember.dimensionTypeId || !dimensionMember.sourceId || !dimensionMember.titlePersian || !dimensionMember.effectiveFrom} onClick={() => run(() => accountingAPI.createLedgerDimensionMember(dimensionMember.dimensionTypeId, dimensionMember), 'تفصیلی به بُعد افزوده شد.')} /></div></>}
        </ErpSection>
      </>}

      {tab === 'settings' && <>
        <ErpSection title="سلامت زنجیره حسابرسی" description="اثر انگشت همه رویدادهای موفق و ردشده، به‌ترتیب بررسی می‌شود."><div className="flex flex-wrap items-center justify-between gap-3">{auditHealth ? <ErpBadge tone={auditHealth.valid ? 'success' : 'danger'}>{auditHealth.valid ? `سالم · ${Number(auditHealth.checkedEntries).toLocaleString('fa-IR')} رویداد` : `اختلال در ردیف ${digits(auditHealth.failedSequence)}`}</ErpBadge> : <span className="text-sm text-[var(--sds-text-muted)]">هنوز بررسی نشده است.</span>}<ErpButton label="بررسی زنجیره حسابرسی" variant="outline" onClick={async () => { try { const response = await accountingAPI.verifyLedgerAuditChain(); setAuditHealth(response.data.data); } catch (error: any) { setMessage({ kind: 'error', title: error.response?.data?.error || 'بررسی زنجیره حسابرسی ناموفق بود.' }); } }} /></div></ErpSection>
        <ErpSection title="هویت دفتر"><div className="grid gap-3 md:grid-cols-2"><ErpCard className="p-4"><span className="text-xs text-[var(--sds-text-muted)]">واحد گزارشگر</span><strong className="mt-2 block">{context.namePersian}</strong><span className="mt-1 block text-sm">شناسه ملی: {context.nationalId || 'ثبت نشده'}</span></ErpCard><ErpCard className="p-4"><span className="text-xs text-[var(--sds-text-muted)]">دفتر اصلی</span><strong className="mt-2 block">{book.namePersian}</strong><span className="mt-1 block text-sm">ارز پایه: ریال</span></ErpCard></div></ErpSection>
        <ErpSection title="تعریف سال مالی سفارشی" description="دوره‌های عادی باید تمام بازه سال مالی را بدون فاصله و هم‌پوشانی پوشش دهند.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label><span className="mb-2 block text-sm">کد سال مالی</span><ErpInput value={fiscal.code} onChange={(event) => setFiscal({ ...fiscal, code: event.target.value })} /></label>
            <label><span className="mb-2 block text-sm">عنوان فارسی</span><ErpInput value={fiscal.titlePersian} onChange={(event) => setFiscal({ ...fiscal, titlePersian: event.target.value })} /></label>
            <label><span className="mb-2 block text-sm">شروع سال</span><ErpInput type="date" value={fiscal.startsAt} onChange={(event) => setFiscal({ ...fiscal, startsAt: event.target.value })} /></label>
            <label><span className="mb-2 block text-sm">پایان سال</span><ErpInput type="date" value={fiscal.endsAt} onChange={(event) => setFiscal({ ...fiscal, endsAt: event.target.value })} /></label>
          </div>
          <div className="mt-4 space-y-3">{fiscal.periods.map((period, index) => <ErpCard key={index} className="p-3"><div className="grid gap-3 md:grid-cols-3"><label><span className="mb-2 block text-sm">عنوان دوره {Number(index + 1).toLocaleString('fa-IR')}</span><ErpInput value={period.titlePersian} onChange={(event) => setFiscal((current) => ({ ...current, periods: current.periods.map((item, itemIndex) => itemIndex === index ? { ...item, titlePersian: event.target.value } : item) }))} /></label><label><span className="mb-2 block text-sm">شروع دوره</span><ErpInput type="date" value={period.startsAt} onChange={(event) => setFiscal((current) => ({ ...current, periods: current.periods.map((item, itemIndex) => itemIndex === index ? { ...item, startsAt: event.target.value } : item) }))} /></label><label><span className="mb-2 block text-sm">پایان دوره</span><ErpInput type="date" value={period.endsAt} onChange={(event) => setFiscal((current) => ({ ...current, periods: current.periods.map((item, itemIndex) => itemIndex === index ? { ...item, endsAt: event.target.value } : item) }))} /></label></div>{fiscal.periods.length > 1 && <div className="mt-2 flex justify-end"><ErpButton label="حذف دوره" tone="danger" variant="ghost" onClick={() => setFiscal((current) => ({ ...current, periods: current.periods.filter((_item, itemIndex) => itemIndex !== index) }))} /></div>}</ErpCard>)}</div>
          <div className="mt-4 flex flex-wrap justify-end gap-2"><ErpButton label="ساخت قالب ۱۲ دوره و تعدیلات" variant="outline" disabled={!fiscal.startsAt || !fiscal.endsAt} onClick={() => setFiscal((current) => ({ ...current, periods: twelvePeriodTemplate(current.startsAt, current.endsAt) }))} /><ErpButton label="افزودن دوره" variant="outline" onClick={() => setFiscal((current) => ({ ...current, periods: [...current.periods, { titlePersian: `دوره ${Number(current.periods.length + 1).toLocaleString('fa-IR')}`, startsAt: '', endsAt: '', isAdjustment: false }] }))} /><ErpButton label="افزودن دوره تعدیلات" variant="outline" disabled={!fiscal.endsAt} onClick={() => setFiscal((current) => ({ ...current, periods: [...current.periods, { titlePersian: 'دوره تعدیلات پایان سال', startsAt: current.endsAt, endsAt: current.endsAt, isAdjustment: true }] }))} /><ErpButton label="ثبت سال مالی" disabled={saving || !fiscal.code || !fiscal.titlePersian || !fiscal.startsAt || !fiscal.endsAt || fiscal.periods.some((item) => !item.titlePersian || !item.startsAt || !item.endsAt)} onClick={() => run(() => accountingAPI.createLedgerFiscalYear({ bookId: book.id, code: fiscal.code, titlePersian: fiscal.titlePersian, startsAt: `${fiscal.startsAt}T00:00:00.000Z`, endsAt: `${fiscal.endsAt}T23:59:59.999Z`, periods: fiscal.periods.map((item, index) => ({ code: String(index + 1), titlePersian: item.titlePersian, sequence: index + 1, startsAt: `${item.startsAt}T00:00:00.000Z`, endsAt: `${item.endsAt}T23:59:59.999Z`, isAdjustment: item.isAdjustment })) }), 'سال مالی و دوره‌های سفارشی ثبت شدند.')} /></div>
        </ErpSection>
        {year && <ErpSection title="وضعیت دوره‌ها" description="بستن قطعی برگشت مستقیم ندارد و پیش‌نویس باز را نمی‌پذیرد.">
          <label className="block"><span className="mb-2 block text-sm">دلیل تغییر وضعیت</span><ErpInput value={periodReason} onChange={(event) => setPeriodReason(event.target.value)} /></label>
          <div className="mt-4 grid gap-2 md:grid-cols-2">{year.periods.map((item: any) => <ErpCard key={item.id} className="p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{item.titlePersian}</strong><div className="mt-1"><ErpBadge tone={item.status === 'OPEN' ? 'success' : 'warning'}>{statusFa[item.status]}</ErpBadge></div></div><div className="flex flex-wrap gap-2">{item.status === 'OPEN' && <ErpButton label="بستن موقت" variant="outline" disabled={periodReason.trim().length < 8} onClick={() => run(() => accountingAPI.setLedgerPeriodStatus(item.id, { status: 'SOFT_CLOSED', reason: periodReason }), 'دوره به‌صورت موقت بسته شد.')} />}{item.status === 'SOFT_CLOSED' && <><ErpButton label="بازگشایی" variant="outline" disabled={periodReason.trim().length < 8} onClick={() => run(() => accountingAPI.setLedgerPeriodStatus(item.id, { status: 'OPEN', reason: periodReason }), 'دوره بازگشایی شد.')} /><ErpButton label="بستن قطعی" tone="danger" variant="outline" disabled={periodReason.trim().length < 8} onClick={() => run(() => accountingAPI.setLedgerPeriodStatus(item.id, { status: 'HARD_CLOSED', reason: periodReason }), 'دوره به‌صورت قطعی بسته شد.')} /></>}</div></div></ErpCard>)}</div>
        </ErpSection>}
        <ErpSection title="مدیریت دسترسی حسابداری" description="اعطا، انقضا و لغو سه سطح حسابداری فقط از مرجع واحد مدیریت دسترسی‌ها انجام می‌شود."><div className="flex justify-end"><ErpButton label="رفتن به مدیریت دسترسی‌ها" variant="outline" onClick={() => { window.location.href = '/dashboard/hr/permissions'; }} /></div></ErpSection>
      </>}
      <ErpSheet open={Boolean(evidenceDetail)} onClose={() => setEvidenceDetail(undefined)} title="شواهد و منشأ سند" presentation="modal" footer={<div className="flex justify-end"><ErpButton label="بستن" variant="outline" onClick={() => setEvidenceDetail(undefined)} /></div>}>
        {evidenceDetail && <div className="space-y-4 text-sm">
          <ErpCard className="p-3"><strong>منشأ سند</strong><div className="mt-2 grid gap-2"><span>نوع شاهد: {evidenceDetail.sourceType}</span><span>شناسه شاهد: {evidenceDetail.sourceId}</span><span>نسخه شاهد: {Number(evidenceDetail.sourceVersion).toLocaleString('fa-IR')}</span><span className="break-all">اثر انگشت منشأ: {evidenceDetail.sourceHash}</span></div></ErpCard>
          <ErpCard className="p-3"><strong>محتوای ثبت‌شده منشأ</strong><pre dir="ltr" className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-[var(--sds-radius-control)] bg-[var(--sds-surface-subtle)] p-3 text-xs">{JSON.stringify(evidenceDetail.sourcePayload, null, 2)}</pre></ErpCard>
          <div className="space-y-2">{evidenceDetail.lines?.map((line: any) => <ErpCard key={line.id} className="p-3"><strong>شاهد آرتیکل {Number(line.sequence).toLocaleString('fa-IR')}</strong><div className="mt-2 grid gap-2"><span>نوع شاهد: {line.evidenceType}</span><span>شناسه شاهد: {line.evidenceId}</span><span>نسخه شاهد: {Number(line.evidenceVersion).toLocaleString('fa-IR')}</span><span className="break-all">اثر انگشت شاهد: {line.evidenceHash}</span></div><pre dir="ltr" className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[var(--sds-radius-control)] bg-[var(--sds-surface-subtle)] p-3 text-xs">{JSON.stringify(line.evidencePayload, null, 2)}</pre></ErpCard>)}</div>
          <ErpInlineState kind="success" title="مشاهده این شواهد در سابقه حسابرسی ثبت شد." />
        </div>}
      </ErpSheet>
      <ErpSheet open={Boolean(postTarget)} onClose={() => { if (!saving) { setPostTarget(undefined); setPostReason(''); setPostOverride(false); setOverrideReason(''); } }} title="تأیید قطعی‌سازی سند" presentation="modal" pending={saving} footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" disabled={saving} onClick={() => setPostTarget(undefined)} /><ErpButton label="قطعی‌سازی" tone="success" disabled={saving || postReason.trim().length < 3 || (postOverride && overrideReason.trim().length < 8)} onClick={() => run(async () => { const response = await accountingAPI.postLedgerVoucher(postTarget.id, { reason: postReason.trim(), override: postOverride ? { confirmed: true, reason: overrideReason.trim() } : undefined }); if (createdVoucher?.id === postTarget.id) setCreatedVoucher(response.data.data); setPostTarget(undefined); setPostReason(''); setPostOverride(false); setOverrideReason(''); await refreshReports(); }, 'سند قطعی و شماره قانونی تخصیص داده شد.')} /></div>}>
        <p className="text-sm text-[var(--sds-text-secondary)]">پس از قطعی‌سازی، سند قابل ویرایش یا حذف نیست و اصلاح فقط با سند برگشت انجام می‌شود.</p>
        <label className="mt-4 block"><span className="mb-2 block text-sm">دلیل قطعی‌سازی</span><ErpInput value={postReason} onChange={(event) => setPostReason(event.target.value)} /></label>
        {canOverride && <div className="mt-4"><ErpCheckbox label="ثبت استثنایی در دوره بسته موقت" checked={postOverride} onChange={(event) => setPostOverride(event.target.checked)} />{postOverride && <label className="mt-3 block"><span className="mb-2 block text-sm">دلیل استثنا و تأیید دوباره</span><ErpInput value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label>}</div>}
      </ErpSheet>
      <ErpSheet open={Boolean(reverseTarget)} onClose={() => { if (!saving) { setReverseTarget(undefined); setReverseReason(''); setReverseDate(''); setEmergencyReverseConfirmed(false); } }} title="برگشت سند قطعی" presentation="modal" pending={saving} footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" disabled={saving} onClick={() => setReverseTarget(undefined)} /><ErpButton label="ایجاد سند برگشت" tone="danger" disabled={saving || reverseReason.trim().length < 8 || !reverseDate || !year?.id || !periodId || (context?.isGlobalAdmin === true && !canManage && !emergencyReverseConfirmed)} onClick={() => run(async () => { const emergency = context?.isGlobalAdmin === true && !canManage; await accountingAPI.reverseLedgerVoucher(reverseTarget.id, { reason: reverseReason.trim(), idempotencyKey: crypto.randomUUID(), targetFiscalYearId: year.id, targetPeriodId: periodId, documentDate: reverseDate, ...(emergency ? { override: { confirmed: emergencyReverseConfirmed, reason: reverseReason.trim() } } : {}) }); setReverseTarget(undefined); setReverseReason(''); setReverseDate(''); setEmergencyReverseConfirmed(false); await refreshReports(); }, 'سند برگشت مستقل و قطعی در دوره انتخاب‌شده ایجاد شد.')} /></div>}>
        <p className="text-sm text-[var(--sds-text-secondary)]">سند اصلی دست‌نخورده می‌ماند و سند معکوس در سال و دوره انتخاب‌شده بالای صفحه ثبت می‌شود؛ بنابراین اصلاح دوره بسته قطعی نیز وارد یک دوره باز می‌شود.</p>
        <label className="mt-4 block"><span className="mb-2 block text-sm">دلیل برگشت</span><ErpInput value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} /></label>
        <label className="mt-4 block"><span className="mb-2 block text-sm">تاریخ سند برگشت</span><ErpInput type="date" value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} /></label>
        {context?.isGlobalAdmin === true && !canManage && <div className="mt-4"><ErpCheckbox label="استفاده اضطراری از اختیار مدیر سامانه و ثبت کامل در سابقه حسابرسی را تأیید می‌کنم" checked={emergencyReverseConfirmed} onChange={(event) => setEmergencyReverseConfirmed(event.target.checked)} /></div>}
      </ErpSheet>
    </ErpPage>
  );
}
