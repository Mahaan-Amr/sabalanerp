'use client';

// Throwaway: three allocation layouts on the existing customer-account route, ?variant=A|B|C.
// All changes are in memory. This module imports no API client and sends no financial commands.
import { Fragment, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpCheckboxControl, ErpDisclosure, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpPersianDateField, ErpSegmentedControl, ErpSheet, ErpSummaryGrid, ErpTextarea } from '@/components/erp';
import PrototypeVariantSwitcher from '@/components/erp/PrototypeVariantSwitcher';
import { accountStatusLabels, normalizeAccountAmount, receiptIsCheck, receiptRemainingRials, type CustomerAccount } from '../customerAccountModel';
import { dateFa } from '../accountingUi';
import styles from './AllocationPrototype.module.css';

type Debt = { id: string; group: string; label: string; original: bigint; remaining: bigint; due: string; overdue: boolean };
type Source = { id: string; label: string; remaining: bigint; note: string };
type Data = { groups: { id: string; label: string }[]; debts: Debt[]; sources: Source[] };
const zero = BigInt(0);
const ten = BigInt(10);
const number = (value: bigint) => value.toLocaleString('fa-IR');
const tomanText = (value: bigint): string => value < zero ? `−${tomanText(-value)}` : `${number(value / ten)}${value % ten ? `٫${number(value % ten)}` : ''}`;
const money = (value: bigint) => `${tomanText(value)} تومان`;
const inputText = (value: bigint) => `${value / ten}${value % ten ? `.${value % ten}` : ''}`;
function parse(value: string): bigint | null {
  const normalized = normalizeAccountAmount(value).replace(/٫/g, '.');
  if (!normalized) return zero;
  if (!/^\d+(?:\.\d)?$/.test(normalized)) return null;
  const [whole, fraction = '0'] = normalized.split('.');
  return BigInt(whole) * ten + BigInt(fraction);
}
function fromAccount(account: CustomerAccount): Data {
  const groups = account.contracts.map(row => ({ id: row.id, label: `قرارداد ${row.contractNumber} · ${row.titlePersian}` }));
  const debts = account.openItems.filter(row => row.kind === 'RECEIVABLE' && BigInt(row.remainingRials) > zero).map(row => ({ id: row.id, group: row.contractId || 'independent', label: row.invoiceNumber || row.description || 'قلم قطعی', original: BigInt(row.originalRials), remaining: BigInt(row.remainingRials), due: row.dueAt, overdue: row.agingDays > 0 }));
  for (const debt of debts) if (!groups.some(row => row.id === debt.group)) groups.push({ id: debt.group, label: debt.group === 'independent' ? 'بدهی‌های مستقل و افتتاحیه' : 'قرارداد تاریخی' });
  const sources = account.receipts.filter(row => BigInt(receiptRemainingRials(row)) > zero).filter(row => {
    if (!receiptIsCheck(row)) return true;
    const check = account.treasuryChecks.find(check => check.id === (row.checkInstrumentId || row.source?.id));
    return Boolean(check && !['BOUNCED', 'RETURNED', 'CANCELLED', 'REPLACED'].includes(check.status) && row.checkInstrumentId);
  }).map(row => ({ id: `receipt:${row.id}`, label: `${accountStatusLabels[row.componentKind || 'BANK'] || 'دریافت'} · ${dateFa(row.occurredAt)}`, remaining: BigInt(receiptRemainingRials(row)), note: receiptIsCheck(row) ? 'اعتبار چک؛ تخصیص به معنی وصول نیست' : 'مانده دریافت ثبت‌شده' }));
  sources.push(...account.openItems.filter(row => row.kind === 'CREDIT' && BigInt(row.remainingRials) > zero).map(row => ({ id: `credit:${row.id}`, label: `بستانکاری · ${row.invoiceNumber}`, remaining: BigInt(row.remainingRials), note: 'اعتبار مستقل؛ بدون دریافت تازه' })));
  return { groups, debts, sources };
}
const demo: Data = {
  groups: [{ id: 'c1', label: 'قرارداد ۱۰۰۱۸۵ · سنگ نمای پروژه نیاوران' }, { id: 'c2', label: 'قرارداد ۱۰۰۱۸۴ · پله و پاگرد' }, { id: 'c3', label: 'قرارداد ۱۰۰۱۸۳ · کف لابی' }, { id: 'c4', label: 'قرارداد ۱۰۰۱۸۲ · محوطه‌سازی' }, { id: 'independent', label: 'بدهی‌های مستقل و افتتاحیه' }],
  debts: [
    { id: 'd1', group: 'c1', label: 'فاکتور ۹۸۷ · مانده افتتاحیه', original: BigInt('1000000000'), remaining: BigInt('700000000'), due: '2026-10-15', overdue: true },
    { id: 'd2', group: 'c1', label: 'فاکتور ۱۰۱۲ · ارسال دوم', original: BigInt('250000000'), remaining: BigInt('250000000'), due: '2026-11-05', overdue: false },
    { id: 'd3', group: 'c2', label: 'فاکتور ۹۹۶', original: BigInt('450000000'), remaining: BigInt('180000000'), due: '2026-10-20', overdue: true },
    { id: 'd4', group: 'c3', label: 'فاکتور ۱۰۰۳', original: BigInt('320000000'), remaining: BigInt('320000000'), due: '2026-11-10', overdue: false },
    { id: 'd5', group: 'independent', label: 'بدهکاری مستقل · هزینه حمل توافق‌شده', original: BigInt('15000001'), remaining: BigInt('15000001'), due: '2026-10-24', overdue: true },
  ],
  sources: [
    { id: 's1', label: 'واریز بانکی · رسید ۲۴۱', remaining: BigInt('500000000'), note: '۱۴۰۵/۰۷/۲۹ · بانک ملت' },
    { id: 's2', label: 'چک ۸۲۳۱۴ · دریافت‌شده', remaining: BigInt('300000000'), note: 'سررسید ۱۴۰۵/۰۹/۱۰ · هنوز وصول نشده' },
    { id: 's3', label: 'بستانکاری مستقل · تخفیف توافقی', remaining: BigInt('100000000'), note: 'سند ۴۰۲ · بدون دریافت نقدی' },
  ],
};
const variants = [{ key: 'A', label: 'جدول قابل ویرایش' }, { key: 'B', label: 'جدول و پنل منابع' }, { key: 'C', label: 'انتخاب و تخصیص گروهی' }];

