'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FaBoxOpen, FaBoxes, FaFileContract, FaListUl, FaSearch, FaSlidersH } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpField, ErpIconButton, ErpInlineState, ErpInput, ErpListPage, ErpSearchableSelect, ErpSheet,
  type ErpColumn, type ErpFilter } from '@/components/erp';
import { contractLifecycleLabel, type ContractLifecyclePresentation } from '@/features/sales/contractLifecyclePresentation';
import api from '@/lib/api';
import { formatNumber, normalizeDigits } from '@/lib/numberFormat';
import styles from './CustomerBuyerItemsPage.module.css';

type Contract = ContractLifecyclePresentation & { id: string; number: string; date: string; isInactive: boolean };
type BuyerItem = {
  id: string; name: string; productKey: string; contract: Contract;
  squareMeters: string | null; linearMeters: string | null; pieceCount: string | null;
  totalToman: string | null; beforeToman: string | null; afterToman: string | null;
  mandatory: boolean | null; mandatoryPercentage: string | null;
};
type BuyerItems = { customerName: string; rows: BuyerItem[] };
const emptyAdvancedFilters = { product: '', contract: '', status: '', mandatory: '' };
const emptyFilters = { search: '', ...emptyAdvancedFilters };
type PriceRange = { min: number; max: number };
const collator = new Intl.Collator('fa-IR', { numeric: true });
const persianDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeZone: 'Asia/Tehran' });
const normalizeSearch = (value: string) => normalizeDigits(value).normalize('NFKC')
  .replace(/ي|ى/g, 'ی').replace(/ك/g, 'ک').replace(/[\s‌]+/g, ' ').trim().toLowerCase();
const measure = (value: string | null) => value === null ? '—' : formatNumber(value, { maximumFractionDigits: 6 });
const money = (value: string | null) => value === null ? '—' : formatNumber(value, { maximumFractionDigits: 2 });
const status = (contract: Contract) => contract.isInactive ? 'غیرفعال' : contractLifecycleLabel(contract);
const displayDate = (value: string) => {
  const date = /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(value) : null;
  return date && Number.isFinite(date.valueOf()) && date.getUTCFullYear() >= 1700 ? persianDate.format(date) : value;
};
const priceAmount = (item: BuyerItem) => item.mandatory === true ? item.afterToman : item.beforeToman;
const options = (rows: BuyerItem[], key: (item: BuyerItem) => string, label: (item: BuyerItem) => string) =>
  Array.from(new Map(rows.map(row => [key(row), { value: key(row), label: label(row) }])).values())
    .sort((left, right) => collator.compare(left.label, right.label));

function PriceRangeSlider({ bounds, selected, onChange }: {
  bounds: PriceRange; selected: PriceRange; onChange: (range: PriceRange) => void;
}) {
  const span = bounds.max - bounds.min;
  const disabled = span === 0;
  const start = disabled ? 0 : (selected.min - bounds.min) / span * 100;
  const end = disabled ? 100 : (selected.max - bounds.min) / span * 100;
  return <fieldset className="min-w-0">
    <legend className="sds-text-primary mb-2 text-sm font-semibold">بازه مبلغ سنگ (تومان)</legend>
    <div className="sds-text-secondary flex justify-between gap-3 text-sm tabular-nums">
      <span>از <bdi>{money(String(selected.min))}</bdi></span>
      <span>تا <bdi>{money(String(selected.max))}</bdi></span>
    </div>
    <div className={styles.slider} dir="rtl">
      <div className={`${styles.track} rounded-full`} aria-hidden="true">
        <div className={`${styles.selection} rounded-full`} style={{ insetInlineStart: `${start}%`, insetInlineEnd: `${100 - end}%` }} />
      </div>
      <ErpInput type="range" className={styles.thumb} min={bounds.min} max={bounds.max} step="any"
        aria-label="از مبلغ" aria-valuetext={`${money(String(selected.min))} تومان`}
        value={selected.min} disabled={disabled}
        onChange={event => onChange({ ...selected, min: Math.min(event.currentTarget.valueAsNumber, selected.max) })} />
      <ErpInput type="range" className={styles.thumb} min={bounds.min} max={bounds.max} step="any"
        aria-label="تا مبلغ" aria-valuetext={`${money(String(selected.max))} تومان`}
        value={selected.max} disabled={disabled}
        onChange={event => onChange({ ...selected, max: Math.max(event.currentTarget.valueAsNumber, selected.min) })} />
    </div>
  </fieldset>;
}

