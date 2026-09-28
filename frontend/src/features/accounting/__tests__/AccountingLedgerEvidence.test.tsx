import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AccountingLedgerEvidence from '../AccountingLedgerEvidence';
import AccountingIdentityList, { filterAccountingIdentities } from '../AccountingIdentityList';

test('evidence presents accounting facts in Persian without raw source JSON or codes', () => {
  const source = { voucher: { Number: 39, Date: '2026-03-21T00:00:00Z', IsMerged: false }, authority: 'SEPIDAR_UNTIL_CUTOVER' };
  const before = JSON.stringify(source);
  const html = renderToStaticMarkup(<AccountingLedgerEvidence evidence={{ statutoryNumber: 1,
    sourceType: 'SEPIDAR_ACC_VOUCHER', sourcePayload: source, sourceVersion: 3, sourceHash: 'technical-hash',
    lines: [{ id: 'line', sequence: 1, evidenceType: 'SEPIDAR_ACC_VOUCHER_ITEM', evidenceVersion: 3,
      account: { code: '111001', titlePersian: 'صندوق' }, debitRials: '121320000', creditRials: '0',
      evidencePayload: { row: { DLRef: 1099, Debit: '121320000.0000' } } }] }} />);
  assert.match(html, /سند حسابداری سپیدار/);
  assert.match(html, /صندوق/);
  assert.match(html, /۱۲۱٬۳۲۰٬۰۰۰ ریال/);
  assert.doesNotMatch(html, /SEPIDAR_|IsMerged|DLRef|technical-hash|<pre/);
  assert.equal(JSON.stringify(source), before);
});

test('identity search normalizes Persian text and limits a long initial list to twenty rows', () => {
  const parties = Array.from({ length: 45 }, (_, index) => ({ id: String(index), displayName: `طرف ${index}`, roles: [{ role: 'CUSTOMER' }] }));
  assert.equal(filterAccountingIdentities([{ displayName: 'علي كاظمي', roles: [{ role: 'SUPPLIER' }] }], 'party', 'علی کاظمی', 'SUPPLIER').length, 1);
  assert.equal(filterAccountingIdentities(parties, 'party', '', 'SUPPLIER').length, 0);
  const html = renderToStaticMarkup(<AccountingIdentityList items={parties} kind="party" />);
  assert.match(html, /جست‌وجوی طرف حساب/);
  assert.match(html, /طرف 19/);
  assert.doesNotMatch(html, /طرف 20/);
  assert.match(html, /بعدی/);
});
