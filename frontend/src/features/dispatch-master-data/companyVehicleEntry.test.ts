import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { plateDigits, emptyCompanyPlate, completeCompanyPlate, formatCompanyPlate, requireCompanyPlate, requireManufactureYear, manufactureYears, currentManufactureYear } from './companyVehicleEntry';

test('Iranian plate entry accepts all digit keyboards, preserves leading zeroes, and rejects incomplete or invalid plates', () => {
  assert.equal(plateDigits('۰١a۲-۳', 3), '012');
  const parts = { first: '01', letter: 'ب', serial: '023', region: '04' };
  assert.equal(completeCompanyPlate(parts), true);
  assert.equal(formatCompanyPlate(parts), '01 ب 023 ایران 04');
  assert.equal(requireCompanyPlate('۰۱ ب ٠٢٣ ایران ۰۴'), formatCompanyPlate(parts));
  for (const plate of ['', '1 ب 123 12', '12 ب 12 12', '12 ب 123 1', '12 ر 123 12', 'IR-22 AA 010']) assert.throws(() => requireCompanyPlate(plate));
  assert.equal(completeCompanyPlate(emptyCompanyPlate), false);
  assert.equal(completeCompanyPlate({ ...parts, first: '1' }), false);
  assert.equal(completeCompanyPlate({ ...parts, letter: 'ر' }), false);
});

test('manufacturing years follow Nowruz in Tehran and reject missing, fractional and future years', () => {
  const before = new Date('2026-03-20T20:29:00Z');
  const after = new Date('2026-03-20T20:31:00Z');
  assert.equal(currentManufactureYear(before), 1404);
  assert.equal(currentManufactureYear(after), 1405);
  assert.equal(manufactureYears(before)[0], 1404);
  assert.equal(manufactureYears(after)[0], 1405);
  assert.equal(manufactureYears(after).at(-1), 1300);
  assert.equal(requireManufactureYear('۱۴۰۵', after), 1405);
  for (const year of ['', null, '1405.1', '1406', '1299']) assert.throws(() => requireManufactureYear(year, after));
});

test('browser and server entry policies agree', () => {
  assert.equal(readFileSync(new URL('./companyVehicleEntry.ts', import.meta.url), 'utf8'), readFileSync(new URL('../../../../backend/src/services/companyVehicleEntry.ts', import.meta.url), 'utf8'));
});
