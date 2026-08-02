import express, { Response } from 'express';
import path from 'path';
import * as XLSX from 'xlsx';
import { protect, authorize } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES, WorkspaceRequest } from '../middleware/workspace';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess } from '../middleware/feature';
import { generatePdfFromHtml } from '../utils/pdf';
import { renderReportPdfHeaderTemplate, renderYekanFontFaces } from '../utils/printTemplate';
import { buildBiSnapshot, BiSnapshot } from '../services/biSnapshotService';
import { buildBiAnalysisPage } from '../services/biAnalysisService';

const router = express.Router();

const formatFaDateTime = (date: Date) =>
  new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const biSourceLabels: Record<BiSnapshot['sourceHealth'][number]['source'], string> = {
  SALES: 'فروش',
  CRM: 'ارتباط با مشتری',
  ACCOUNTING: 'حسابداری',
  LOGISTICS: 'لجستیک',
  SECURITY: 'نگهبانی',
};

const biSourceStateLabels: Record<BiSnapshot['sourceHealth'][number]['state'], string> = {
  complete: 'کامل',
  partial: 'ناقص',
  unavailable: 'در دسترس نیست',
  unauthorized: 'بدون دسترسی',
};

const sourceStateLabel = (overview: BiSnapshot, source: BiSnapshot['sourceHealth'][number]['source']) => {
  const state = overview.sourceHealth.find((row) => row.source === source)?.state;
  return state ? biSourceStateLabels[state] : 'در دسترس نیست';
};

