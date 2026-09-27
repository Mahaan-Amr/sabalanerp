import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseBankStatementFile } from '../accountingBankFileImport';

test('bank file preserves exact CSV source rows and a stable package hash', () => {
  const fileBase64 = Buffer.from('reference,date,amount,direction,description\nR-1,2026-09-25T08:00:00Z,1200,credit,واریز مشتری\n').toString('base64');
  const parsed = parseBankStatementFile({ adapterType: 'CSV', fileBase64 });
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], { rowNumber: 2, rawRecord: { reference: 'R-1', date: '2026-09-25T08:00:00Z',
    amount: '1200', direction: 'credit', description: 'واریز مشتری' } });
  assert.equal(parsed.fileHash, parseBankStatementFile({ adapterType: 'CSV', fileBase64 }).fileHash);
});

test('bank file rejects ambiguous headers and spreadsheet formulas before import', () => {
  const duplicate = Buffer.from('reference,reference\nR-1,R-2\n').toString('base64');
  assert.throws(() => parseBankStatementFile({ adapterType: 'CSV', fileBase64: duplicate }), /ستون‌ها/);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['reference', 'amount'], ['R-1', 1200]]);
  sheet.B2.f = '1+1199';
  XLSX.utils.book_append_sheet(workbook, sheet, 'بانک');
  const fileBase64 = (XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  assert.throws(() => parseBankStatementFile({ adapterType: 'XLSX', fileBase64 }), /فرمول/);
});

test('bank file reads one XLSX sheet using the same versioned column names', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['reference', 'date', 'amount', 'direction', 'description'],
    ['X-1', '2026-09-25T08:00:00Z', 1200, 'credit', 'واریز مشتری'],
  ]), 'بانک');
  const fileBase64 = (XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  assert.deepEqual(parseBankStatementFile({ adapterType: 'XLSX', fileBase64 }).rows[0].rawRecord, {
    reference: 'X-1', date: '2026-09-25T08:00:00Z', amount: '1200', direction: 'credit', description: 'واریز مشتری',
  });
});

test('bank file refuses excess rows instead of silently truncating a statement', () => {
  const lines = ['reference,amount', ...Array.from({ length: 1001 }, (_, index) => `R-${index},1200`)];
  assert.throws(() => parseBankStatementFile({ adapterType: 'CSV', fileBase64: Buffer.from(lines.join('\n')).toString('base64') }), /شمار ردیف/);
});
