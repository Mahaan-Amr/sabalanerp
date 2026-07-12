'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import moment from 'moment-jalaali';
import { Canvas, useFrame } from '@react-three/fiber';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  FaChartLine,
  FaChartPie,
  FaDownload,
  FaFilePdf,
  FaMoneyBillWave,
  FaSync,
  FaTruck,
  FaUsers,
  FaWarehouse,
} from 'react-icons/fa';
import { biAPI } from '@/lib/api';
import PersianCalendarPicker from '@/components/PersianCalendar';
import { PersianCalendar } from '@/lib/persian-calendar';

type BiOverview = {
  generatedAt: string;
  currency: string;
  scope: { mode: string; label: string };
  period: { from: string; to: string; label: string; previousLabel: string };
  cards: Record<string, number>;
  comparison: { previousRealizedSales: number; realizedSalesDelta: number };
  trend: Array<{ label: string; realized: number; pipeline: number; collected: number }>;
  statusDistribution: Array<{ status: string; value: number; count: number }>;
  sellers: Array<Record<string, any>>;
  finance: { paidAmount: number; receivableAmount: number; overdueAmount: number; paymentMethodMix: Array<{ method: string; amount: number }> };
  delivery: { overdue: number; upcoming: number; deliveredUnconfirmed: number; completed: number; cancelled: number; rows: Array<Record<string, any>> };
  products: { topProducts: Array<Record<string, any>>; productTypeMix: Array<Record<string, any>>; lowPerformingProducts: Array<Record<string, any>> };
  customers: {
    topCustomers: Array<Record<string, any>>;
    repeatCustomers: Array<Record<string, any>>;
    concentrationTop5Percent: number;
    receivableExposure: Array<Record<string, any>>;
    newCustomers: Array<Record<string, any>>;
  };
};

const tabs = [
  { id: 'executive', label: 'نمای مدیریتی', icon: FaChartPie },
  { id: 'sellers', label: 'عملکرد فروشندگان', icon: FaUsers },
  { id: 'finance', label: 'مالی فروش', icon: FaMoneyBillWave },
  { id: 'products', label: 'محصولات و مشتریان', icon: FaWarehouse },
  { id: 'delivery', label: 'تحویل', icon: FaTruck },
] as const;

const rangeOptions = [
  { id: 'today', label: 'امروز' },
  { id: 'yesterday', label: 'دیروز' },
  { id: 'week', label: 'این هفته' },
  { id: 'month', label: 'این ماه' },
  { id: 'quarter', label: 'این فصل' },
  { id: 'year', label: 'امسال' },
  { id: 'last12', label: '۱۲ ماه اخیر' },
  { id: 'custom', label: 'بازه سفارشی' },
];

const palette = ['#14b8a6', '#ffbf00', '#38bdf8', '#a78bfa', '#fb7185', '#34d399'];
const chartGridStroke = '#cbd5e1';
const chartAxisStroke = '#64748b';
const chartTooltipStyle = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  color: '#0f172a',
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
};
const exportButtonClass = 'inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:border-[#074747]/40 hover:text-[#074747] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-600 dark:hover:text-teal-200';

function resolveRange(range: string, customFrom: string, customTo: string) {
  const now = moment();
  let from = moment().startOf('jMonth');
  let to = moment().endOf('day');

  if (range === 'today') from = moment().startOf('day');
  if (range === 'yesterday') {
    from = moment().subtract(1, 'day').startOf('day');
    to = moment().subtract(1, 'day').endOf('day');
  }
  if (range === 'week') from = moment().subtract(6, 'day').startOf('day');
  if (range === 'quarter') {
    const quarterStartMonth = Math.floor(now.jMonth() / 3) * 3;
    from = moment().jMonth(quarterStartMonth).startOf('jMonth');
  }
  if (range === 'year') from = moment().startOf('jYear');
  if (range === 'last12') from = moment().subtract(11, 'jMonth').startOf('jMonth');
  if (range === 'custom' && customFrom && customTo) {
    from = moment(customFrom, 'jYYYY/jMM/jDD').startOf('day');
    to = moment(customTo, 'jYYYY/jMM/jDD').endOf('day');
  }

  return { from: from.toDate().toISOString(), to: to.toDate().toISOString() };
}