const renderBiReportHtml = (overview: BiSnapshot) => {
  const cardRows = [
    ['فروش قطعی خالص', overview.cards.netRealized],
    ['تغییر دوره', overview.cards.growthPercent == null ? '—' : `${overview.cards.growthPercent}%`],
    ['پایپ‌لاین فعال', overview.cards.currentPipelineValue],
    ['قرارداد باز', overview.cards.currentPipelineCount],
    ['مانده وصول', overview.sourceAvailability.accounting ? overview.finance.receivableAmount : '—'],
    ['وعده تحویل', overview.delivery.promisedDeliveries],
    ['بارگیری نهایی', overview.sourceAvailability.logistics ? overview.delivery.finalizedLoadings : '—'],
    ['خروج ثبت‌شده', overview.sourceAvailability.security ? overview.delivery.exitedLoadings : '—'],
  ];

  const renderRows = (rows: Array<Array<unknown>>) => rows.map((row) => `
    <tr>${row.map((cell) => `<td>${typeof cell === 'number' ? cell.toLocaleString('fa-IR') : escapeHtml(cell)}</td>`).join('')}</tr>
  `).join('');

  return `
    <style>
      ${renderYekanFontFaces()}
      body { margin: 0; color: #1f2937; font-family: 'Yekan Bakh', Tahoma, Arial, sans-serif; }
      .sheet { padding: 8mm; padding-top: 2mm; direction: rtl; }
      h1 { margin: 0 0 10px; font-size: 18px; color: #074747; }
      h2 { margin: 18px 0 8px; font-size: 13px; color: #074747; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
      th, td { border: 1px solid #d1d5db; padding: 7px; font-size: 10px; text-align: right; }
      th { background: #f3f4f6; font-weight: 800; }
      .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
      .card { border: 1px solid #d1d5db; border-radius: 8px; padding: 9px; background: #fbfdff; }
      .label { color: #64748b; font-size: 9px; }
      .value { color: #074747; font-size: 14px; font-weight: 900; margin-top: 4px; }
    </style>
    <div class="sheet">
      <h1>هوش تجاری</h1>
      <div class="summary">
        ${cardRows.map(([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${typeof value === 'number' ? value.toLocaleString('fa-IR') : escapeHtml(value)}</div></div>`).join('')}
      </div>
      <h2>وضعیت منابع</h2>
      <table>
        <thead><tr><th>منبع</th><th>وضعیت</th><th>پوشش</th></tr></thead>
        <tbody>${renderRows(overview.sourceHealth.map((row) => [biSourceLabels[row.source], biSourceStateLabels[row.state], row.coverage ? `${row.coverage.covered} از ${row.coverage.total}` : '—']))}</tbody>
      </table>
      <h2>پیشنهادهای فعال</h2>
      <table>
        <thead><tr><th>پیشنهاد</th><th>شاهد</th><th>تعداد</th></tr></thead>
        <tbody>${renderRows(overview.recommendations.map((row) => [row.title, row.evidence, row.count]))}</tbody>
      </table>
    </div>
  `;
};

const requireBiAccess = [
  protect,
  authorize('ADMIN', 'MANAGER'),
  requireWorkspaceAccess(WORKSPACES.BI, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.BI_DASHBOARD_VIEW, FEATURE_PERMISSIONS.VIEW),
];

const buildInteractiveBiReport = async (req: WorkspaceRequest) => buildBiSnapshot({
  user: req.user!,
  workspacePermission: req.workspacePermission as typeof WORKSPACE_PERMISSIONS[keyof typeof WORKSPACE_PERMISSIONS],
  query: req.query,
});

router.get('/sales/overview', requireBiAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const overview = await buildInteractiveBiReport(req);
    res.json({ success: true, data: { ...overview, contracts: [] } });
  } catch (error) {
    console.error('BI sales overview error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/sales/analysis/:view', requireBiAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const overview = await buildInteractiveBiReport(req);
    const sort = ['amount', 'createdAt', 'contractNumber'].includes(String(req.query.sort))
      ? req.query.sort as 'amount' | 'createdAt' | 'contractNumber'
      : 'createdAt';
    const result = buildBiAnalysisPage({
      rows: overview.contracts,
      view: req.params.view,
      search: String(req.query.search || ''),
      sort,
      direction: req.query.direction === 'asc' ? 'asc' : 'desc',
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || 25),
    });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('BI analysis error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/sales/export/:table', requireBiAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const overview = await buildInteractiveBiReport(req);
    const rowsByTable: Record<string, any[]> = {
      sellers: overview.sellers,
      products: overview.products,
      customers: overview.customers,
      contracts: overview.contracts,
      summary: [
        { شاخص: 'فروش قطعی خالص', مقدار: overview.cards.netRealized, وضعیت_منبع: 'کامل' },
        { شاخص: 'پایپ‌لاین فعال', مقدار: overview.cards.currentPipelineValue, وضعیت_منبع: 'کامل' },
        { شاخص: 'مانده وصول', مقدار: overview.sourceAvailability.accounting ? overview.finance.receivableAmount : '—', وضعیت_منبع: sourceStateLabel(overview, 'ACCOUNTING') },
        { شاخص: 'وعده تحویل', مقدار: overview.delivery.promisedDeliveries, وضعیت_منبع: 'کامل' },
        { شاخص: 'بارگیری نهایی', مقدار: overview.sourceAvailability.logistics ? overview.delivery.finalizedLoadings : '—', وضعیت_منبع: sourceStateLabel(overview, 'LOGISTICS') },
        { شاخص: 'خروج ثبت‌شده', مقدار: overview.sourceAvailability.security ? overview.delivery.exitedLoadings : '—', وضعیت_منبع: sourceStateLabel(overview, 'SECURITY') },
      ],
    };
    const table = req.params.table;
    const rows = rowsByTable[table] || rowsByTable.summary;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'BI');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="sabalan-bi-${table}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('BI sales export error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/sales/summary.pdf', requireBiAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const overview = await buildInteractiveBiReport(req);
    const filePath = await generatePdfFromHtml({
      htmlContent: renderBiReportHtml(overview),
      outputDir: path.join(process.cwd(), 'storage', 'bi-reports'),
      fileName: `bi-sales-${Date.now()}`,
      displayHeaderFooter: true,
      headerTemplate: renderReportPdfHeaderTemplate({
        title: 'هوش تجاری',
        reportRange: overview.period.label,
        scopeLabel: overview.scope.label,
        generatedAt: formatFaDateTime(new Date(overview.generatedAt)),
      }),
      margin: { top: '34mm', right: '5mm', bottom: '8mm', left: '5mm' },
    });
    res.download(filePath, `sabalan-bi-sales-${Date.now()}.pdf`);
  } catch (error) {
    console.error('BI sales PDF error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;
