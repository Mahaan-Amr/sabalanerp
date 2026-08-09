'use client';

/* eslint-disable @next/next/no-img-element -- Print prototype uses the exact embedded brand asset dimensions. */

// PROTOTYPE — three dispatch-document layout systems, switchable with ?variant=A|B|C.
// This route is throwaway evidence for Wayfinder ticket "Prototype the compact branded dispatch document bundle".

import { useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaChevronLeft, FaChevronRight, FaPrint } from 'react-icons/fa';
import { ErpButton, ErpIconButton, ErpSegmentedControl } from '@/components/erp';
import styles from './prototype-dispatch-documents.module.css';

type VariantKey = 'A' | 'B' | 'C';
type DocumentMode = 'waybill' | 'statement' | 'both' | 'continuation' | 'adjustment';

type ShipmentRow = {
  contract: string;
  row: string;
  product: string;
  detail: string;
  quantity: string;
  gross: string;
  discount: string;
  net: string;
};

const variants: Array<{ key: VariantKey; name: string; description: string }> = [
  { key: 'A', name: 'نوارهای راهنما', description: 'اسکن سریع با نوار عنوان، بلوک هویت و جمع‌بندی برجسته' },
  { key: 'B', name: 'ریل هویت', description: 'هویت محموله در ستون ثابت و ردیف‌های قیمت به شکل رسید' },
  { key: 'C', name: 'دفتر خط‌کشی‌شده', description: 'فرم رسمی و کم‌رنگ با شبکه یکپارچه و حداقل تزئین' },
];

const documentOptions: Array<{ value: DocumentMode; label: string }> = [
  { value: 'waybill', label: 'بارنامه' },
  { value: 'statement', label: 'صورتحساب' },
  { value: 'both', label: 'چاپ هر دو' },
  { value: 'continuation', label: 'ادامه جدول' },
  { value: 'adjustment', label: 'اصلاحیه' },
];

const rows: ShipmentRow[] = [
  { contract: 'ق-۱۴۰۵-۰۲۱۷', row: 'ردیف ۰۱', product: 'سنگ تراورتن عباس‌آباد', detail: 'طولی ۴۰ سانتی‌متر — شامل خدمات متصل', quantity: '۲۸٫۵۰۰ مترمربع', gross: '۱٬۸۵۲٬۵۰۰٬۰۰۰', discount: '−۹۲٬۶۲۵٬۰۰۰', net: '۱٬۷۵۹٬۸۷۵٬۰۰۰' },
  { contract: 'ق-۱۴۰۵-۰۲۱۷', row: 'ردیف ۰۳', product: 'سنگ پله تراورتن', detail: 'عرض ۳۵ سانتی‌متر — شامل خدمات متصل', quantity: '۱۸٫۰۰۰ مترطول', gross: '۷۹۲٬۰۰۰٬۰۰۰', discount: '−۳۹٬۶۰۰٬۰۰۰', net: '۷۵۲٬۴۰۰٬۰۰۰' },
  { contract: 'ق-۱۴۰۵-۰۲۱۷', row: 'ردیف ۰۷', product: 'قرنیز تراورتن', detail: 'ارتفاع ۱۰ سانتی‌متر — شامل خدمات متصل', quantity: '۶۲٫۲۵۰ مترطول', gross: '۳۷۳٬۵۰۰٬۰۰۰', discount: '−۱۸٬۶۷۵٬۰۰۰', net: '۳۵۴٬۸۲۵٬۰۰۰' },
  { contract: 'ق-۱۴۰۵-۰۳۴۱', row: 'ردیف ۰۲', product: 'سنگ مرمریت لاشتر', detail: 'ابعاد ۶۰ × ۶۰ — شامل خدمات متصل', quantity: '۳۶٫۰۰۰ مترمربع', gross: '۲٬۰۱۶٬۰۰۰٬۰۰۰', discount: '−۶۰٬۴۸۰٬۰۰۰', net: '۱٬۹۵۵٬۵۲۰٬۰۰۰' },
  { contract: 'ق-۱۴۰۵-۰۳۴۱', row: 'ردیف ۰۵', product: 'سنگ کف مرمریت لاشتر', detail: 'ابعاد ۴۰ × ۴۰ — شامل خدمات متصل', quantity: '۲۴٫۷۵۰ مترمربع', gross: '۱٬۲۳۷٬۵۰۰٬۰۰۰', discount: '−۳۷٬۱۲۵٬۰۰۰', net: '۱٬۲۰۰٬۳۷۵٬۰۰۰' },
  { contract: 'ق-۱۴۰۵-۰۳۴۱', row: 'ردیف ۰۸', product: 'سنگ بغل پله لاشتر', detail: 'برش سفارشی — شامل خدمات متصل', quantity: '۱۲٫۰۰۰ عدد', gross: '۴۵۶٬۰۰۰٬۰۰۰', discount: '−۱۳٬۶۸۰٬۰۰۰', net: '۴۴۲٬۳۲۰٬۰۰۰' },
  { contract: 'ق-۱۴۰۵-۰۳۴۱', row: 'ردیف ۰۹', product: 'سنگ پاگرد مرمریت', detail: 'ابعاد سفارشی — شامل خدمات متصل', quantity: '۱۵٫۵۰۰ مترمربع', gross: '۸۳۷٬۰۰۰٬۰۰۰', discount: '−۲۵٬۱۱۰٬۰۰۰', net: '۸۱۱٬۸۹۰٬۰۰۰' },
  { contract: 'ق-۱۴۰۵-۰۳۴۱', row: 'ردیف ۱۱', product: 'ازاره مرمریت', detail: 'ارتفاع ۲۰ سانتی‌متر — شامل خدمات متصل', quantity: '۴۸٫۰۰۰ مترطول', gross: '۵۷۶٬۰۰۰٬۰۰۰', discount: '−۱۷٬۲۸۰٬۰۰۰', net: '۵۵۸٬۷۲۰٬۰۰۰' },
];