export default function CustomerAllocationPrototype({ account, variant }: { account: CustomerAccount; variant: string }) {
  const searchParams = useSearchParams();
  const [dataset, setDataset] = useState<'live' | 'demo'>(() => searchParams.get('sample') === 'demo' ? 'demo' : 'live');
  return <div className={styles.workspace}>
    <div className={styles.header}><div><h2 className={styles.heading}>تخصیص به بدهی‌های مشتری</h2><p className={styles.subtitle}>نمونه تعاملی · همه مبالغ به تومان · هیچ ثبت مالی انجام نمی‌شود</p></div>
      <ErpSegmentedControl value={dataset} onChange={setDataset} options={[{ value: 'live', label: 'اطلاعات همین مشتری' }, { value: 'demo', label: 'داده آموزشی چندقراردادی' }]} />
    </div>
    <AllocationPlayground key={dataset} data={dataset === 'demo' ? demo : fromAccount(account)} variant={variant} canAllocate={dataset === 'demo' || account.capabilities.canManageTreasury} />
    <PrototypeVariantSwitcher variants={variants} current={variant} />
  </div>;
}

function AllocationPlayground({ data, variant, canAllocate }: { data: Data; variant: string; canAllocate: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [review, setReview] = useState(false);
  const [compose, setCompose] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date()));
  const [usedDebts, setUsedDebts] = useState<Record<string, bigint>>({});
  const [usedSources, setUsedSources] = useState<Record<string, bigint>>({});
  const [success, setSuccess] = useState('');
  const debtRemaining = (debt: Debt) => debt.remaining - (usedDebts[debt.id] || zero);
  const sourceRemaining = (source: Source) => source.remaining - (usedSources[source.id] || zero);
  const sourceBudget = (source: Source) => parse(budgets[source.id] ?? inputText(sourceRemaining(source)));
  const activeDebts = data.debts.filter(row => selected.includes(row.id));
  const total = activeDebts.reduce((sum, row) => sum + (parse(amounts[row.id] || '') ?? zero), zero);
  const capacity = data.sources.filter(row => enabled.includes(row.id)).reduce((sum, row) => sum + (sourceBudget(row) ?? zero), zero);
  const invalid = activeDebts.some(row => parse(amounts[row.id] || '') === null || (parse(amounts[row.id] || '') ?? zero) > debtRemaining(row)) || data.sources.some(row => enabled.includes(row.id) && (sourceBudget(row) === null || (sourceBudget(row) ?? zero) > sourceRemaining(row))) || total > capacity;
  let available = data.sources.filter(row => enabled.includes(row.id)).map(row => ({ ...row, free: sourceBudget(row) ?? zero }));
  const shares = activeDebts.flatMap(debt => {
    let needed = parse(amounts[debt.id] || '') ?? zero;
    return available.flatMap(source => {
      const amount = needed < source.free ? needed : source.free;
      source.free -= amount; needed -= amount;
      return amount > zero ? [{ sourceId: source.id, debtId: debt.id, amount }] : [];
    });
  });
  const hasPlan = total > zero && !invalid;
  function change() { setConfirmed(false); setSuccess(''); }
  function fill() {
    let left = capacity;
    const next = { ...amounts };
    for (const row of activeDebts) { const amount = debtRemaining(row) < left ? debtRemaining(row) : left; next[row.id] = inputText(amount); left -= amount; }
    setAmounts(next); change();
  }
  function toggle(id: string, checked: boolean) { setSelected(rows => checked ? [...rows, id] : rows.filter(row => row !== id)); change(); }
  function reset() { setSelected([]); setAmounts({}); setBudgets({}); setEnabled([]); setUsedDebts({}); setUsedSources({}); setSuccess(''); setConfirmed(false); }
  function simulate() {
    if (!hasPlan || !confirmed || !reason.trim() || !reference.trim() || !date || !canAllocate) return;
    const nextDebts = { ...usedDebts }; const nextSources = { ...usedSources };
    for (const share of shares) { nextDebts[share.debtId] = (nextDebts[share.debtId] || zero) + share.amount; nextSources[share.sourceId] = (nextSources[share.sourceId] || zero) + share.amount; }
    setUsedDebts(nextDebts); setUsedSources(nextSources); setAmounts({}); setSelected([]); setBudgets({}); setConfirmed(false); setReview(false); setCompose(false);
    setSuccess(`تخصیص ${money(total)} فقط در این نمونه شبیه‌سازی شد؛ مانده‌های زیر به‌روز شدند.`);
  }
  const summary = <ErpSummaryGrid columns={3} items={[{ label: 'بدهی باز', value: money(data.debts.reduce((sum, row) => sum + debtRemaining(row), zero)) }, { label: 'منابع قابل تخصیص', value: money(data.sources.reduce((sum, row) => sum + sourceRemaining(row), zero)) }, { label: 'تخصیص این‌بار', value: money(total) }]} />;
  const sourcePanel = <div className={variant === 'A' ? styles.sourceBudgets : styles.sources}>
    {!data.sources.length && <ErpEmptyState title="منبع قابل تخصیص وجود ندارد" />}
    {data.sources.map(source => { const used = shares.filter(row => row.sourceId === source.id).reduce((sum, row) => sum + row.amount, zero); return <div key={source.id} className={styles.source}>
      <div className={styles.sourceTop}><ErpCheckbox checked={enabled.includes(source.id)} disabled={!canAllocate || sourceRemaining(source) === zero} onChange={event => { setEnabled(rows => event.target.checked ? [...rows, source.id] : rows.filter(id => id !== source.id)); change(); }} label={source.label} /><ErpBadge tone="neutral">{money(sourceRemaining(source))}</ErpBadge></div>
      <p className={styles.sourcesCount}>{source.note}</p>
      {enabled.includes(source.id) && <><ErpField label="سقف مصرف این منبع · تومان"><ErpInput numberFormat="money" aria-label={`سقف ${source.label}`} value={budgets[source.id] ?? inputText(sourceRemaining(source))} onChange={event => { setBudgets(rows => ({ ...rows, [source.id]: event.target.value })); change(); }} /></ErpField><p className={styles.sourcesCount}>مصرف این‌بار: {money(used)} · پس از تخصیص: {money(sourceRemaining(source) - used)}</p></>}
    </div>; })}
    <p className={styles.sourcesCount}>سهم‌ها به ترتیب نمایش منابع پیشنهاد می‌شوند؛ پیش از تأیید قابل بررسی‌اند.</p>
  </div>;
  function table(editable: boolean) {
    const groups = data.groups.filter(group => `${group.label} ${data.debts.filter(row => row.group === group.id).map(row => row.label).join(' ')}`.includes(search));
    return <div className={styles.tableWrap}><table className={`${styles.table} ${variant === 'B' ? styles.compact : ''}`}><caption className="sr-only">بدهی‌های قطعی گروه‌بندی‌شده بر اساس قرارداد؛ مبالغ به تومان</caption><thead><tr><th>انتخاب</th><th>بدهی / مدرک</th><th>سررسید</th><th>اصل بدهی</th><th>تخصیص قبلی</th><th>مانده</th>{editable && <><th>تخصیص این‌بار</th><th>مانده بعد</th></>}<th>عملیات</th></tr></thead><tbody>
      {groups.map(group => { const debts = data.debts.filter(row => row.group === group.id); return <Fragment key={group.id}>
        <tr className={styles.group}><td colSpan={editable ? 9 : 7}><strong>{group.label}</strong></td></tr>
        {!debts.length && <tr><td colSpan={editable ? 9 : 7}><span className="sds-text-muted">بدهی قطعی قابل تخصیص ندارد</span></td></tr>}
        {debts.map(debt => { const value = parse(amounts[debt.id] || ''); const after = debtRemaining(debt) - (selected.includes(debt.id) ? value ?? zero : zero); return <tr key={debt.id} className={selected.includes(debt.id) ? styles.selected : undefined}>
          <td><label className="inline-flex min-h-11 min-w-11 items-center justify-center"><ErpCheckboxControl aria-label={`انتخاب ${debt.label}`} checked={selected.includes(debt.id)} disabled={!canAllocate || debtRemaining(debt) === zero} onChange={event => toggle(debt.id, event.target.checked)} /></label></td>
          <td><strong>{debt.label}</strong></td><td data-label="سررسید:">{dateFa(debt.due)} {debt.overdue && debtRemaining(debt) > zero && <ErpBadge tone="warning">معوق</ErpBadge>}</td>
          <td data-label="اصل بدهی:" className={styles.money}>{tomanText(debt.original)}</td><td data-label="تخصیص قبلی:" className={styles.money}>{tomanText(debt.original - debtRemaining(debt))}</td><td data-label="مانده:" className={styles.money}>{tomanText(debtRemaining(debt))}</td>
          {editable && <><td className={styles.amount}><ErpInput numberFormat="money" aria-label={`تخصیص ${debt.label}`} disabled={!canAllocate || !selected.includes(debt.id)} value={amounts[debt.id] || ''} placeholder="تومان" onChange={event => { setAmounts(rows => ({ ...rows, [debt.id]: event.target.value })); change(); }} />{selected.includes(debt.id) && (value === null || after < zero) && <span className={styles.warning}>مبلغ معتبر تا سقف مانده وارد کنید</span>}</td><td data-label="مانده بعد:" className={styles.money}>{after < zero ? 'بیش از مانده' : tomanText(after)}</td></>}
          <td><ErpButton label="تخصیص" variant="ghost" disabled={!canAllocate || debtRemaining(debt) === zero} onClick={() => { if (!selected.includes(debt.id)) toggle(debt.id, true); if (variant === 'C') setCompose(true); }} /></td>
        </tr>; })}
      </Fragment>; })}
      {!groups.length && <tr><td colSpan={editable ? 9 : 7}>موردی پیدا نشد</td></tr>}
    </tbody></table></div>;
  }
  const filters = <div className={styles.toolbar}><ErpField label="جستجوی قرارداد یا مدرک"><ErpInput type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="شماره یا عنوان" /></ErpField><div className="flex flex-wrap gap-2"><ErpButton label="انتخاب همه بدهی‌ها" tone="neutral" disabled={!canAllocate} onClick={() => { setSelected(data.debts.filter(row => debtRemaining(row) > zero && `${data.groups.find(group => group.id === row.group)?.label} ${row.label}`.includes(search)).map(row => row.id)); change(); }} /><ErpButton label="پاک‌کردن انتخاب" variant="ghost" onClick={() => { setSelected([]); setAmounts({}); change(); }} /></div></div>;
  const actions = <div className={styles.footer}><span>{selected.length.toLocaleString('fa-IR')} بدهی انتخاب‌شده · {money(total)}</span><div className="flex flex-wrap gap-2"><ErpButton label="تکمیل مانده انتخاب‌شده" disabled={!canAllocate || !selected.length || capacity === zero || invalid && total === zero} onClick={fill} tone="neutral" /><ErpButton label="بررسی تخصیص" variant="solid" disabled={!canAllocate || !hasPlan} onClick={() => { setReview(true); setConfirmed(false); }} /></div></div>;
  const reviewContent = <div className={styles.review}>
    <ErpSummaryGrid columns={3} items={[{ label: 'جمع تخصیص', value: money(total) }, { label: 'تعداد بدهی', value: activeDebts.filter(row => (parse(amounts[row.id] || '') ?? zero) > zero).length.toLocaleString('fa-IR') }, { label: 'مانده منابع منتخب پس از تخصیص', value: money(data.sources.filter(row => enabled.includes(row.id)).reduce((sum, row) => sum + sourceRemaining(row), zero) - total) }]} />
    <h3 className="font-bold">سهم منابع و مانده بدهی‌ها</h3>
    {activeDebts.filter(row => (parse(amounts[row.id] || '') ?? zero) > zero).map(debt => <ErpCard key={debt.id} className="p-4"><strong>{data.groups.find(group => group.id === debt.group)?.label} / {debt.label}</strong><p className={styles.subtitle}>{money(debtRemaining(debt))} ← {money(debtRemaining(debt) - (parse(amounts[debt.id]) ?? zero))}</p>{shares.filter(row => row.debtId === debt.id).map(share => <div key={share.sourceId} className={styles.share}><span>{data.sources.find(row => row.id === share.sourceId)?.label}</span><strong>{money(share.amount)}</strong></div>)}</ErpCard>)}
    <ErpPersianDateField label="تاریخ عملیات نمونه" valueFormat="iso-date" value={date} onChange={value => { setDate(value); change(); }} required />
    <ErpField label="شرح مشترک"><ErpTextarea value={reason} onChange={event => { setReason(event.target.value); change(); }} /></ErpField>
    <ErpField label="مرجع مستندات"><ErpInput value={reference} onChange={event => { setReference(event.target.value); change(); }} /></ErpField>
    <ErpCheckbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)} label="مبلغ بدهی‌ها و سهم دقیق منابع را بررسی و تأیید می‌کنم." />
    <p className={styles.sourcesCount}>این تأیید فقط شبیه‌سازی است. مانده خالص حساب با تخصیص تغییر نمی‌کند.</p>
  </div>;
  return <>
    {summary}
    {!canAllocate && <ErpInlineState kind="empty" title="این حساب دسترسی تخصیص ندارد؛ برای مقایسه تعاملی، داده آموزشی را انتخاب کنید." />}
    {success && <ErpInlineState kind="success" title={success} />}
    {variant === 'A' && <VariantA sources={<ErpDisclosure title={`منابع تخصیص · ${enabled.length.toLocaleString('fa-IR')} منبع انتخاب‌شده`} expanded>{sourcePanel}</ErpDisclosure>} filters={filters} table={table(true)} actions={actions} />}
    {variant === 'B' && <VariantB table={<ErpCard>{filters}{table(true)}</ErpCard>} panel={<ErpCard className="p-4"><h3 className="mb-3 font-bold">منابع وجه</h3>{sourcePanel}<div className="mt-4">{actions}</div></ErpCard>} />}
    {variant === 'C' && <VariantC filters={filters} table={table(false)} selected={selected.length} onCompose={() => setCompose(true)} disabled={!canAllocate || !selected.length} />}
    {invalid && <ErpInlineState kind="error" title="مبلغ تخصیص یا سقف منبع نامعتبر است؛ جمع تخصیص نباید از مانده بدهی‌ها یا منابع منتخب بیشتر باشد." />}
    <ErpSheet open={compose && variant === 'C'} onClose={() => setCompose(false)} title="تخصیص گروهی به بدهی‌های منتخب" presentation="modal" size="wide" footer={actions}>
      <div className="grid gap-5"><ErpDisclosure title="انتخاب منابع وجه" expanded>{sourcePanel}</ErpDisclosure>
        {activeDebts.map(debt => <ErpField key={debt.id} label={`${data.groups.find(row => row.id === debt.group)?.label} / ${debt.label}`} hint={`مانده ${money(debtRemaining(debt))}`}><ErpInput numberFormat="money" aria-label={`تخصیص ${debt.label}`} value={amounts[debt.id] || ''} placeholder="تومان" onChange={event => { setAmounts(rows => ({ ...rows, [debt.id]: event.target.value })); change(); }} /></ErpField>)}
        {invalid && <ErpInlineState kind="error" title="مبالغ را در محدوده مانده بدهی و منابع منتخب اصلاح کنید." />}
      </div>
    </ErpSheet>
    <ErpSheet open={review} onClose={() => setReview(false)} title="بررسی و تأیید تخصیص نمونه" presentation="modal" size="wide" footer={<div className="flex flex-wrap gap-2"><ErpButton label="بازگشت و ویرایش" tone="neutral" onClick={() => setReview(false)} /><ErpButton label="تأیید و شبیه‌سازی تخصیص" variant="solid" disabled={!canAllocate || !hasPlan || !confirmed || !reason.trim() || !reference.trim() || !date} onClick={simulate} /></div>}>{reviewContent}</ErpSheet>
    <div className="flex flex-wrap justify-between gap-3"><span className={styles.sourcesCount}>انتخاب‌ها و مبالغ با تغییر طرح حفظ می‌شوند؛ بازخوانی صفحه آن‌ها را پاک می‌کند.</span><ErpButton label="شروع دوباره نمونه" variant="ghost" onClick={reset} /></div>
    <ErpDisclosure title="وضعیت پیش‌نویس نمونه"><pre className={styles.draft}>{JSON.stringify({ variant, selected, amountsToman: amounts, sourceBudgetsToman: budgets, enabledSources: enabled, sharesRials: shares.map(row => ({ ...row, amount: row.amount.toString() })), simulatedDebtUse: Object.fromEntries(Object.entries(usedDebts).map(([key, value]) => [key, value.toString()])), simulatedSourceUse: Object.fromEntries(Object.entries(usedSources).map(([key, value]) => [key, value.toString()])) }, null, 2)}</pre></ErpDisclosure>
  </>;
}

type Slot = import('react').ReactNode;
export function VariantA({ sources, filters, table, actions }: { sources: Slot; filters: Slot; table: Slot; actions: Slot }) {
  return <div className="grid gap-4">{sources}<ErpCard>{filters}{table}{actions}</ErpCard></div>;
}
export function VariantB({ table, panel }: { table: Slot; panel: Slot }) {
  return <div className={styles.split}><div className="min-w-0">{table}</div><aside className={styles.sticky} aria-label="منابع تخصیص">{panel}</aside></div>;
}
export function VariantC({ filters, table, selected, onCompose, disabled }: { filters: Slot; table: Slot; selected: number; onCompose: () => void; disabled: boolean }) {
  return <ErpCard>{filters}{table}<div className={styles.footer}><span>{selected.toLocaleString('fa-IR')} بدهی انتخاب‌شده</span><ErpButton label="تخصیص به انتخاب‌شده‌ها" variant="solid" disabled={disabled} onClick={onCompose} /></div></ErpCard>;
}
