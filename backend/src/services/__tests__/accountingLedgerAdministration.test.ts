import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAccountDefinition,
  validateFiscalPeriodCoverage,
} from '../accountingLedgerAdministration';

test('دوره‌های سفارشی باید سال مالی را بدون فاصله و هم‌پوشانی پوشش دهند', () => {
  const startsAt = new Date('2026-03-21T00:00:00.000Z');
  const endsAt = new Date('2027-03-20T23:59:59.999Z');
  assert.doesNotThrow(() => validateFiscalPeriodCoverage(startsAt, endsAt, [
    { startsAt, endsAt: new Date('2026-09-21T23:59:59.999Z'), isAdjustment: false },
    { startsAt: new Date('2026-09-22T00:00:00.000Z'), endsAt, isAdjustment: false },
    { startsAt: endsAt, endsAt, isAdjustment: true },
  ]));
  assert.throws(() => validateFiscalPeriodCoverage(startsAt, endsAt, [
    { startsAt, endsAt: new Date('2026-09-20T23:59:59.999Z'), isAdjustment: false },
    { startsAt: new Date('2026-09-22T00:00:00.000Z'), endsAt, isAdjustment: false },
  ]), /بدون فاصله/);
});

test('کد و سلسله‌مراتب حساب با نسخه کدینگ کنترل می‌شود', () => {
  const scheme = { groupLength: 1, kolLength: 2, moinLength: 3 };
  assert.doesNotThrow(() => validateAccountDefinition(scheme, { code: '110203', level: 'MOIN', parent: { code: '110', level: 'KOL' } }));
  assert.throws(() => validateAccountDefinition(scheme, { code: '1102', level: 'MOIN', parent: { code: '110', level: 'KOL' } }), /طول کد/);
  assert.throws(() => validateAccountDefinition(scheme, { code: '110203', level: 'MOIN', parent: { code: '1', level: 'GROUP' } }), /والد مستقیم/);
});
