type AccountingContractPrintData = {
  contract: any;
  sourceSnapshot?: any;
  financialRecords?: any[];
  receivables?: any[];
  paymentEvents?: any[];
  tax?: any[];
  flags?: any[];
  correctionRequests?: any[];
  auditTrail?: any[];
};

const EMPTY = '—';
const CURRENCY = 'ریال';

const escapeHtml = (value: unknown): string => {
  const input = value === null || value === undefined || value === '' ? EMPTY : String(value);
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return 0;
  const candidate = typeof value === 'object' && value && 'toString' in value
    ? (value as { toString: () => string }).toString()
    : value;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : 0;
};

const toFaNumber = (value: unknown, fractionDigits = 0): string =>
  new Intl.NumberFormat('fa-IR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(toNumber(value));

const money = (value: unknown): string => `${toFaNumber(value)} ${CURRENCY}`;

const dateFa = (value: unknown, includeTime = false): string => {
  if (!value) return EMPTY;
  const raw = String(value);
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(raw)) return raw;
  const date = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return includeTime ? date.toLocaleString('fa-IR') : date.toLocaleDateString('fa-IR');
};

const customerName = (customer: any): string =>
  customer?.displayName ||
  `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim() ||
  customer?.companyName ||
  EMPTY;

const statusLabels: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  PENDING_APPROVAL: 'در انتظار تایید',
  APPROVED: 'تایید شده',
  SIGNED: 'امضا شده',
  PRINTED: 'چاپ شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی شده',
  VISIBLE_ONLY: 'فقط قابل مشاهده',
  ELIGIBLE: 'آماده اقدام مالی',
  HAS_FINANCIAL_RECORDS: 'دارای رکورد مالی',
  BLOCKED: 'مسدود',
  NEEDS_CORRECTION: 'نیازمند اصلاح',
  NONE: 'ندارد',
  READY: 'آماده',
  ISSUED: 'صادر شده',
  POSTED: 'ثبت شده',
  VOIDED: 'باطل شده',
  OPEN: 'باز',
  PARTIALLY_PAID: 'پرداخت بخشی',
  SETTLED: 'تسویه شده',
  OVERDUE: 'سررسید گذشته',
  NOT_READY: 'آماده نیست',
  MISSING_DATA: 'اطلاعات ناقص',
  SUBMITTED_MANUALLY: 'ثبت دستی',
  SUBMITTED_EXTERNALLY: 'ارسال بیرونی',
  ACCEPTED: 'پذیرفته شده',
  REJECTED: 'رد شده',
  RECEIVED: 'دریافت شده',
  RECONCILED: 'تطبیق شده',
  EXPECTED: 'مورد انتظار',
  DEPOSITED: 'واگذار شده',
  CLEARED: 'پاس شده',
  BOUNCED: 'برگشتی',
  DISPUTED: 'اختلافی',
  PENDING_HANDOVER: 'در انتظار تحویل',
  INVOICE_CANDIDATE: 'صورتحساب',
  RECEIVABLE: 'دریافتنی',
  PAYMENT: 'دریافت',
  TAX: 'مالیات',
  CORRECTION: 'اصلاحیه',
  CASH: 'نقدی',
  BANK_TRANSFER: 'انتقال بانکی',
  CHECK: 'چک',
  OTHER: 'سایر',
  LOW: 'کم',
  MEDIUM: 'متوسط',
  HIGH: 'زیاد',
  URGENT: 'فوری',
  BLOCKER: 'مسدودکننده',
  CREATE_INVOICE: 'ایجاد صورتحساب',
  APPROVE_FINANCIAL_INVOICE: 'تایید مالی',
  CREATE_RECEIVABLE: 'ایجاد دریافتنی',
  REGISTER_RECEIPT: 'ثبت دریافت',
  UPDATE_CHECK_STATUS: 'به‌روزرسانی وضعیت چک',
  MARK_TAX_READY: 'آمادگی مالیات',
  TRACK_TAX_SUBMISSION: 'پیگیری سامانه مودیان',
  REQUEST_CORRECTION: 'درخواست اصلاح',
  FLAG_CONTRACT: 'پرچم حسابداری',
  VOID_ACCOUNTING_RECORD: 'ابطال رکورد'
};

const label = (value: unknown): string => {
  const key = String(value || '');
  return statusLabels[key] || key || EMPTY;
};

const rowsOrEmpty = (rows: string[], colspan: number) =>
  rows.length ? rows.join('') : `<tr><td colspan="${colspan}" class="empty">${EMPTY}</td></tr>`;

const summaryItem = (title: string, value: unknown) => `
  <div class="summary-item">
    <span>${escapeHtml(title)}</span>
    <strong>${escapeHtml(value)}</strong>
  </div>
