'use client';

// Three customer-account variants on the existing route via ?variant=A|B|C.
// Read-only live data; every action is an in-memory design demonstration.
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FaArrowDown, FaCheckCircle, FaExchangeAlt, FaFileInvoice, FaSearch, FaWallet } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpDisclosure, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpPresentationProvider, ErpSection, ErpSegmentedControl, ErpSheet, ErpSummaryGrid, ErpWorkspacePage } from '@/components/erp';
import PrototypeSwitcher from '@/components/prototype/PrototypeSwitcher';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { accountBalanceLabel, accountMoney, receiptRemainingRials, type CustomerAccount, type AccountItem } from '../customerAccountModel';
import { dateFa } from '../accountingUi';
import { recordForPostedItem } from '../customerPostedLinks';
import styles from './customerFinancePrototype.module.css';

const variants = [{ key: 'A', name: 'نمای تحلیلی' }, { key: 'B', name: 'میز عملیات' }, { key: 'C', name: 'مسیر پول' }];
type Props = { account: CustomerAccount };
type ViewProps = Props & { open: (action: string) => void; query: string; overdueOnly: boolean };
const money = (value: string) => accountMoney(value);
const positive = (value: string) => BigInt(value) > BigInt(0);
const debitItems = (account: CustomerAccount) => account.activityItems.filter(row => row.kind === 'RECEIVABLE');
const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), BigInt(0)).toString();
function matches(account: CustomerAccount, row: AccountItem, query: string) { return `${row.description || ''} ${row.invoiceNumber} ${recordForPostedItem(account, row)?.systemInvoiceNumber || ''} ${contractLabel(account, row)}`.includes(query); }
function contractLabel(account: CustomerAccount, item: AccountItem) { return account.contracts.find(row => row.id === item.contractId)?.contractNumber || 'مستقل از قرارداد'; }

function Position({ account }: Props) {
  const debt = account.debitOpenRials ?? account.receivableRials;
  const overdue = sum(debitItems(account).filter(row => row.agingDays > 0).map(row => row.remainingRials));
  return <ErpCard className={styles.position}>
    <div className={styles.balance}><span className={styles.eyebrow}>خالص وضعیت مالی · {accountBalanceLabel(account.netBalanceRials)}</span><strong>{money(account.netBalanceRials)}</strong><span className="text-sm sds-text-secondary">بدهی باز منهای اعتبارهای آزاد</span></div>
    <div className={styles.stat}><span>بدهی باز قطعی</span><strong>{money(debt)}</strong><ErpBadge tone={positive(overdue) ? 'danger' : 'neutral'}>{positive(overdue) ? `${money(overdue)} سررسید گذشته` : 'بدهی سررسیدگذشته ندارد'}</ErpBadge></div>
    <div className={styles.stat}><span>دریافت آماده تخصیص</span><strong className={styles.green}>{money(account.unallocatedCreditRials)}</strong><span className="text-xs sds-text-secondary">قابل استرداد نقدی: {money(account.refundableRials ?? '0')}</span></div>
  </ErpCard>;
}

function SettlementChart({ account }: Props) {
  const items = debitItems(account);
  const original = BigInt(sum(items.map(row => row.originalRials)));
  const remaining = BigInt(sum(items.map(row => row.remainingRials)));
  const consumed = original - remaining;
  const percent = original > BigInt(0) ? Number(consumed * BigInt(100) / original) : 0;
  return <div className={styles.chartWrap}>
    <div className={styles.donut} style={{ background: `conic-gradient(var(--sds-success) 0 ${percent}%, var(--sds-surface-subtle) ${percent}% 100%)` }} role="img" aria-label={`${percent.toLocaleString('fa-IR')} درصد از اقلام بدهکار تسویه یا مصرف شده`}><div><strong>{percent.toLocaleString('fa-IR')}٪</strong><span>تسویه / مصرف</span></div></div>
    <div className="space-y-3"><p className="font-semibold">از بدهی ثبت‌شده چقدر باقی مانده؟</p><p className={styles.green}>✓ تسویه / مصرف: {money(consumed.toString())}</p><p>◯ باز: {money(remaining.toString())}</p><p className="text-xs sds-text-secondary">مبنای نمودار اقلام قطعی دفتر است؛ مبلغ قرارداد وارد محاسبه نمی‌شود.</p></div>
  </div>;
}

