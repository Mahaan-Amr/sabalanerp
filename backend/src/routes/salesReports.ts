import express, { Response } from 'express';
import path from 'path';
import fs from 'fs';
import { Prisma, PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES, WorkspaceRequest } from '../middleware/workspace';
import { buildSalesReport, getSalesReportSellers, SalesReportAccess } from '../services/salesReportingService';
import { generatePdfFromHtml } from '../utils/pdf';
import { renderReportPdfHeaderTemplate, renderYekanFontFaces } from '../utils/printTemplate';
import { formatMoney, roundMoneyFields } from '../utils/money';

const router = express.Router();
const prisma = new PrismaClient();
const reportAccess = [protect, requireWorkspaceAccess(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.VIEW)];

const accessFor = (req: WorkspaceRequest): SalesReportAccess => ({
  userId: req.user!.id,
  role: req.user!.role,
  departmentId: req.user!.departmentId,
  canManage: req.user!.role === 'ADMIN' || req.workspacePermission === WORKSPACE_PERMISSIONS.ADMIN,
  canCompany: req.user!.role === 'ADMIN',
  canOpenSalesSource: true,
});

const escape = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (value: unknown) => formatMoney(value);
const rial = (value: unknown) => formatMoney(value, 'ریال');
const reportDate = (value: Date | string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tehran',
}).format(new Date(value));

const safeConfig = (body: any) => {
  const allowedSections = ['overview', 'contracts', 'customers', 'products', 'finance', 'delivery', 'sellers', 'accountingRegistered'];
  const allowedContractColumns = ['contractNumber', 'customer', 'project', 'status', 'statusDescription', 'amount', 'responsibleSeller', 'realizedSeller'];
  const sections = Array.isArray(body?.sections)
    ? body.sections.map(String).filter((section: string) => allowedSections.includes(section))
    : allowedSections;
  const contractColumns = Array.isArray(body?.contractColumns)
    ? body.contractColumns.map(String).filter((column: string) => allowedContractColumns.includes(column))
    : allowedContractColumns;
  return {
    title: String(body?.title || 'گزارش جامع فروش').slice(0, 120),
    subtitle: String(body?.subtitle || '').slice(0, 240),
    note: String(body?.note || '').slice(0, 1000),
    orientation: body?.orientation === 'portrait' ? 'portrait' : 'landscape',
    pageSize: ['A4', 'A3'].includes(body?.pageSize) ? body.pageSize : 'A4',
    sections: sections.length ? sections : ['overview'],
    includeCharts: body?.includeCharts !== false,
    includeTables: body?.includeTables !== false,
    contractColumns: contractColumns.length ? contractColumns : ['contractNumber']
  };
};

const table = (headers: string[], rows: unknown[][]) => `
  <table><thead><tr>${headers.map((header) => `<th>${escape(header)}</th>`).join('')}</tr></thead>
  <tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty">داده‌ای در این دامنه وجود ندارد.</td></tr>`}</tbody></table>`;

const trendSvg = (rows: any[]) => {
  const values = rows.flatMap((row) => [Math.abs(row.net), Math.abs(row.pipeline)]);
  const max = Math.max(...values, 1);
  const width = 900;
  const height = 250;
  const step = rows.length > 1 ? (width - 90) / (rows.length - 1) : width - 90;
  const point = (value: number, index: number) => `${45 + index * step},${height - 45 - (Math.max(value, 0) / max) * (height - 85)}`;
  const netPoints = rows.map((row, index) => point(row.net, index)).join(' ');
  const pipelinePoints = rows.map((row, index) => point(row.pipeline, index)).join(' ');
  const labelStep = Math.max(1, Math.ceil(rows.length / 8));
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="روند فروش از قدیمی در سمت راست تا جدید در سمت چپ">
    <line x1="40" y1="${height - 40}" x2="${width - 20}" y2="${height - 40}" stroke="#94a3b8" />
    <polyline points="${netPoints}" fill="none" stroke="#0f766e" stroke-width="4" />
    <polyline points="${pipelinePoints}" fill="none" stroke="#f59e0b" stroke-width="3" stroke-dasharray="7 5" />
    ${rows.map((row, index) => (index === 0 || index === rows.length - 1 || index % labelStep === 0) ? `<text x="${45 + index * step}" y="${height - 17}" text-anchor="middle" font-size="10">${escape(row.label)}</text>` : '').join('')}
  </svg><div class="legend"><span><i class="teal"></i>فروش خالص</span><span><i class="amber"></i>پایپ‌لاین</span></div></div>`;
};

