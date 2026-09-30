import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOfficialReportExportRows, officialReportPeriodLabels, officialReportPdfPageSize } from '../accountingOfficialReportExport';

test('wide comparative exports retain all eighteen columns on a wider printable page', () => {
  const amounts = { openingDebit: '0', openingCredit: '0', turnoverDebit: '12500000', turnoverCredit: '0', endingDebit: '12500000', endingCredit: '0', periodNetDebit: '12500000', periodNetCredit: '0' };
  const rows = buildOfficialReportExportRows({ rows: [{ key: 'bank', titlePersian: 'بانک', amounts }], comparative: { rows: [{ key: 'bank', titlePersian: 'بانک', amounts }] } });
  const headers = Object.keys(rows[0]);
  assert.equal(headers.length, 18);
  assert.equal(rows[0]['خالص بدهکار دوره مقایسه‌ای'], '12500000');
  assert.equal(rows[0]['خالص بستانکار دوره مقایسه‌ای'], '0');
  assert.equal(officialReportPdfPageSize(headers.length).cssSize, 'A3 landscape');
  assert.equal(officialReportPdfPageSize(10).cssSize, 'A4 landscape');
});

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
    { 'کد حساب': '', 'عنوان': 'دارایی', 'مانده بدهکار پایان دوره': '120', 'مانده بستانکار پایان دوره': '0', 'مانده بدهکار پایان دوره مقایسه‌ای': '100', 'مانده بستانکار پایان دوره مقایسه‌ای': '0' },
    { 'کد حساب': '', 'عنوان': 'بدهی', 'مانده بدهکار پایان دوره': '', 'مانده بستانکار پایان دوره': '', 'مانده بدهکار پایان دوره مقایسه‌ای': '50', 'مانده بستانکار پایان دوره مقایسه‌ای': '0' },
  ]);
  const labels = officialReportPeriodLabels({
    parameters: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' },
    comparative: { from: '2025-09-01T00:00:00.000Z', to: '2025-09-30T23:59:59.999Z', rows: [] },
  });
  assert.match(labels.current, /تا/);
  assert.match(labels.comparative ?? '', /تا/);
  assert.notEqual(labels.current, labels.comparative);
});


test('exports retain account code and human detail without exposing internal bucket identities', () => {
  const [row] = buildOfficialReportExportRows({ columnKeys: ['endingDebit', 'endingCredit'], rows: [{ key: '111/طرف:opaque-id', accountCode: '111', titlePersian: 'دریافتنی · مشتری اول', amounts: { endingDebit: '12500000', endingCredit: '0' } }] });
  assert.equal(row['کد حساب'], '111');
  assert.equal(row['عنوان'], 'دریافتنی · مشتری اول');
  assert.equal(Object.keys(row).length, 4);
  assert.equal(JSON.stringify(row).includes('opaque-id'), false);
});