function Aging({ account, open }: Props & { open: ViewProps['open'] }) {
  const buckets = [{ label: 'سررسید نرسیده / امروز', test: (n: number) => n <= 0 }, { label: '۱ تا ۳۰ روز', test: (n: number) => n > 0 && n <= 30 }, { label: '۳۱ تا ۶۰ روز', test: (n: number) => n > 30 && n <= 60 }, { label: 'بیش از ۶۰ روز', test: (n: number) => n > 60 }];
  const values = buckets.map(bucket => sum(debitItems(account).filter(row => bucket.test(row.agingDays)).map(row => row.remainingRials)));
  const max = values.reduce((value, next) => BigInt(next) > value ? BigInt(next) : value, BigInt(1));
  return <div className="space-y-4">{buckets.map((bucket, index) => <div key={bucket.label}><div className="mb-2 flex flex-wrap justify-between gap-2 text-sm"><span>{bucket.label}</span><strong>{money(values[index])}</strong></div><div className={styles.track}><div style={{ width: `${Number(BigInt(values[index]) * BigInt(100) / max)}%`, background: index === 0 ? 'var(--sds-accent)' : 'var(--sds-danger)' }} /></div></div>)}<ErpButton label="دیدن اقلام سررسیدگذشته" tone="danger" variant="outline" onClick={() => open('پیگیری سررسید')} /></div>;
}

function Items({ account, open, query, overdueOnly, readOnly = false }: ViewProps & { readOnly?: boolean }) {
  const rows = debitItems(account).filter(row => matches(account, row, query) && (!overdueOnly || row.agingDays > 0 && positive(row.remainingRials)));
  return <div className="space-y-3">{!rows.length && <ErpEmptyState title="قلمی با این فیلتر وجود ندارد" />}{rows.map(item => {
    const overdue = item.agingDays > 0 && positive(item.remainingRials);
    const settled = !positive(item.remainingRials);
    const shares = account.receipts.flatMap(receipt => receipt.allocations.filter(row => !row.reversedAt).flatMap(allocation => allocation.lines.filter(line => line.openItemId === item.id).map(line => ({ receipt, line, id: allocation.id }))));
    return <ErpCard key={item.id} className={styles.item} tone={overdue ? 'danger' : settled ? 'success' : 'neutral'}>
      <div className={styles.itemHeader}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{recordForPostedItem(account, item)?.systemInvoiceNumber ? `فاکتور ${recordForPostedItem(account, item)!.systemInvoiceNumber}` : item.invoiceNumber || 'قلم قطعی'}</strong><ErpBadge tone={overdue ? 'danger' : settled ? 'success' : 'info'}>{overdue ? 'سررسید گذشته' : settled ? 'تسویه‌شده' : 'باز'}</ErpBadge>{item.sourceKind === 'OPENING' && <ErpBadge tone="neutral">افتتاحیه</ErpBadge>}</div><p className="mt-2 text-xs sds-text-secondary">قرارداد {contractLabel(account, item)} · سررسید {dateFa(item.dueAt)}</p></div><div className={styles.remaining}><span>مانده قطعی</span><strong>{money(item.remainingRials)}</strong></div></div>
      <div className={styles.itemFoot}><span className="text-xs sds-text-secondary">اصل قلم {money(item.originalRials)} · تسویه / مصرف {money((BigInt(item.originalRials) - BigInt(item.remainingRials)).toString())}</span>{!readOnly && <div className="flex flex-wrap gap-2"><ErpButton label="تخصیص دریافت" icon={FaExchangeAlt} onClick={() => open('تخصیص دریافت')} disabled={!positive(account.unallocatedCreditRials) || settled} /><ErpButton label="جزئیات و منابع" tone="neutral" onClick={() => open(`جزئیات ${item.invoiceNumber}`)} /></div>}</div>
      {shares.length > 0 && <ErpDisclosure title={`${shares.length.toLocaleString('fa-IR')} منبع دریافت مرتبط`}><div className="space-y-2">{shares.map(({ receipt, line, id }) => <div key={`${receipt.id}:${id}`} className="flex flex-wrap justify-between gap-2 text-sm"><span>دریافت {dateFa(receipt.occurredAt)}</span><strong className={styles.green}>{money(line.amountRials)}</strong></div>)}</div></ErpDisclosure>}
    </ErpCard>;
  })}</div>;
}

