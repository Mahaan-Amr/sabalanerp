import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Report } from '../../services/partnerSales/reporting/contracts';
import { renderPartnerReportHtml } from '../partnerReportPdf';
const report: Report = { schemaVersion: 1, interfaceVersion: '1.0.0', snapshotId: 'snapshot', capturedAt: '2026-10-06T08:00:00Z', scope: { purpose: 'PARTNER', kind: 'OWN', from: '2026-04-21', to: '2026-10-06', effectiveThrough: '2026-10-06', search: '<script>alert(1)</script>', state: 'CANCELLED' }, count: 1, offset: 0, limit: 500, rows: [{ caseId: 'case', caseNumber: 'همکار-۴۷۹', customerContractNumber: '100343', revision: 8, state: 'CANCELLED', currency: 'IRT', collectionStatus: 'UNPAID', deliveries: [], deliveryProgress: null }], totals: [], series: [] };
test('PDF renders frozen range and cancellation, embeds Persian fonts, escapes source text', () => {
  const html = renderPartnerReportHtml(report);
  assert.match(html, /2026-04-21/); assert.match(html, /100343/);
  assert.match(html, /لغو شده/); assert.doesNotMatch(html, /وصول نشده/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /data:font\/woff2;base64/); assert.match(html, /dir="rtl"/);
});
test('empty report keeps date and an explicit empty state', () => {
  assert.match(renderPartnerReportHtml({ ...report, count: 0, rows: [] }), /پرونده‌ای در این محدوده وجود ندارد/);
});