const money = (value: number, compact = true) => {
  const amount = Number(value || 0);
  if (compact && Math.abs(amount) >= 1_000_000_000) return `${(amount / 1_000_000_000).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیارد`;
  if (compact && Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیون`;
  return `${amount.toLocaleString('fa-IR')} تومان`;
};

const numberFa = (value: number) => Number(value || 0).toLocaleString('fa-IR');

function AnimatedNumber({ value, formatter = numberFa }: { value: number; formatter?: (value: number) => string }) {
  const shouldReduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(shouldReduceMotion ? value : 0);
  const displayRef = useRef(display);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (shouldReduceMotion) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const duration = 900;
    const initial = displayRef.current;
    let frame = 0;
    const tick = (time: number) => {
      const progress = Math.min((time - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(initial + (value - initial) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, shouldReduceMotion]);

  return <>{formatter(Math.round(display))}</>;
}

function PipelineBars({ data }: { data: BiOverview['statusDistribution'] }) {
  const groupRef = useRef<any>(null);
  const shouldReduceMotion = useReducedMotion();
  const maxValue = Math.max(...data.map((item) => item.value), 1);

  useFrame(({ clock }) => {
    if (!groupRef.current || shouldReduceMotion) return;
    groupRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.32) * 0.16;
  });

  return (
    <group ref={groupRef} position={[-2.4, -1.2, 0]}>
      {data.map((item, index) => {
        const height = Math.max((item.value / maxValue) * 2.9, 0.18);
        return (
          <mesh key={item.status} position={[index * 1.2, height / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.72, height, 0.72]} />
            <meshStandardMaterial args={[{ color: palette[index % palette.length], metalness: 0.25, roughness: 0.28, emissive: palette[index % palette.length], emissiveIntensity: 0.16 }]} />
          </mesh>
        );
      })}
    </group>
  );
}

function PipelineScene({ data }: { data: BiOverview['statusDistribution'] }) {
  return (
    <div className="h-[320px] overflow-hidden rounded-lg border border-slate-200 bg-slate-950 shadow-sm dark:border-slate-700 dark:bg-slate-950">
      <Canvas camera={{ position: [2.6, 2.4, 6.5], fov: 42 }}>
        <ambientLight intensity={0.9} />
        <pointLight position={[3, 5, 4]} intensity={22} color="#14b8a6" />
        <pointLight position={[-4, 2, -2]} intensity={12} color="#ffbf00" />
        <PipelineBars data={data} />
      </Canvas>
    </div>
  );
}

function MetricCard({ label, value, hint, icon: Icon, tone, formatter = money }: { label: string; value: number; hint?: string; icon: any; tone: string; formatter?: (value: number) => string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/70"
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${tone}`} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-3 text-xl font-black text-slate-950 dark:text-white sm:text-2xl">
            <AnimatedNumber value={value} formatter={formatter} />
          </p>
          {hint && <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{hint}</p>}
        </div>
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#074747]/10 text-[#074747] dark:bg-teal-900/40 dark:text-teal-100">
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </motion.div>
  );
}