export function VariantA(props: ViewProps) {
  return <div className="space-y-5"><Position account={props.account} /><div className={styles.analytics}><ErpSection title="پیشرفت تسویه"><SettlementChart account={props.account} /></ErpSection><ErpSection title="سن بدهی‌های باز"><Aging account={props.account} open={props.open} /></ErpSection></div><ErpSection title="اقلام قطعی و قراردادهای مرتبط" actions={[{ label: 'تخصیص اعتبار', onClick: () => props.open('تخصیص دریافت') }]}><Items {...props} /></ErpSection></div>;
}

export function VariantB(props: ViewProps) {
  const actions = [{ title: 'پول دریافت کردم', label: 'ثبت دریافت', icon: FaArrowDown, tone: 'success' as const, hint: 'نقد، بانک یا چک' }, { title: 'پول را به قرارداد وصل کنم', label: 'تخصیص دریافت', icon: FaExchangeAlt, tone: 'primary' as const, hint: 'انتخاب دریافت و بدهی مقصد' }, { title: 'مانده قبلی را منتقل کنم', label: 'مانده افتتاحیه', icon: FaFileInvoice, tone: 'neutral' as const, hint: 'با مانده و مدارک تأییدشده' }];
  return <div className={styles.desk}><aside className="space-y-4"><ErpSection title="می‌خواهم…"><div className="space-y-4">{actions.map(action => <div key={action.label} className={styles.task}><strong>{action.title}</strong><p className="my-2 text-xs sds-text-secondary">{action.hint}</p><ErpButton label={action.label} tone={action.tone} icon={action.icon} onClick={() => props.open(action.label)} /></div>)}</div></ErpSection><ErpDisclosure title="اصلاحات و عملیات بیشتر"><div className="flex flex-wrap gap-2">{['اصلاح دریافت', 'برگشت تخصیص', 'استرداد وجه', 'پیگیری چک', 'تطبیق انتساب افتتاحیه'].map(label => <ErpButton key={label} label={label} onClick={() => props.open(label)} tone="neutral" />)}</div></ErpDisclosure></aside><div className="min-w-0 space-y-5"><Position account={props.account} /><ErpSection title="میز رسیدگی"><Items {...props} /></ErpSection><ErpSection title="آخرین گردش‌ها"><div className="space-y-4">{props.account.movements.slice(0, 4).map(row => <div key={row.id} className={styles.activity}><FaCheckCircle className={styles.green} /><div><strong>{row.label}</strong><p className="mt-1 text-xs sds-text-secondary">{dateFa(row.at)} · مانده پس از رویداد {money(row.balance)}</p></div></div>)}</div></ErpSection></div></div>;
}