`;

const renderSourceItems = (items: any[] = []) => rowsOrEmpty(items.map((item, index) => `
  <tr>
    <td>${toFaNumber(index + 1)}</td>
    <td>${escapeHtml(item.productName || item.description)}</td>
    <td>${toFaNumber(item.quantity, 3)}</td>
    <td>${money(item.unitPrice)}</td>
    <td>${money(item.totalPrice)}</td>
  </tr>
`), 5);

const renderFinancialRecords = (records: any[] = []) => rowsOrEmpty(records.map((record, index) => `
  <tr>
    <td>${toFaNumber(index + 1)}</td>
    <td>${escapeHtml(label(record.kind))}</td>
    <td>${escapeHtml(label(record.status))}</td>
    <td>${money(record.amount)}</td>
    <td>${escapeHtml(record.systemInvoiceNumber)}</td>
    <td>${escapeHtml(dateFa(record.systemInvoiceDate))}</td>
    <td>${record.sepidarAmount == null ? EMPTY : money(record.sepidarAmount)}</td>
    <td>${escapeHtml(dateFa(record.financiallyApprovedAt || record.postedAt || record.createdAt, true))}</td>
  </tr>
`), 8);

const renderReceivables = (receivables: any[] = []) => rowsOrEmpty(receivables.map((item, index) => `
  <tr>
    <td>${toFaNumber(index + 1)}</td>
    <td>${escapeHtml(label(item.status))}</td>
    <td>${money(item.originalAmount)}</td>
    <td>${money(item.paidAmount)}</td>
    <td>${money(item.remainingAmount)}</td>
    <td>${escapeHtml(dateFa(item.dueDate))}</td>
  </tr>
`), 6);

const renderPayments = (payments: any[] = []) => rowsOrEmpty(payments.map((item, index) => `
  <tr>
    <td>${toFaNumber(index + 1)}</td>
    <td>${escapeHtml(label(item.method))}</td>
    <td>${escapeHtml(label(item.status))}</td>
    <td>${escapeHtml(label(item.checkStatus))}</td>
    <td>${money(item.amount)}</td>
    <td>${escapeHtml(item.checkNumber)}</td>
    <td>${escapeHtml(item.checkOwnerName)}</td>
    <td>${escapeHtml(dateFa(item.checkDueDate || item.occurredAt || item.createdAt))}</td>
  </tr>
`), 8);

const renderTaxRecords = (records: any[] = []) => rowsOrEmpty(records.map((item, index) => `
  <tr>
    <td>${toFaNumber(index + 1)}</td>
    <td>${escapeHtml(label(item.readinessStatus))}</td>
    <td>${escapeHtml(label(item.submissionStatus))}</td>
    <td>${money(item.taxableAmount)}</td>
    <td>${toFaNumber(item.vatRate, 2)}٪</td>
    <td>${money(item.vatAmount)}</td>
    <td>${escapeHtml(item.trackingCode)}</td>
    <td>${escapeHtml((item.missingFields || []).join('، ') || item.rejectionReason || item.notes)}</td>
  </tr>
`), 8);

const renderFlags = (flags: any[] = []) => rowsOrEmpty(flags.map((item, index) => `
  <tr>
    <td>${toFaNumber(index + 1)}</td>
    <td>${escapeHtml(label(item.status))}</td>
    <td>${escapeHtml(label(item.severity))}</td>
    <td>${escapeHtml(item.title)}</td>
    <td>${escapeHtml(item.note)}</td>
    <td>${escapeHtml(dateFa(item.createdAt, true))}</td>
  </tr>