function ChartPanel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function DataTable({ rows, columns }: { rows: Array<Record<string, any>>; columns: Array<{ key: string; label: string; render?: (value: any, row: any) => React.ReactNode }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-right text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {columns.map((column) => <th key={column.key} className="px-3 py-3 font-bold">{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={row.id || index} className="border-b border-slate-100 text-slate-800 dark:border-slate-800 dark:text-slate-100">
              {columns.map((column) => <td key={column.key} className="px-3 py-3">{column.render ? column.render(row[column.key], row) : row[column.key]}</td>)}
            </tr>
          )) : (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">داده‌ای برای این بازه وجود ندارد.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BiPageContent() {
  const [overview, setOverview] = useState<BiOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('month');
  const [customFrom, setCustomFrom] = useState(PersianCalendar.now('jYYYY/jMM/jDD'));
  const [customTo, setCustomTo] = useState(PersianCalendar.now('jYYYY/jMM/jDD'));
  const [activeTab, setActiveTab] = useState('executive');
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    if (urlTab) setActiveTab(urlTab);
  }, []);

  const params = useMemo(() => ({ ...resolveRange(range, customFrom, customTo), period: range }), [range, customFrom, customTo]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await biAPI.getSalesOverview(params);
      setOverview(response.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'خطا در دریافت اطلاعات BI');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const exportTable = async (table: string) => {
    const response = await biAPI.exportSalesTable(table, params);
    downloadBlob(response.data, `sabalan-bi-${table}.xlsx`);
  };

  const downloadPdf = async () => {
    const response = await biAPI.downloadSalesSummaryPdf(params);
    downloadBlob(response.data, 'sabalan-bi-sales.pdf');
  };

  const cardItems = overview ? [
    { label: 'فروش قطعی', value: overview.cards.realizedSales, icon: FaMoneyBillWave, tone: 'bg-teal-400', hint: 'قراردادهای امضا یا چاپ شده' },
    { label: 'رشد فروش', value: overview.cards.growthPercent, icon: FaChartLine, tone: 'bg-amber-300', formatter: (value: number) => `${numberFa(value)}٪`, hint: `نسبت به ${overview.period.previousLabel}` },
    { label: 'پایپ‌لاین فروش', value: overview.cards.pipelineSales, icon: FaChartPie, tone: 'bg-sky-400', hint: 'در انتظار تایید یا تایید شده' },
    { label: 'مانده قابل دریافت', value: overview.cards.receivableAmount, icon: FaMoneyBillWave, tone: 'bg-rose-400', hint: 'فروش قطعی منهای دریافتی' },
    { label: 'پرداخت‌های معوق', value: overview.cards.overdueAmount, icon: FaMoneyBillWave, tone: 'bg-red-400', hint: 'سررسید گذشته و پرداخت نشده' },
    { label: 'قرارداد قطعی', value: overview.cards.realizedContractCount, icon: FaFilePdf, tone: 'bg-emerald-400', formatter: numberFa, hint: 'تعداد قراردادهای قطعی' },
    { label: 'میانگین ارزش قرارداد', value: overview.cards.averageContractValue, icon: FaChartLine, tone: 'bg-purple-400', hint: 'فروش قطعی تقسیم بر تعداد' },
    { label: 'ریسک تحویل', value: overview.cards.deliveryRiskCount, icon: FaTruck, tone: 'bg-orange-400', formatter: numberFa, hint: 'معوق، نزدیک، یا بدون تایید' },
  ] : [];

  return (
    <div dir="rtl" className="relative min-h-screen overflow-hidden rounded-none text-slate-900 dark:text-white">
      <div className="relative mx-auto max-w-7xl px-3 py-5 sm:px-5 lg:px-6">
        <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black text-[#074747] dark:text-teal-200">هوش تجاری فروش</p>
            <h1 className="mt-2 text-2xl font-black text-slate-950 dark:text-white sm:text-3xl">مرکز فرمان مدیریتی فروش</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              نمای مدیریتی فروش قطعی، پایپ‌لاین، دریافت‌ها، عملکرد فروشندگان، مشتریان، محصولات و ریسک تحویل.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rangeOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => setRange(option.id)}
                className={`min-h-10 rounded-lg border px-3 text-sm font-bold transition ${range === option.id ? 'border-[#074747] bg-[#074747] text-white dark:border-teal-500 dark:bg-teal-900/50 dark:text-teal-100' : 'border-slate-200 bg-white text-slate-700 hover:border-[#074747]/40 hover:text-[#074747] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-600'}`}
              >
                {option.label}
              </button>
            ))}
            <button onClick={loadOverview} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-[#074747]/40 hover:text-[#074747] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-600" title="به‌روزرسانی">
              <FaSync className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={downloadPdf} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-bold text-amber-700 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-200">
              <FaFilePdf /> PDF
            </button>
          </div>
        </header>

        {range === 'custom' && (
          <div className="mb-5 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 sm:grid-cols-2">
            <PersianCalendarPicker value={customFrom} onChange={setCustomFrom} placeholder="از تاریخ" className="glass-liquid-input" />
            <PersianCalendarPicker value={customTo} onChange={setCustomTo} placeholder="تا تاریخ" className="glass-liquid-input" />
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
          <span>بازه: {overview?.period.label || '...'}</span>
          <span>دامنه داده: {overview?.scope.label || '...'}</span>
          <span>آخرین تولید: {overview ? PersianCalendar.formatForDisplay(overview.generatedAt, true) : '...'}</span>
        </div>

        {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/25 dark:text-red-200">{error}</div>}

        {loading && !overview ? (
          <div className="flex min-h-[380px] items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-teal-300" />
          </div>
        ) : overview && (
          <>
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {cardItems.map((item) => <MetricCard key={item.label} {...item} />)}
            </div>

            <div className="mb-5 flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`inline-flex min-h-10 flex-shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-bold transition ${activeTab === tab.id ? 'bg-[#074747] text-white dark:bg-teal-500 dark:text-slate-950' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'}`}>
                    <Icon className="h-4 w-4" /> {tab.label}
                  </button>
                );
              })}
            </div>

            {activeTab === 'executive' && (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                <ChartPanel title="فروش قطعی، پایپ‌لاین و دریافت‌شده">
                  <div className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.trend}>
                        <defs>
                          <linearGradient id="realized" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#14b8a6" stopOpacity={0.55} /><stop offset="95%" stopColor="#14b8a6" stopOpacity={0} /></linearGradient>
                          <linearGradient id="pipeline" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ffbf00" stopOpacity={0.45} /><stop offset="95%" stopColor="#ffbf00" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" stroke={chartAxisStroke} tick={{ fontSize: 11 }} />
                        <YAxis stroke={chartAxisStroke} tickFormatter={(value) => money(Number(value), true)} width={80} />
                        <Tooltip formatter={(value: any) => money(Number(value), false)} contentStyle={chartTooltipStyle} />
                        <Area type="monotone" dataKey="realized" name="فروش قطعی" stroke="#14b8a6" strokeWidth={3} fill="url(#realized)" />
                        <Area type="monotone" dataKey="pipeline" name="پایپ‌لاین" stroke="#ffbf00" strokeWidth={2} fill="url(#pipeline)" />
                        <Line type="monotone" dataKey="collected" name="دریافت‌شده" stroke="#38bdf8" strokeWidth={2} dot={false} />
                        <Legend />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </ChartPanel>
                <ChartPanel title="نمای سه‌بعدی وضعیت ارزش فروش">
                  <PipelineScene data={overview.statusDistribution} />
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-5">
                    {overview.statusDistribution.map((item, index) => <span key={item.status} className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />{item.status}</span>)}
                  </div>
                </ChartPanel>
              </div>
            )}

            {activeTab === 'sellers' && (
              <ChartPanel title="ماتریس عملکرد فروشندگان" action={<button onClick={() => exportTable('sellers')} className={exportButtonClass}><FaDownload /> Excel</button>}>
                <div className="mb-5 h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={overview.sellers.slice(0, 8)}>
                      <CartesianGrid stroke={chartGridStroke} vertical={false} />
                      <XAxis dataKey="name" stroke={chartAxisStroke} tick={{ fontSize: 11 }} />
                      <YAxis stroke={chartAxisStroke} tickFormatter={(value) => money(Number(value), true)} width={80} />
                      <Tooltip formatter={(value: any) => money(Number(value), false)} contentStyle={chartTooltipStyle} />
                      <Bar dataKey="realizedSales" name="فروش قطعی" radius={[8, 8, 0, 0]} fill="#14b8a6" />
                      <Bar dataKey="pipelineAmount" name="پایپ‌لاین" radius={[8, 8, 0, 0]} fill="#ffbf00" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <DataTable rows={overview.sellers} columns={[
                  { key: 'name', label: 'فروشنده' },
                  { key: 'realizedSales', label: 'فروش قطعی', render: money },
                  { key: 'realizedContracts', label: 'قرارداد قطعی', render: numberFa },
                  { key: 'averageContractValue', label: 'میانگین قرارداد', render: money },
                  { key: 'pipelineAmount', label: 'پایپ‌لاین', render: money },
                  { key: 'conversionRate', label: 'نرخ تبدیل', render: (value) => `${numberFa(value)}٪` },
                  { key: 'overdueAmount', label: 'معوق', render: money },
                ]} />
              </ChartPanel>
            )}

            {activeTab === 'finance' && (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <ChartPanel title="ترکیب روش‌های پرداخت" action={<button onClick={() => exportTable('receivables')} className={exportButtonClass}><FaDownload /> Excel</button>}>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={overview.finance.paymentMethodMix}>
                        <CartesianGrid stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="method" stroke={chartAxisStroke} />
                        <YAxis stroke={chartAxisStroke} tickFormatter={(value) => money(Number(value), true)} width={80} />
                        <Tooltip formatter={(value: any) => money(Number(value), false)} contentStyle={chartTooltipStyle} />
                        <Bar dataKey="amount" name="مبلغ" radius={[8, 8, 0, 0]}>
                          {overview.finance.paymentMethodMix.map((_, index) => <Cell key={index} fill={palette[index % palette.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartPanel>
                <ChartPanel title="بیشترین مانده و معوق مشتریان">
                  <DataTable rows={overview.customers.receivableExposure} columns={[
                    { key: 'name', label: 'مشتری' },
                    { key: 'realizedSales', label: 'فروش قطعی', render: money },
                    { key: 'receivableAmount', label: 'مانده', render: money },
                    { key: 'overdueAmount', label: 'معوق', render: money },
                  ]} />
                </ChartPanel>
              </div>
            )}

            {activeTab === 'products' && (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <ChartPanel title="محصولات برتر" action={<button onClick={() => exportTable('products')} className={exportButtonClass}><FaDownload /> Excel</button>}>
                  <DataTable rows={overview.products.topProducts} columns={[
                    { key: 'name', label: 'محصول' },
                    { key: 'code', label: 'کد' },
                    { key: 'realizedSales', label: 'فروش قطعی', render: money },
                    { key: 'quantity', label: 'مقدار', render: numberFa },
                    { key: 'contracts', label: 'ردیف', render: numberFa },
                  ]} />
                </ChartPanel>
                <ChartPanel title="مشتریان و تمرکز فروش" action={<button onClick={() => exportTable('customers')} className={exportButtonClass}><FaDownload /> Excel</button>}>
                  <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-200">
                    سهم ۵ مشتری برتر از فروش قطعی: {numberFa(overview.customers.concentrationTop5Percent)}٪
                  </p>
                  <DataTable rows={overview.customers.topCustomers} columns={[
                    { key: 'name', label: 'مشتری' },
                    { key: 'realizedSales', label: 'فروش قطعی', render: money },
                    { key: 'realizedContracts', label: 'قرارداد قطعی', render: numberFa },
                    { key: 'receivableAmount', label: 'مانده', render: money },
                  ]} />
                </ChartPanel>
                <ChartPanel title="ترکیب نوع محصول">
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={overview.products.productTypeMix}>
                        <CartesianGrid stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="type" stroke={chartAxisStroke} tick={{ fontSize: 11 }} />
                        <YAxis stroke={chartAxisStroke} tickFormatter={(value) => money(Number(value), true)} width={80} />
                        <Tooltip formatter={(value: any) => money(Number(value), false)} contentStyle={chartTooltipStyle} />
                        <Bar dataKey="value" name="ارزش" fill="#14b8a6" radius={[8, 8, 0, 0]} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </ChartPanel>
                <ChartPanel title="محصولات کم‌فروش">
                  <DataTable rows={overview.products.lowPerformingProducts} columns={[
                    { key: 'namePersian', label: 'محصول' },
                    { key: 'code', label: 'کد' },
                  ]} />
                </ChartPanel>
              </div>
            )}

            {activeTab === 'delivery' && (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <ChartPanel title="ریسک تحویل">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['معوق تحویل', overview.delivery.overdue, 'text-red-700 dark:text-red-200'],
                      ['نزدیک/امروز', overview.delivery.upcoming, 'text-amber-700 dark:text-amber-200'],
                      ['بدون تایید مشتری', overview.delivery.deliveredUnconfirmed, 'text-sky-700 dark:text-sky-200'],
                      ['تکمیل‌شده', overview.delivery.completed, 'text-emerald-700 dark:text-emerald-200'],
                    ].map(([label, value, color]) => (
                      <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                        <p className={`mt-2 text-3xl font-black ${color}`}>{numberFa(Number(value))}</p>
                      </div>
                    ))}
                  </div>
                </ChartPanel>
                <ChartPanel title="موارد نیازمند توجه" action={<button onClick={() => exportTable('delivery')} className={exportButtonClass}><FaDownload /> Excel</button>}>
                  <DataTable rows={overview.delivery.rows} columns={[
                    { key: 'contractNumber', label: 'قرارداد' },
                    { key: 'customer', label: 'مشتری' },
                    { key: 'deliveryDate', label: 'تاریخ تحویل', render: (value) => value ? PersianCalendar.formatForDisplay(value) : '—' },
                    { key: 'status', label: 'وضعیت' },
                    { key: 'customerConfirmation', label: 'تایید مشتری', render: (value) => value ? 'تایید شده' : 'بدون تایید' },
                  ]} />
                </ChartPanel>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function BusinessIntelligencePage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-500">در حال بارگذاری...</div>}>
      <BiPageContent />
    </Suspense>
  );
}