export function VariantC(props: ViewProps) {
  const [selected, setSelected] = useState(props.account.receipts[0]?.id || '');
  const receipt = props.account.receipts.find(row => row.id === selected);
  const allocations = receipt?.allocations.filter(row => !row.reversedAt).flatMap(row => row.lines) ?? [];
  return <div className="space-y-5"><Position account={props.account} /><ErpSection title="هر دریافت کجا مصرف شده؟" description="از دریافت شروع کنید؛ سهم هر بدهی و قرارداد در مسیر مشخص است."><div className={styles.flow}>
    <div className="min-w-0 space-y-3"><span className={styles.eyebrow}>۱ · منبع پول</span>{props.account.receipts.map(row => <ErpButton key={row.id} label={`${money(row.effectiveAmountRials ?? row.amountRials)} · ${dateFa(row.occurredAt)}`} icon={FaWallet} onClick={() => setSelected(row.id)} tone={selected === row.id ? 'success' : 'neutral'} variant={selected === row.id ? 'solid' : 'outline'} className="w-full" />)}{!receipt && <ErpEmptyState title="دریافتی ثبت نشده است" action={{ label: 'آزمایش ثبت دریافت', onClick: () => props.open('ثبت دریافت') }} />}</div>
    <div className={styles.flowMiddle}><span className={styles.eyebrow}>۲ · تخصیص معتبر</span><FaExchangeAlt className={styles.green} /><strong>{money(sum(allocations.map(row => row.amountRials)))}</strong><ErpBadge tone="success">{allocations.length.toLocaleString('fa-IR')} سهم فعال</ErpBadge>{receipt && <p className="text-xs sds-text-secondary">آزاد: {money(receiptRemainingRials(receipt))}</p>}<ErpButton label="تخصیص دریافت" onClick={() => props.open('تخصیص دریافت')} /></div>
    <div className="min-w-0 space-y-3"><span className={styles.eyebrow}>۳ · بدهی و قرارداد مقصد</span>{allocations.map((line, index) => {
      const item = props.account.activityItems.find(row => row.id === line.openItemId);
      return <ErpCard key={`${line.openItemId}:${index}`} className="space-y-3 p-4" tone="success"><strong>{item ? `قرارداد ${contractLabel(props.account, item)}` : 'قلم تاریخی'}</strong><p className="text-xs sds-text-secondary">{item?.invoiceNumber || 'فاقد شماره فاکتور'}</p><p className={styles.green}>سهم این دریافت {money(line.amountRials)}</p>{item && <p className="text-sm">مانده بدهی {money(item.remainingRials)}</p>}<ErpButton label="بررسی این ارتباط" tone="neutral" onClick={() => props.open(`جزئیات ${item?.invoiceNumber || 'تخصیص'}`)} /></ErpCard>;
    })}{receipt && !allocations.length && <ErpEmptyState title="این دریافت هنوز تخصیص ندارد" />}</div>
  </div></ErpSection><ErpSection title="بدهی‌های مقصد"><Items {...props} /></ErpSection></div>;
}