`), 6);

const renderCorrections = (items: any[] = []) => rowsOrEmpty(items.map((item, index) => `
  <tr>
    <td>${toFaNumber(index + 1)}</td>
    <td>${escapeHtml(label(item.status))}</td>
    <td>${escapeHtml(label(item.priority))}</td>
    <td>${escapeHtml(label(item.category))}</td>
    <td>${escapeHtml(item.accountantNote)}</td>
    <td>${escapeHtml(item.resolutionNote)}</td>
  </tr>
`), 6);

const renderAudit = (items: any[] = []) => rowsOrEmpty(items.slice(0, 10).map((item, index) => `
  <tr>
    <td>${toFaNumber(index + 1)}</td>
    <td>${escapeHtml(label(item.action))}</td>
    <td>${escapeHtml(item.actorId)}</td>
    <td>${escapeHtml(dateFa(item.createdAt, true))}</td>
    <td>${escapeHtml(item.note)}</td>
  </tr>
`), 5);

export function renderAccountingContractHtml(data: AccountingContractPrintData): string {
  const contract = data.contract || {};
  const source = data.sourceSnapshot || {};
  const accounting = contract.accounting || {};
  const generatedAt = new Date();
  const contractDate = contract.contractDate || contract.signedAt || contract.createdAt;

  return `
    <style>
      @page { size: A4 landscape; margin: 6mm; }
      * { box-sizing: border-box; }
      html, body { width: 100%; margin: 0; padding: 0; overflow: hidden; }
      body { color: #111827; font-size: 8.5px; line-height: 1.35; }
      .sheet { width: 88%; max-width: 88%; margin: 0 2% 0 10%; overflow: hidden; }
      .top { display: grid; grid-template-columns: 1.2fr .8fr; gap: 8px; border-bottom: 2px solid #0f766e; padding-bottom: 6px; margin-bottom: 6px; }
      h1 { margin: 0; font-size: 16px; line-height: 1.4; }
      h2 { margin: 0 0 4px; font-size: 11px; color: #0f766e; }
      .subtitle { margin-top: 2px; color: #475569; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 8px; text-align: right; }
      .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 6px; }
      .summary-item { border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 5px; min-height: 30px; }
      .summary-item span { display: block; color: #64748b; font-size: 8px; }
      .summary-item strong { display: block; margin-top: 1px; font-size: 10px; }
      .section { break-inside: avoid; margin-top: 6px; }
      table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #cbd5e1; padding: 2px 3px; vertical-align: top; overflow: hidden; overflow-wrap: anywhere; word-break: break-word; white-space: normal; }
      th { background: #ecfdf5; color: #134e4a; font-weight: 800; }
      .empty { text-align: center; color: #94a3b8; }
      .two { display: block; }
      .two > div { min-width: 0; overflow: hidden; }
      .two > div + div { margin-top: 6px; }
      .footer { display: flex; justify-content: space-between; border-top: 1px solid #cbd5e1; margin-top: 8px; padding-top: 4px; color: #64748b; }
    </style>
    <main class="sheet">
      <header class="top">
        <div>
          <h1>پرونده حسابداری قرارداد ${escapeHtml(contract.contractNumber)}</h1>
          <div class="subtitle">${escapeHtml(contract.titlePersian || source.titlePersian || 'قرارداد فروش')}</div>
        </div>
        <div class="meta">
          <span>تاریخ قرارداد: ${escapeHtml(dateFa(contractDate))}</span>
          <span>تاریخ چاپ: ${escapeHtml(dateFa(generatedAt, true))}</span>
          <span>مشتری: ${escapeHtml(customerName(contract.customer))}</span>
          <span>کد ملی/اقتصادی: ${escapeHtml(contract.customer?.nationalCode || contract.customer?.economicCode)}</span>
        </div>
      </header>

      <section class="summary">
        ${summaryItem('وضعیت قرارداد', label(contract.status))}
        ${summaryItem('وضعیت حسابداری', label(accounting.sourceStatus))}
        ${summaryItem('صورتحساب', label(accounting.invoiceStatus))}
        ${summaryItem('دریافتی', label(accounting.receivableStatus))}
        ${summaryItem('مبلغ قرارداد', money(accounting.totalContractAmount || source.totalAmount))}
        ${summaryItem('صورتحساب شده', money(accounting.invoicedAmount))}
        ${summaryItem('دریافت شده', money(accounting.receivedAmount))}
        ${summaryItem('مانده', money(accounting.remainingAmount))}
      </section>

      <section class="section">
        <h2>اقلام قرارداد فروش - نمایش حسابداری به ریال</h2>
        <table>
          <thead><tr><th>ردیف</th><th>شرح</th><th>مقدار</th><th>فی</th><th>مبلغ کل</th></tr></thead>
          <tbody>${renderSourceItems(source.items || [])}</tbody>
        </table>
      </section>

      <section class="section">
        <h2>رکوردهای مالی و اطلاعات سپیدار</h2>
        <table>
          <thead><tr><th>ردیف</th><th>نوع</th><th>وضعیت</th><th>مبلغ</th><th>شماره فاکتور سیستمی</th><th>تاریخ فاکتور سیستمی</th><th>مبلغ سپیدار</th><th>تاریخ ثبت</th></tr></thead>
          <tbody>${renderFinancialRecords(data.financialRecords || [])}</tbody>
        </table>
      </section>

      <section class="section">
        <h2>دریافتنی‌ها</h2>
        <table>
          <thead><tr><th>ردیف</th><th>وضعیت</th><th>اصل مبلغ</th><th>پرداخت شده</th><th>مانده</th><th>سررسید</th></tr></thead>
          <tbody>${renderReceivables(data.receivables || [])}</tbody>
        </table>
      </section>

      <section class="section">
        <h2>دریافت‌ها و چک‌ها</h2>
        <table>
          <thead><tr><th>ردیف</th><th>روش</th><th>وضعیت</th><th>وضعیت چک</th><th>مبلغ</th><th>شماره چک</th><th>صاحب چک</th><th>تاریخ</th></tr></thead>
          <tbody>${renderPayments(data.paymentEvents || [])}</tbody>
        </table>
      </section>

      <section class="section">
        <h2>مالیات و سامانه مودیان</h2>
        <table>
          <thead><tr><th>ردیف</th><th>آمادگی</th><th>ارسال</th><th>مشمول</th><th>نرخ</th><th>ارزش افزوده</th><th>کد پیگیری</th><th>یادداشت/کسری</th></tr></thead>
          <tbody>${renderTaxRecords(data.tax || [])}</tbody>
        </table>
      </section>

      <section class="section two">
        <div>
          <h2>پرچم‌ها</h2>
          <table>
            <thead><tr><th>ردیف</th><th>وضعیت</th><th>شدت</th><th>عنوان</th><th>یادداشت</th><th>تاریخ</th></tr></thead>
            <tbody>${renderFlags(data.flags || [])}</tbody>
          </table>
        </div>
        <div>
          <h2>درخواست‌های اصلاح</h2>
          <table>
            <thead><tr><th>ردیف</th><th>وضعیت</th><th>اولویت</th><th>دسته</th><th>یادداشت</th><th>نتیجه</th></tr></thead>
            <tbody>${renderCorrections(data.correctionRequests || [])}</tbody>
          </table>
        </div>
      </section>

      <section class="section">
        <h2>خلاصه سوابق عملیات - ۱۰ مورد آخر</h2>
        <table>
          <thead><tr><th>ردیف</th><th>عملیات</th><th>کاربر</th><th>تاریخ</th><th>یادداشت</th></tr></thead>
          <tbody>${renderAudit(data.auditTrail || [])}</tbody>
        </table>
      </section>

      <footer class="footer">
        <span>Sabalan ERP</span>
        <span>پرونده حسابداری قرارداد</span>
        <span>${escapeHtml(contract.contractNumber)}</span>
      </footer>
    </main>
  `;
}
