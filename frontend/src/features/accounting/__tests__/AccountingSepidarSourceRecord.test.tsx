import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AccountingSepidarSourceRecord, { sepidarTableTitle } from '../AccountingSepidarSourceRecord';

test('source archive presents Persian accounting fields without raw technical keys and preserves payload', () => {
  const record = { sourceKey: '123', payload: { Debit: '12500000.0000', Credit: '0', Date: '2026-03-21T00:00:00', DLRef: 12, IsMerged: false } };
  const before = JSON.stringify(record);
  const html = renderToStaticMarkup(<AccountingSepidarSourceRecord record={record} />);
  assert.match(html, /۱۲٬۵۰۰٬۰۰۰ ریال/);
  assert.match(html, /شناسهٔ تفصیلی/);
  assert.doesNotMatch(html, /Debit|DLRef|IsMerged/);
  assert.equal(JSON.stringify(record), before);
  assert.equal(sepidarTableTitle('ACC.Voucher', 0), 'اسناد حسابداری');
  assert.equal(sepidarTableTitle('UNKNOWN.Table', 3), 'جدول مرجع ۴');
});