function Statement({ account }: Props) {
  return <div className="space-y-4">{account.movements.map(row => <ErpCard key={row.id} className="space-y-3 p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{row.label}</strong><span className="text-xs sds-text-secondary">{dateFa(row.at)}</span></div><ErpSummaryGrid columns={3} items={[{ label: 'بدهکار', value: money(row.debit) }, { label: 'بستانکار', value: money(row.credit) }, { label: 'مانده', value: money(row.balance) }]} /></ErpCard>)}</div>;
}

export default function CustomerFinancePrototype({ account }: Props) {
  const params = useSearchParams();
  const variant = ['A', 'B', 'C'].includes(params.get('variant') || '') ? params.get('variant')! : 'A';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'overdue'>('all');
  const [action, setAction] = useState('');
  const [amount, setAmount] = useState('300000000');
  const [previewed, setPreviewed] = useState(false);
  const open = (label: string) => { setPreviewed(false); setAction(label); };
  const props = { account, open, query, overdueOnly: filter === 'overdue' };
  return <ErpPresentationProvider scope="workspace"><ErpWorkspacePage title={account.displayName} backHref="/dashboard/accounting/customer-accounts" context={<ErpBadge tone="purple">طرح {variant} · آزمایشی</ErpBadge>}>
    <div className={`${styles.root} space-y-5 pb-28`}>
      <ErpInlineState kind="empty" title="نمونه طراحی با اطلاعات همین پرونده؛ عملیات این نما فقط شبیه‌سازی می‌شوند." />
      <div className="flex flex-wrap gap-2"><ErpButton label="ثبت دریافت" icon={FaArrowDown} tone="success" variant="solid" onClick={() => open('ثبت دریافت')} /><ErpButton label="تخصیص دریافت" icon={FaExchangeAlt} onClick={() => open('تخصیص دریافت')} /><ErpButton label="ریزگردش حساب" tone="neutral" onClick={() => open('ریزگردش حساب')} /></div><div className={styles.toolbar}><div className="min-w-0 flex-1"><ErpInput type="search" aria-label="جستجوی قلم یا فاکتور" placeholder="جستجوی قلم یا شماره فاکتور…" value={query} onChange={event => setQuery(event.target.value)} /></div><ErpSegmentedControl value={filter} onChange={setFilter} options={[{ value: 'all', label: 'همه اقلام', icon: FaSearch }, { value: 'overdue', label: 'نیازمند پیگیری' }]} /><ErpButton label="راهنمای رنگ‌ها" tone="neutral" variant="ghost" onClick={() => open('راهنمای رنگ‌ها')} /></div>
      {variant === 'A' ? <VariantA {...props} /> : variant === 'B' ? <VariantB {...props} /> : <VariantC {...props} />}
      <ErpDisclosure title="قراردادها و اعتبارهای مستقل"><ErpSummaryGrid items={[{ label: 'بستانکاری مستقل آزاد', value: money(account.standaloneCreditRials ?? '0') }, { label: 'چک‌های خزانه', value: account.treasuryChecks.length.toLocaleString('fa-IR') }]} /><div className="mt-4 space-y-3">{account.contracts.map(row => <div key={row.id} className="flex flex-wrap justify-between gap-2"><strong>قرارداد {row.contractNumber}</strong><span>{accountMoney(row.totalAmount, row.currency)}</span></div>)}</div><p className="mt-3 text-xs sds-text-secondary">مبلغ قرارداد، بدهی قطعی نیست؛ در مانده قطعی دوباره منظور نمی‌شود.</p></ErpDisclosure><ErpDisclosure title="اطلاعات مبنای این مقایسه"><ErpSummaryGrid columns={3} items={[{ label: 'منبع', value: 'خواندن پرونده فعلی؛ بدون ثبت مالی' }, { label: 'اقلام قطعی', value: account.activityItems.length.toLocaleString('fa-IR') }, { label: 'دریافت‌ها', value: account.receipts.length.toLocaleString('fa-IR') }]} /><p className="mt-3 text-sm sds-text-secondary">طرح {variant} · فیلتر {filter === 'all' ? 'همه اقلام' : 'نیازمند پیگیری'} · {query || 'بدون جستجو'} · مبلغ‌ها به ریال و با جداسازی سه‌رقمی هستند. مبلغ اصلی قرارداد و مانده افتتاحیه با هم جمع نمی‌شوند.</p></ErpDisclosure>
    </div>
    <PrototypeSwitcher current={variant} variants={variants} />
    <ErpSheet open={Boolean(action)} onClose={() => setAction('')} title={action} presentation="modal" size="wide">
      <div className="space-y-5"><ErpBadge tone="purple">پیش‌نمایش تعاملی · بدون ثبت مالی</ErpBadge>
        {action === 'ریزگردش حساب' ? <Statement account={account} /> : action === 'راهنمای رنگ‌ها' ? <div className="space-y-4"><ErpCard tone="success" className="p-4">✓ سبز: وصول، تسویه و سهم معتبر دریافت</ErpCard><ErpCard tone="danger" className="p-4">! قرمز: بدهی سررسیدگذشته یا خطای نیازمند رسیدگی</ErpCard><ErpCard tone="warning" className="p-4">◷ کهربایی: چک یا نتیجه در انتظار بررسی</ErpCard><p>بدهی جاری به‌تنهایی خطا نیست. اعتبار آزاد هم الزاماً وجه نقد قابل استرداد نیست.</p></div> : action.startsWith('جزئیات') || action === 'پیگیری سررسید' ? <Items {...props} query="" overdueOnly={action === 'پیگیری سررسید'} readOnly /> : <><ErpInlineState kind="empty" title="ابتدا منبع دریافت، سپس بدهی و قرارداد مقصد انتخاب می‌شود؛ اینجا فقط چیدمان مراحل را می‌آزماییم." /><ErpSummaryGrid columns={3} items={[{ label: '۱ · منبع', value: 'دریافت انتخاب‌شده' }, { label: '۲ · مقصد', value: 'قلم قطعی قرارداد' }, { label: '۳ · بررسی', value: 'مبلغ و مستندات' }]} /><ErpField label="مبلغ آزمایشی (ریال)"><FormattedNumberInput value={amount} onTextChange={setAmount} decimalScale={null} aria-label="مبلغ آزمایشی (ریال)" /></ErpField><p className="text-sm sds-text-secondary">{money(amount || '0')}</p><ErpButton label="دیدن خلاصه آزمایشی" tone="success" icon={FaCheckCircle} onClick={() => setPreviewed(true)} />{previewed && <ErpInlineState kind="success" title={`خلاصه نمونه: ${money(amount || '0')}؛ هیچ فرمان مالی ارسال نشد.`} />}</>}
      </div>
    </ErpSheet>
  </ErpWorkspacePage></ErpPresentationProvider>;
}