const columns: ErpColumn<BuyerItem>[] = [
  { id: 'product', header: 'محصول', priority: 'primary', sortValue: row => row.name,
    cell: row => <span className="sds-text-primary font-bold">{row.name}</span> },
  { id: 'contract', header: 'مرجع قرارداد', priority: 'secondary', sortValue: row => row.contract.number,
    cell: row => <div className="space-y-1.5">
      <p className="sds-text-primary font-medium"><bdi>{row.contract.number}</bdi></p>
      <p className="sds-text-muted text-xs">{displayDate(row.contract.date)}</p>
      <ErpBadge tone={row.contract.isInactive ? 'neutral' : 'info'}>{status(row.contract)}</ErpBadge>
    </div> },
  { id: 'area', header: 'مترمربع', align: 'end', sortValue: row => row.squareMeters === null ? null : Number(row.squareMeters),
    cell: row => <bdi className="tabular-nums">{measure(row.squareMeters)}</bdi> },
  { id: 'length', header: 'مترطول', align: 'end', sortValue: row => row.linearMeters === null ? null : Number(row.linearMeters),
    cell: row => <bdi className="tabular-nums">{measure(row.linearMeters)}</bdi> },
  { id: 'count', header: 'تعداد', align: 'end', sortValue: row => row.pieceCount === null ? null : Number(row.pieceCount),
    cell: row => <bdi className="tabular-nums">{measure(row.pieceCount)}</bdi> },
  { id: 'mandatory', header: 'مبلغ سنگ و حکمی (تومان)', sortValue: row => priceAmount(row) === null ? null : Number(priceAmount(row)),
    cell: row => <div className="space-y-1.5">
      <ErpBadge tone={row.mandatory ? 'warning' : 'neutral'}>
        {row.mandatory === true ? `با حکمی${row.mandatoryPercentage === null ? '' : ` · ${measure(row.mandatoryPercentage)}٪`}`
          : row.mandatory === false ? 'بدون حکمی' : 'حکمی نامشخص'}
      </ErpBadge>
      {row.mandatory ? <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs">
        <dt className="sds-text-muted">پیش از حکمی</dt><dd className="text-end tabular-nums"><bdi>{money(row.beforeToman)}</bdi></dd>
        <dt className="sds-text-muted">پس از حکمی</dt><dd className="sds-text-primary text-end font-bold tabular-nums"><bdi>{money(row.afterToman)}</bdi></dd>
      </dl> : <p className="tabular-nums"><bdi>{money(row.beforeToman)}</bdi></p>}
    </div> },
  { id: 'total', header: 'جمع ردیف (تومان)', align: 'end', sortValue: row => row.totalToman === null ? null : Number(row.totalToman),
    cell: row => <bdi className="sds-text-primary font-bold tabular-nums">{money(row.totalToman)}</bdi> },
];

