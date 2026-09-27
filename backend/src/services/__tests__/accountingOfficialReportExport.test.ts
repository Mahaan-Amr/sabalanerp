import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOfficialReportExportRows, officialReportPeriodLabels } from '../accountingOfficialReportExport';

test('one frozen dataset renders current and comparative values for both export formats', () => {
  const amount = (value: string) => ({ openingDebit: '0', openingCredit: '0', turnoverDebit: value, turnoverCredit: '0', endingDebit: value, endingCredit: '0', periodNetDebit: value, periodNetCredit: '0' });
  const rows = buildOfficialReportExportRows({
    parameters: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' },
    columnKeys: ['endingDebit', 'endingCredit'],
    rows: [{ key: 'asset', titlePersian: 'دارایی', amounts: amount('120') }],
    comparative: { from: '2025-09-01T00:00:00.000Z', to: '2025-09-30T23:59:59.999Z', rows: [
      { key: 'asset', titlePersian: 'دارایی', amounts: amount('100') },
      { key: 'liability', titlePersian: 'بدهی', amounts: amount('50') },
    ] },
  });
  assert.deepEqual(rows, [
    { 'عنوان': 'دارایی', 'مانده بدهکار پایان دوره': '120', 'مانده بستانکار پایان دوره': '0', 'مانده بدهکار پایان دوره مقایسه‌ای': '100', 'مانده بستانکار پایان دوره مقایسه‌ای': '0' },
    { 'عنوان': 'بدهی', 'مانده بدهکار پایان دوره': '', 'مانده بستانکار پایان دوره': '', 'مانده بدهکار پایان دوره مقایسه‌ای': '50', 'مانده بستانکار پایان دوره مقایسه‌ای': '0' },
  ]);
  const labels = officialReportPeriodLabels({
    parameters: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' },
    comparative: { from: '2025-09-01T00:00:00.000Z', to: '2025-09-30T23:59:59.999Z', rows: [] },
  });
  assert.match(labels.current, /تا/);
  assert.match(labels.comparative ?? '', /تا/);
  assert.notEqual(labels.current, labels.comparative);
});