const normalRows = rows.slice(0, 4);
const continuationFirstRows = rows.slice(0, 5);
const continuationRows = rows.slice(5);

function BrandHeader({ title, subtitle, compact = false }: { title: string; subtitle: string; compact?: boolean }) {
  return (
    <header className={`${styles.brandHeader} ${compact ? styles.compactHeader : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/sabalan-logo.jpg" alt="صنایع سنگ سبلان" />
      <div className={styles.documentTitle}>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className={styles.issueBlock}>
        <span>شماره محموله</span>
        <strong>۱۲۵۸</strong>
        <small>۱۴۰۵/۰۵/۱۸ · ۱۰:۴۲</small>
      </div>
    </header>
  );
}

function PrototypeMark() {
  return <div className={styles.prototypeMark}>نمونه تصمیم‌گیری — داده نمایشی</div>;
}

function IdentityFields({ includeDriver = false }: { includeDriver?: boolean }) {
  return (
    <section className={styles.identityFields}>
      <div><span>مشتری</span><strong>شرکت سازه‌گستر آریا</strong></div>
      <div><span>پروژه / مقصد</span><strong>مجتمع مسکونی ارغوان — کرج</strong></div>
      <div><span>خودرو</span><strong className={styles.ltr}>ایران ۶۸ — ۳۲۱ ب ۴۵</strong></div>
      {includeDriver && <div><span>راننده</span><strong>رضا احمدی · داخلی</strong></div>}
    </section>
  );
}

function AmountSummary() {
  return (
    <section className={styles.amountSummary}>
      <div><span>مبلغ ناخالص محموله</span><strong>۵٬۰۳۴٬۰۰۰٬۰۰۰</strong></div>
      <div><span>تخفیف تخصیص‌یافته</span><strong>−۲۱۱٬۳۸۰٬۰۰۰</strong></div>
      <div className={styles.netTotal}><span>مبلغ نهایی محموله</span><strong>۴٬۸۲۲٬۶۲۰٬۰۰۰ ریال</strong></div>
    </section>
  );
}

function DocumentFooter({ page, pages }: { page: number; pages: number }) {
  return (
    <footer className={styles.documentFooter}>
      <span>این سند صورتحساب مالیاتی یا سند حسابداری نیست.</span>
      <span>صفحه {page.toLocaleString('fa-IR')} از {pages.toLocaleString('fa-IR')}</span>
    </footer>
  );
}

function PriceTable({ data, continued = false, showTotals = true }: { data: ShipmentRow[]; continued?: boolean; showTotals?: boolean }) {
  return (
    <div className={styles.tableWrap}>
      {continued && <p className={styles.continuedLabel}>ادامه اقلام محموله</p>}
      <table className={styles.priceTable}>
        <thead><tr><th>قرارداد / ردیف</th><th>شرح محصول</th><th>مقدار بارگیری</th><th>ناخالص</th><th>تخفیف</th><th>خالص (ریال)</th></tr></thead>
        <tbody>
          {data.map((row) => (
            <tr key={`${row.contract}-${row.row}`}>
              <td><strong>{row.contract}</strong><small>{row.row}</small></td>
              <td><strong>{row.product}</strong><small>{row.detail}</small></td>
              <td>{row.quantity}</td><td>{row.gross}</td><td>{row.discount}</td><td>{row.net}</td>
            </tr>
          ))}
        </tbody>
        {showTotals && <tfoot><tr><td colSpan={5}>جمع نهایی محموله</td><td>۴٬۸۲۲٬۶۲۰٬۰۰۰</td></tr></tfoot>}
      </table>
    </div>
  );
}

function LoadTable({ data }: { data: ShipmentRow[] }) {
  return (
    <table className={styles.loadTable}>
      <thead><tr><th>قرارداد / ردیف</th><th>شرح بار</th><th>مقدار</th></tr></thead>
      <tbody>{data.map((row) => <tr key={`${row.contract}-${row.row}`}><td>{row.contract}<small>{row.row}</small></td><td>{row.product}<small>{row.detail}</small></td><td>{row.quantity}</td></tr>)}</tbody>
    </table>
  );
}

function Paper({ className = '', children, short = false }: { className?: string; children: React.ReactNode; short?: boolean }) {
  return <article className={`${styles.paper} ${short ? styles.shortPaper : ''} ${className}`} dir="rtl"><PrototypeMark />{children}</article>;
}

function VariantAWaybill() {
  return <Paper className={styles.variantA}><BrandHeader title="بارنامه حسابداری" subtitle="Accounting Dispatch Waybill" /><div className={styles.numberBand}><span>سند عملیاتی بارگیری</span><strong>شماره ۱۲۵۸</strong></div><IdentityFields includeDriver /><section className={styles.routeBand}><div><span>مبدأ</span><strong>کارخانه صنایع سنگ سبلان</strong></div><i>←</i><div><span>مقصد</span><strong>مجتمع ارغوان، کرج</strong></div></section><LoadTable data={normalRows} /><div className={styles.waybillNote}>این بارنامه برای یک تخصیص کامل راننده–خودرو صادر شده است. خروج تنها با مجوز معتبر گیت ثبت می‌شود.</div><DocumentFooter page={1} pages={1} /></Paper>;
}

function VariantAStatement({ continuation = false, page = 1 }: { continuation?: boolean; page?: number }) {
  const pages = continuation ? 2 : 1;
  const data = continuation ? (page === 1 ? continuationFirstRows : continuationRows) : normalRows;
  return <Paper className={styles.variantA}><BrandHeader compact={page > 1} title="صورتحساب محموله مشتری" subtitle={page > 1 ? 'ادامه اقلام' : 'Customer Shipment Statement'} />{page === 1 && <><div className={styles.numberBand}><span>سند تجاری غیرمالیاتی</span><strong>شماره مشترک ۱۲۵۸</strong></div><IdentityFields /></>}<PriceTable data={data} continued={page > 1} showTotals={!continuation || page === 2} />{(!continuation || page === 2) && <AmountSummary />}<DocumentFooter page={page} pages={pages} /></Paper>;
}

function VariantAAdjustment() {
  return <Paper className={styles.variantA} short><BrandHeader title="اصلاحیه صورتحساب محموله" subtitle="Customer Shipment Statement Adjustment" /><div className={styles.adjustmentBand}><div><span>مرجع</span><strong>۱۲۵۸ / اصلاحیه ۱</strong></div><div><span>تاریخ اثر</span><strong>۱۴۰۵/۰۵/۲۱</strong></div><div><span>جهت اصلاح</span><strong>کاهش</strong></div></div><IdentityFields /><table className={styles.priceTable}><thead><tr><th>قرارداد / ردیف</th><th>شرح ردیف متاثر</th><th>تفاوت مقدار</th><th>تفاوت مبلغ (ریال)</th></tr></thead><tbody><tr><td><strong>ق-۱۴۰۵-۰۲۱۷</strong><small>ردیف ۰۱</small></td><td>سنگ تراورتن عباس‌آباد</td><td className={styles.negative}>−۱٫۵۰۰ مترمربع</td><td className={styles.negative}>−۹۲٬۶۲۵٬۰۰۰</td></tr></tbody></table><div className={styles.adjustmentTotal}><span>تغییر خالص این اصلاحیه</span><strong>−۹۲٬۶۲۵٬۰۰۰ ریال</strong></div><DocumentFooter page={1} pages={1} /></Paper>;
}

function ReceiptRows({ data, continued = false, showTotals = true }: { data: ShipmentRow[]; continued?: boolean; showTotals?: boolean }) {
  return <section className={styles.receiptRows}>{continued && <h3>ادامه اقلام</h3>}{data.map((row) => <div className={styles.receiptRow} key={`${row.contract}-${row.row}`}><div className={styles.receiptIdentity}><small>{row.contract} · {row.row}</small><strong>{row.product}</strong><span>{row.detail}</span></div><div><small>مقدار</small><strong>{row.quantity}</strong></div><div><small>ناخالص</small><strong>{row.gross}</strong></div><div><small>تخفیف</small><strong>{row.discount}</strong></div><div><small>خالص</small><strong>{row.net}</strong></div></div>)}{showTotals && <div className={styles.receiptTotal}><span>مبلغ نهایی محموله</span><strong>۴٬۸۲۲٬۶۲۰٬۰۰۰ ریال</strong></div>}</section>;
}

function Rail({ adjustment = false }: { adjustment?: boolean }) {
  return <aside className={styles.identityRail}><span>{adjustment ? 'اصلاحیه' : 'محموله'}</span><strong>{adjustment ? '۱۲۵۸ / ۱' : '۱۲۵۸'}</strong><dl><dt>تاریخ</dt><dd>۱۴۰۵/۰۵/۱۸</dd><dt>پلاک</dt><dd className={styles.ltr}>۶۸ — ۳۲۱ ب ۴۵</dd><dt>مقصد</dt><dd>کرج · ارغوان</dd><dt>ارز</dt><dd>ریال</dd></dl></aside>;
}

function VariantBDocument({ kind, continuation = false, page = 1 }: { kind: 'waybill' | 'statement'; continuation?: boolean; page?: number }) {
  const statement = kind === 'statement';
  const data = continuation ? (page === 1 ? continuationFirstRows : continuationRows) : normalRows;
  return <Paper className={styles.variantB}><div className={styles.railLayout}><Rail /><main className={styles.railContent}><BrandHeader compact={page > 1} title={statement ? 'صورتحساب محموله مشتری' : 'بارنامه حسابداری'} subtitle={statement ? (page > 1 ? 'ادامه اقلام محموله' : 'سند تجاری همراه بار') : 'سند عملیاتی همراه بار'} />{page === 1 && <IdentityFields includeDriver={!statement} />}{statement ? <ReceiptRows data={data} continued={page > 1} showTotals={!continuation || page === 2} /> : <><section className={styles.routeStack}><div><small>از</small><strong>کارخانه صنایع سنگ سبلان</strong></div><div><small>به</small><strong>مجتمع مسکونی ارغوان — کرج</strong></div></section><ReceiptRows data={data.map((row) => ({ ...row, gross: '—', discount: '—', net: '—' }))} showTotals={false} /></>}<DocumentFooter page={page} pages={continuation ? 2 : 1} /></main></div></Paper>;
}

function VariantBAdjustment() {
  const delta = [{ ...rows[0], quantity: '−۱٫۵۰۰ مترمربع', gross: '—', discount: '—', net: '−۹۲٬۶۲۵٬۰۰۰' }];
  return <Paper className={styles.variantB} short><div className={styles.railLayout}><Rail adjustment /><main className={styles.railContent}><BrandHeader title="اصلاحیه صورتحساب محموله" subtitle="فقط تفاوت نسبت به سند اصلی" /><IdentityFields /><ReceiptRows data={delta} showTotals={false} /><div className={styles.receiptTotal}><span>تغییر خالص</span><strong>−۹۲٬۶۲۵٬۰۰۰ ریال</strong></div><DocumentFooter page={1} pages={1} /></main></div></Paper>;
}

function LedgerHeader({ title, page = 1, pages = 1 }: { title: string; page?: number; pages?: number }) {
  return <><table className={styles.ledgerHeader}><tbody><tr><td rowSpan={2} className={styles.ledgerLogo}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/sabalan-logo.jpg" alt="صنایع سنگ سبلان" /></td><th>{title}</th><td><span>شماره</span><strong>۱۲۵۸</strong></td></tr><tr><td>صنایع سنگ سبلان · سند همراه محموله</td><td>صفحه {page.toLocaleString('fa-IR')} از {pages.toLocaleString('fa-IR')}</td></tr></tbody></table></>;
}

function LedgerIdentity({ driver = false }: { driver?: boolean }) {
  return <table className={styles.ledgerIdentity}><tbody><tr><th>مشتری</th><td>شرکت سازه‌گستر آریا</td><th>پروژه / مقصد</th><td>مجتمع مسکونی ارغوان — کرج</td></tr><tr><th>پلاک</th><td className={styles.ltr}>ایران ۶۸ — ۳۲۱ ب ۴۵</td><th>{driver ? 'راننده' : 'تاریخ صدور'}</th><td>{driver ? 'رضا احمدی · داخلی' : '۱۴۰۵/۰۵/۱۸ · ۱۰:۴۲'}</td></tr></tbody></table>;
}

function VariantCDocument({ kind, continuation = false, page = 1 }: { kind: 'waybill' | 'statement'; continuation?: boolean; page?: number }) {
  const statement = kind === 'statement';
  const data = continuation ? (page === 1 ? continuationFirstRows : continuationRows) : normalRows;
  return <Paper className={styles.variantC}><LedgerHeader title={statement ? 'صورتحساب محموله مشتری' : 'بارنامه حسابداری'} page={page} pages={continuation ? 2 : 1} />{page === 1 && <LedgerIdentity driver={!statement} />}{statement ? <PriceTable data={data} continued={page > 1} showTotals={!continuation || page === 2} /> : <LoadTable data={data} />}{statement && (!continuation || page === 2) && <AmountSummary />}<div className={styles.ledgerNotice}>{statement ? 'سند تجاری غیرمالیاتی · مبالغ به ریال' : 'یک تخصیص کامل راننده–خودرو · ثبت خروج منوط به مجوز معتبر گیت'}</div><DocumentFooter page={page} pages={continuation ? 2 : 1} /></Paper>;
}

function VariantCAdjustment() {
  return <Paper className={styles.variantC} short><LedgerHeader title="اصلاحیه صورتحساب محموله — ۱" /><LedgerIdentity /><table className={styles.priceTable}><thead><tr><th>قرارداد / ردیف</th><th>شرح ردیف متاثر</th><th>تفاوت مقدار</th><th>تفاوت مبلغ (ریال)</th></tr></thead><tbody><tr><td>ق-۱۴۰۵-۰۲۱۷ · ردیف ۰۱</td><td>سنگ تراورتن عباس‌آباد</td><td>−۱٫۵۰۰ مترمربع</td><td>−۹۲٬۶۲۵٬۰۰۰</td></tr></tbody><tfoot><tr><td colSpan={3}>تغییر خالص اصلاحیه</td><td>−۹۲٬۶۲۵٬۰۰۰</td></tr></tfoot></table><div className={styles.ledgerNotice}>مرجع: محموله ۱۲۵۸ · تاریخ اثر: ۱۴۰۵/۰۵/۲۱ · اصل صورتحساب بدون تغییر باقی می‌ماند.</div><DocumentFooter page={1} pages={1} /></Paper>;
}

function renderDocuments(variant: VariantKey, mode: DocumentMode) {
  const waybill = variant === 'A' ? <VariantAWaybill /> : variant === 'B' ? <VariantBDocument kind="waybill" /> : <VariantCDocument kind="waybill" />;
  const statement = variant === 'A' ? <VariantAStatement /> : variant === 'B' ? <VariantBDocument kind="statement" /> : <VariantCDocument kind="statement" />;
  const adjustment = variant === 'A' ? <VariantAAdjustment /> : variant === 'B' ? <VariantBAdjustment /> : <VariantCAdjustment />;
  const continued = variant === 'A'
    ? [<VariantAStatement key="a1" continuation page={1} />, <VariantAStatement key="a2" continuation page={2} />]
    : variant === 'B'
      ? [<VariantBDocument key="b1" kind="statement" continuation page={1} />, <VariantBDocument key="b2" kind="statement" continuation page={2} />]
      : [<VariantCDocument key="c1" kind="statement" continuation page={1} />, <VariantCDocument key="c2" kind="statement" continuation page={2} />];

  if (mode === 'waybill') return waybill;
  if (mode === 'statement') return statement;
  if (mode === 'adjustment') return adjustment;
  if (mode === 'continuation') return continued;
  return [<div key="waybill">{waybill}</div>, <div key="statement">{statement}</div>];
}

export default function DispatchDocumentPrototypePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawVariant = searchParams.get('variant');
  const rawMode = searchParams.get('document');
  const variant: VariantKey = rawVariant === 'B' || rawVariant === 'C' ? rawVariant : 'A';
  const mode: DocumentMode = documentOptions.some((option) => option.value === rawMode) ? rawMode as DocumentMode : 'both';
  const currentIndex = variants.findIndex((item) => item.key === variant);
  const currentVariant = variants[currentIndex];

  const updateQuery = useCallback((nextVariant: VariantKey, nextMode: DocumentMode = mode) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('variant', nextVariant);
    params.set('document', nextMode);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [mode, router, searchParams]);

  const cycleVariant = useCallback((direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + variants.length) % variants.length;
    updateQuery(variants[nextIndex].key);
  }, [currentIndex, updateQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') cycleVariant(-1);
      if (event.key === 'ArrowRight') cycleVariant(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cycleVariant]);

  const papers = useMemo(() => renderDocuments(variant, mode), [mode, variant]);
  const showPrototypeSwitcher = process.env.NODE_ENV !== 'production' || (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname));

  return (
    <div className={styles.prototypePage} dir="rtl">
      <section className={styles.prototypeToolbar}>
        <div>
          <p className={styles.eyebrow}>پروتوتایپ دورریختنی · تصمیم طراحی سند</p>
          <h1>بسته اسناد محموله حسابداری</h1>
          <p>{currentVariant.name}: {currentVariant.description}</p>
        </div>
        <ErpButton label="چاپ نمای فعلی" icon={FaPrint} variant="outline" onClick={() => window.print()} />
      </section>

      <section className={styles.modeBar} aria-label="نوع خروجی نمونه">
        <ErpSegmentedControl options={documentOptions} value={mode} onChange={(nextMode) => updateQuery(variant, nextMode)} />
        <p>«چاپ هر دو» دو PDF موجود را پشت‌سرهم نشان می‌دهد؛ فایل ترکیبی سومی ایجاد نمی‌شود.</p>
      </section>

      <aside className={styles.assumptionStrip}>
        <strong>مرز این تصمیم:</strong>
        <span>شماره، نسخه قالب، checksum و ثبت چاپ فقط جای‌نما هستند و در تصمیم‌های همسایه نهایی می‌شوند.</span>
        <span>پروتوتایپ فقط چیدمان، تراکم، هویت بصری، جریان چاپ و ادامه صفحه را می‌سنجد.</span>
      </aside>

      <main className={styles.paperStage}>{papers}</main>

      {showPrototypeSwitcher && <nav className={styles.variantSwitcher} aria-label="انتخاب گونه پروتوتایپ">
        <ErpIconButton label="گونه قبلی" icon={FaChevronRight} onClick={() => cycleVariant(-1)} />
        <div><small>گونه {variant}</small><strong>{currentVariant.name}</strong></div>
        <ErpIconButton label="گونه بعدی" icon={FaChevronLeft} onClick={() => cycleVariant(1)} />
      </nav>}
    </div>
  );
}