const renderReport = (report: any, config: ReturnType<typeof safeConfig>) => {
  const contractColumnDefinitions: Record<string, { label: string; value: (row: any) => unknown }> = {
    contractNumber: { label: 'شماره قرارداد', value: (row) => row.contractNumber },
    customer: { label: 'مشتری', value: (row) => row.customer },
    project: { label: 'پروژه', value: (row) => row.project },
    status: { label: 'وضعیت', value: (row) => row.statusLabel },
    statusDescription: { label: 'معنی وضعیت', value: (row) => row.statusDescription },
    amount: { label: 'مبلغ', value: (row) => money(row.amount) },
    responsibleSeller: { label: 'مسئول فروش', value: (row) => row.responsibleSeller },
    realizedSeller: { label: 'اعتبار فروش قطعی', value: (row) => row.realizedSeller }
  };
  const contractColumns = config.contractColumns.map((key) => contractColumnDefinitions[key]);
  const optionalTable = (html: string) => config.includeTables ? html : '';
  const sections: Record<string, string> = {
    overview: `<section><h2>نمای کلی</h2><div class="cards">
      ${[
        ['فروش قطعی ناخالص', money(report.cards.grossRealized)],
        ['تعدیلات', money(report.cards.adjustments)],
        ['فروش قطعی خالص', money(report.cards.netRealized)],
        ['پایپ‌لاین', money(report.cards.pipelineValue)],
        ['از دست رفته', money(report.cards.lostValue)],
        ['نرخ موفقیت قراردادهای تعیین‌تکلیف‌شده', report.cards.successRate == null ? 'نامشخص' : `${Number(report.cards.successRate).toLocaleString('fa-IR')}٪`]
      ].map(([label, value]) => `<div class="card"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join('')}
    </div>${config.includeCharts ? trendSvg(report.trend) : ''}</section>`,
    contracts: `<section><h2>قراردادها و وضعیت واقعی</h2>${optionalTable(table(
      contractColumns.map((column) => column.label),
      report.contracts.map((row: any) => contractColumns.map((column) => column.value(row)))
    ))}</section>`,
    customers: `<section><h2>مشتریان و پروژه‌ها</h2>${optionalTable(table(['مشتری', 'فروش قطعی', 'تعداد قرارداد'], report.customers.map((row: any) => [row.name, money(row.value), row.contracts.toLocaleString('fa-IR')])))}</section>`,
    products: `<section><h2>محصولات و خدمات</h2>${optionalTable(table(['محصول', 'کد', 'ارزش', 'مقدار', 'قرارداد'], report.products.map((row: any) => [row.name, row.code, money(row.value), Number(row.quantity).toLocaleString('fa-IR'), row.contracts.toLocaleString('fa-IR')])))}</section>`,
    finance: `<section><h2>پرداخت و وصول</h2><p class="coverage">پوشش حسابداری: ${report.finance.coverage.coveredContracts.toLocaleString('fa-IR')} از ${report.finance.coverage.totalContracts.toLocaleString('fa-IR')} قرارداد</p>${optionalTable(table(['حقیقت', 'مقدار', 'منبع'], [
      ['برنامه پرداخت فروش', money(report.finance.plannedPaymentAmount), 'فروش'],
      ['دریافت واقعی', money(report.finance.receivedAmount), 'حسابداری'],
      ['مانده دریافتنی', money(report.finance.receivableAmount), 'حسابداری']
    ]))}</section>`,
    delivery: `<section><h2>تحویل و بارگیری</h2><p class="coverage">پوشش لجستیک: ${report.delivery.coverage.coveredContracts.toLocaleString('fa-IR')} از ${report.delivery.coverage.totalContracts.toLocaleString('fa-IR')} قرارداد</p>${optionalTable(table(['حقیقت', 'تعداد', 'منبع'], [
      ['تحویل وعده‌داده‌شده', report.delivery.promisedDeliveries.toLocaleString('fa-IR'), 'فروش'],
      ['بارگیری نهایی', report.delivery.finalizedLoadings.toLocaleString('fa-IR'), 'لجستیک'],
      ['خروج ثبت‌شده', report.delivery.exitedLoadings.toLocaleString('fa-IR'), 'گارد']
    ]))}</section>`,
    accountingRegistered: report.permissions.canViewSellerComparisons ? `<section><h2>ثبت حسابداری فروشندگان</h2>${report.accountingRegistered.available ? optionalTable(`${table(
      ['فروشندهٔ قطعی', 'تعداد قرارداد', 'جمع مبلغ (ریال)'],
      [
        ...report.accountingRegistered.rows.map((row: any) => [row.name, row.contractCount.toLocaleString('fa-IR'), rial(row.totalAmount)]),
        ...(report.accountingRegistered.unassigned ? [['فروشندهٔ قطعی تخصیص‌نیافته', report.accountingRegistered.unassigned.contractCount.toLocaleString('fa-IR'), rial(report.accountingRegistered.unassigned.totalAmount)]] : []),
        ['جمع کل', report.accountingRegistered.contractCount.toLocaleString('fa-IR'), rial(report.accountingRegistered.totalAmount)],
      ]
    )}${table(
      ['شماره قرارداد', 'مشتری', 'فروشندهٔ قطعی', 'تاریخ تأیید مالی', 'مبلغ (ریال)', 'وضعیت'],
      report.accountingRegistered.details.map((row: any) => [row.contractNumber, row.customer, row.sellerName, reportDate(row.financiallyApprovedAt), rial(row.amount), row.hasConflict ? 'تعارض رکورد مالی' : 'معتبر'])
    )}`) : '<p class="coverage">دادهٔ حسابداری در دسترس نیست؛ مبلغ صفر گزارش نشده است.</p>'}</section>` : '',
    sellers: report.permissions.canViewSellerComparisons ? `<section><h2>عملکرد فروشندگان</h2>${optionalTable(table(
      ['فروشنده', 'ایجاد قرارداد', 'پایپ‌لاین', 'فروش قطعی', 'تعدیل', 'خالص', 'از دست رفته'],
      report.sellers.map((row: any) => [row.name, row.createdCount.toLocaleString('fa-IR'), money(row.pipelineValue), money(row.realizedValue), money(row.adjustments), money(row.netRealized), row.lostCount.toLocaleString('fa-IR')])
    ))}</section>` : ''
  };
  return `<style>
    ${renderYekanFontFaces()}
    *{box-sizing:border-box}body{margin:0;color:#172033;font-family:'Yekan Bakh',Tahoma,Arial,sans-serif;direction:rtl}.sheet{padding:3mm 6mm}.title{border-bottom:2px solid #0f766e;padding-bottom:10px}.title h1{margin:0;color:#075252;font-size:22px}.title p{margin:5px 0 0;color:#64748b}.note{margin:10px 0;padding:8px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:7px;white-space:pre-wrap}section{break-inside:avoid;margin-top:16px}h2{font-size:15px;color:#075252;margin:0 0 8px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.card{border:1px solid #d7e1e7;border-radius:8px;padding:8px;background:#fbfefe}.card span{display:block;font-size:9px;color:#64748b}.card strong{display:block;margin-top:4px;font-size:13px;color:#0f3f3f}table{width:100%;border-collapse:collapse;margin-top:6px;page-break-inside:auto}tr{page-break-inside:avoid}th,td{border:1px solid #d7dee5;padding:6px;text-align:right;font-size:8.5px;vertical-align:top}th{background:#eef7f6;color:#075252}.empty{text-align:center;color:#64748b}.coverage{font-size:9px;background:#fff7dd;border:1px solid #f5d87a;padding:7px;border-radius:6px}.chart{direction:rtl;margin-top:8px;border:1px solid #e2e8f0;border-radius:8px;padding:5px}.chart svg{width:100%;height:190px}.legend{display:flex;gap:16px;justify-content:center;font-size:9px}.legend i{display:inline-block;width:12px;height:3px;margin-left:4px}.teal{background:#0f766e}.amber{background:#f59e0b}
  </style><div class="sheet"><div class="title"><h1>${escape(config.title)}</h1>${config.subtitle ? `<p>${escape(config.subtitle)}</p>` : ''}<p>${escape(report.period.label)} · ${escape(report.scope.label)} · آخرین به‌روزرسانی ${escape(report.generatedAtLabel)}</p></div>${config.note ? `<div class="note">${escape(config.note)}</div>` : ''}${config.sections.map((key) => sections[key] || '').join('')}</div>`;
};

router.get('/overview', ...reportAccess, async (req: WorkspaceRequest, res: Response) => {
  try { res.json({ success: true, data: await buildSalesReport(accessFor(req), req.query) }); }
  catch (error: any) { res.status(error.message.includes('permitted') ? 403 : 400).json({ success: false, error: error.message }); }
});

router.get('/sellers', ...reportAccess, async (req: WorkspaceRequest, res: Response) => {
  const access = accessFor(req);
  res.json({ success: true, data: await getSalesReportSellers(access, typeof req.query.departmentId === 'string' ? req.query.departmentId : null) });
});

router.get('/presets', ...reportAccess, async (req: WorkspaceRequest, res: Response) => {
  const access = accessFor(req);
  const rows = await prisma.salesReportPreset.findMany({
    where: {
      isActive: true,
      OR: [
        { visibility: 'PERSONAL', ownerId: access.userId },
        ...(access.departmentId ? [{ visibility: 'DEPARTMENT', departmentId: access.departmentId }] : []),
        { visibility: 'COMPANY' }
      ]
    },
    orderBy: [{ visibility: 'asc' }, { name: 'asc' }]
  });
  res.json({ success: true, data: rows });
});

router.post('/presets', ...reportAccess, async (req: WorkspaceRequest, res: Response) => {
  const access = accessFor(req);
  const visibility = ['PERSONAL', 'DEPARTMENT', 'COMPANY'].includes(req.body?.visibility) ? req.body.visibility : 'PERSONAL';
  if (visibility === 'DEPARTMENT' && !access.canManage) return res.status(403).json({ success: false, error: 'Department presets require Sales admin access' });
  if (visibility === 'COMPANY' && !access.canCompany) return res.status(403).json({ success: false, error: 'Company presets require global admin access' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ success: false, error: 'Preset name is required' });
  const preset = await prisma.salesReportPreset.create({
    data: {
      name: name.slice(0, 100), ownerId: access.userId, visibility,
      departmentId: visibility === 'DEPARTMENT' ? access.departmentId : null,
      configuration: safeConfig(req.body?.configuration) as unknown as Prisma.InputJsonValue
    }
  });
  res.status(201).json({ success: true, data: preset });
});

router.delete('/presets/:id', ...reportAccess, async (req: WorkspaceRequest, res: Response) => {
  const access = accessFor(req);
  const preset = await prisma.salesReportPreset.findUnique({ where: { id: req.params.id } });
  if (!preset) return res.status(404).json({ success: false, error: 'Preset not found' });
  if (preset.ownerId !== access.userId && !access.canCompany) return res.status(403).json({ success: false, error: 'Access denied' });
  await prisma.salesReportPreset.update({ where: { id: preset.id }, data: { isActive: false } });
  res.json({ success: true });
});

router.post('/export.pdf', ...reportAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const report = await buildSalesReport(accessFor(req), req.body?.filters || {});
    const config = safeConfig(req.body?.configuration || {});
    if (!report.permissions.canViewSellerComparisons) config.sections = config.sections.filter((section) => !['sellers', 'accountingRegistered'].includes(section));
    if (config.sections.includes('accountingRegistered') && !report.accountingRegistered.available) {
      throw new Error('Accounting data is unavailable');
    }
    const isA3 = config.pageSize === 'A3';
    const landscape = config.orientation === 'landscape';
    const dimensions = isA3 ? (landscape ? { widthMm: 420, heightMm: 297 } : { widthMm: 297, heightMm: 420 }) : {};
    const file = await generatePdfFromHtml({
      htmlContent: renderReport(report, config),
      outputDir: path.join(process.cwd(), 'storage', 'sales-reports'),
      fileName: `sales-report-${Date.now()}`,
      landscape,
      ...dimensions,
      displayHeaderFooter: true,
      headerTemplate: renderReportPdfHeaderTemplate({ title: config.title, reportRange: report.period.label, scopeLabel: report.scope.label, generatedAt: report.generatedAtLabel }),
      margin: { top: '34mm', right: '5mm', bottom: '7mm', left: '5mm' }
    });
    res.download(file, `sales-report-${Date.now()}.pdf`, () => fs.unlink(file, () => undefined));
  } catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/export.xlsx', ...reportAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const report = await buildSalesReport(accessFor(req), req.body?.filters || {});
    const config = safeConfig(req.body?.configuration || {});
    const workbook = XLSX.utils.book_new();
    const add = (name: string, rows: any[]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
    if (config.sections.includes('overview')) add('نمای کلی', [roundMoneyFields(report.cards, ['grossRealized', 'adjustments', 'netRealized', 'pipelineValue', 'lostValue'])]);
    if (config.sections.includes('contracts') && config.includeTables) add('قراردادها', report.contracts.map((row: any) => roundMoneyFields(Object.fromEntries(config.contractColumns.map((column) => [column, row[column === 'status' ? 'statusLabel' : column]])), ['amount'])));
    if (config.sections.includes('customers')) add('مشتریان', report.customers.map((row: any) => roundMoneyFields(row, ['value'])));
    if (config.sections.includes('products')) add('محصولات', report.products.map((row: any) => roundMoneyFields(row, ['value'])));
    if (config.sections.includes('finance')) add('پرداخت و وصول', [roundMoneyFields({ ...report.finance, coverage: `${report.finance.coverage.coveredContracts}/${report.finance.coverage.totalContracts}` }, ['plannedPaymentAmount', 'receivedAmount', 'receivableAmount'])]);
    if (config.sections.includes('delivery')) add('تحویل و بارگیری', [{ ...report.delivery, coverage: `${report.delivery.coverage.coveredContracts}/${report.delivery.coverage.totalContracts}` }]);
    if (config.sections.includes('sellers') && report.permissions.canViewSellerComparisons) add('فروشندگان', report.sellers.map((row: any) => roundMoneyFields(row, ['pipelineValue', 'realizedValue', 'adjustments', 'netRealized'])));
    if (config.sections.includes('accountingRegistered') && report.permissions.canViewSellerComparisons) {
      if (!report.accountingRegistered.available) throw new Error('Accounting data is unavailable');
      add('ثبت حسابداری فروشندگان', [
        ...report.accountingRegistered.rows.map((row: any) => roundMoneyFields({ seller: row.name, contractCount: row.contractCount, totalAmountRial: row.totalAmount }, ['totalAmountRial'])),
        ...(report.accountingRegistered.unassigned ? [roundMoneyFields({ seller: 'فروشندهٔ قطعی تخصیص‌نیافته', contractCount: report.accountingRegistered.unassigned.contractCount, totalAmountRial: report.accountingRegistered.unassigned.totalAmount }, ['totalAmountRial'])] : []),
        roundMoneyFields({ seller: 'جمع کل', contractCount: report.accountingRegistered.contractCount, totalAmountRial: report.accountingRegistered.totalAmount }, ['totalAmountRial']),
      ]);
      add('جزئیات ثبت حسابداری', report.accountingRegistered.details.map((row: any) => roundMoneyFields({
        contractNumber: row.contractNumber,
        customer: row.customer,
        realizedSeller: row.sellerName,
        financiallyApprovedAt: row.financiallyApprovedAt,
        amountRial: row.amount,
        status: row.hasConflict ? 'تعارض رکورد مالی' : 'معتبر',
      }, ['amountRial'])));
    }
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-report.xlsx"');
    res.send(buffer);
  } catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});

export default router;