export default function CustomerBuyerItemsPage({ partner = false }: { partner?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<BuyerItems>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState(emptyFilters);
  const [priceRange, setPriceRange] = useState<PriceRange | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const customerHref = `${partner ? '/dashboard/sales/partner-customers' : '/dashboard/crm/customers'}/${id}`;

  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError('');
    setPriceRange(null);
    api.get<{ data: BuyerItems }>(`/crm/${partner ? 'partner/' : ''}customers/${encodeURIComponent(id)}/buyer-items`, { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setData(response.data.data); })
      .catch(error => {
        if (!controller.signal.aborted) setError(error.response?.status < 500 && error.response?.data?.error
          ? error.response.data.error : 'دریافت اقلام خریدار انجام نشد.');
      });
    return () => controller.abort();
  }, [id, partner, attempt]);

  const setFilter = (key: keyof typeof filters) => (value: string) => setFilters(current => ({ ...current, [key]: value }));
  const query = normalizeSearch(filters.search).split(' ').filter(Boolean);
  const available = useMemo(() => {
    const rows = data?.rows ?? [];
    let priceBounds: PriceRange | null = null;
    for (const row of rows) {
      const price = priceAmount(row);
      if (price === null || !Number.isFinite(Number(price))) continue;
      const value = Number(price);
      priceBounds = priceBounds
        ? { min: Math.min(priceBounds.min, value), max: Math.max(priceBounds.max, value) }
        : { min: value, max: value };
    }
    return {
      priceBounds,
      products: options(rows, row => row.productKey, row => row.name),
      contracts: options(rows, row => row.contract.id, row => row.contract.number),
      statuses: options(rows, row => status(row.contract), row => status(row.contract)),
    };
  }, [data]);
  const filtered = (data?.rows ?? []).filter(row => {
    if (filters.product && row.productKey !== filters.product) return false;
    if (filters.contract && row.contract.id !== filters.contract) return false;
    if (filters.status && status(row.contract) !== filters.status) return false;
    if (filters.mandatory && String(row.mandatory) !== filters.mandatory) return false;
    const search = normalizeSearch(`${row.name} ${row.contract.number}`);
    if (!query.every(token => search.includes(token))) return false;
    const price = priceAmount(row);
    if (priceRange && price !== null) {
      const value = Number(price);
      return value >= priceRange.min && value <= priceRange.max;
    }
    return true;
  });
  const advancedCount = [filters.product, filters.contract, filters.status, filters.mandatory, priceRange].filter(Boolean).length;
  const hasFilters = Boolean(query.length || advancedCount);
  const resetFilters = () => { setFilters(emptyFilters); setPriceRange(null); };
  const filterControls: Extract<ErpFilter, { type: 'select' }>[] = [
    { id: 'product', type: 'select', label: 'محصول', options: available.products, value: filters.product, onChange: setFilter('product') },
    { id: 'contract', type: 'select', label: 'قرارداد', options: available.contracts, value: filters.contract, onChange: setFilter('contract') },
    { id: 'status', type: 'select', label: 'وضعیت قرارداد', options: available.statuses, value: filters.status, onChange: setFilter('status') },
    { id: 'mandatory', type: 'select', label: 'حکمی', value: filters.mandatory, onChange: setFilter('mandatory'),
      options: [{ label: 'با حکمی', value: 'true' }, { label: 'بدون حکمی', value: 'false' }, { label: 'نامشخص', value: 'null' }] },
  ];
  const counts = [
    { label: 'اقلام نمایش داده شده', shortLabel: 'اقلام', value: filtered.length, icon: FaListUl },
    { label: 'محصول متمایز', shortLabel: 'محصول متمایز', value: new Set(filtered.map(row => row.productKey)).size, icon: FaBoxes },
    { label: 'قرارداد مرتبط', shortLabel: 'قرارداد', value: new Set(filtered.map(row => row.contract.id)).size, icon: FaFileContract },
  ];

  return <ErpListPage title="اقلام خریدار" description={data?.customerName} onBack={() => router.push(customerHref)}
    rows={filtered} rowKey={row => row.id} columns={columns}
    isLoading={!data && !error}
    emptyState={error
      ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setAttempt(value => value + 1) }} />
      : <ErpEmptyState icon={FaBoxOpen} title={hasFilters ? 'قلمی با این فیلترها پیدا نشد' : 'هنوز محصولی در قراردادهای این مشتری ثبت نشده است'}
        action={hasFilters ? { label: 'پاک کردن فیلترها', onClick: resetFilters } : undefined} />}>
    {data && <div className="space-y-3">
      <ErpCard>
        <dl aria-label="شاخص‌های کلیدی" className="grid grid-cols-3 py-2">
          {counts.map(({ label, shortLabel, value, icon: Icon }) => <div key={label}
            className="flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 border-s border-[var(--sds-border-subtle)] px-1 text-xs first:border-s-0 sm:gap-x-2">
            <Icon aria-hidden="true" className="shrink-0 text-[var(--sds-accent)]" />
            <dt className="sds-text-secondary"><span className="sr-only">{label}</span><span aria-hidden="true">{shortLabel}</span></dt>
            <dd className="sds-text-primary font-bold tabular-nums">{value.toLocaleString('fa-IR')}</dd>
          </div>)}
        </dl>
      </ErpCard>
      <div className="relative">
        <FaSearch aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--sds-text-muted)]" />
        <ErpInput type="search" aria-label="جستجو" placeholder="نام محصول یا شماره قرارداد"
          value={filters.search} onChange={event => setFilter('search')(event.target.value)}
          className="min-h-12 pl-14 pr-10" />
        <div className="absolute inset-y-0 left-1 flex items-center">
          <ErpIconButton label={advancedCount ? `فیلترهای پیشرفته، ${advancedCount.toLocaleString('fa-IR')} فعال` : 'فیلترهای پیشرفته'}
            icon={FaSlidersH} tone={advancedCount ? 'primary' : 'neutral'} onClick={() => setAdvancedOpen(true)} />
          {advancedCount > 0 && <span aria-hidden="true" className="pointer-events-none absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--sds-accent)]" />}
        </div>
      </div>
      <ErpSheet open={advancedOpen} onClose={() => setAdvancedOpen(false)} title="فیلترهای پیشرفته" presentation="modal"
        footer={<>
          <ErpButton label="بازنشانی فیلترها" variant="outline" disabled={advancedCount === 0}
            onClick={() => { setFilters(current => ({ ...current, ...emptyAdvancedFilters })); setPriceRange(null); }} />
          <ErpButton label="نمایش نتایج" tone="primary" onClick={() => setAdvancedOpen(false)} />
        </>}>
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filterControls.map(control => <ErpField key={control.id} label={control.label}>
              <ErpSearchableSelect value={control.value} aria-label={control.label}
                onChange={event => control.onChange(event.target.value)}>
                <option value="">{`بدون فیلتر ${control.label}`}</option>
                {control.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </ErpSearchableSelect>
            </ErpField>)}
          </div>
          {available.priceBounds
            ? <PriceRangeSlider bounds={available.priceBounds} selected={priceRange ?? available.priceBounds}
                onChange={range => setPriceRange(range.min === available.priceBounds?.min && range.max === available.priceBounds?.max ? null : range)} />
            : <p className="sds-text-secondary text-sm">مبلغی برای تعیین بازه ثبت نشده است.</p>}
        </div>
      </ErpSheet>
    </div>}
  </ErpListPage>;
}
