import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CorrectionOpportunitySchema, canonicalHash, type TehranWorkingCalendar } from '@sabalanerp/partner-sales-contracts';
import { createRetailCorrectionOpportunity } from '../partnerSales/corrections/correctionOpportunity';

const predecessor = {
  caseId: 'case-328',
  revision: 7,
  integrityHash: `sha256-v1:${'a'.repeat(64)}`,
};

test('Sales scope approval opens one save for exactly three Tehran working days', async () => {
  const calls: Array<{ instant: string; days: number }> = [];
  const calendar: TehranWorkingCalendar = {
    version: 'tehran-working-calendar-1405',
    async addWorkingDays(instant, days) {
      calls.push({ instant, days });
      return '2026-09-06T08:00:00.000Z';
    },
  };
  const approvedAt = '2026-09-01T08:00:00.000Z';
  const scopeHash = await canonicalHash({
    purpose: 'PARTNER_RETAIL_CORRECTION_SCOPE', schemaVersion: 1,
    correctionId: 'correction-328', predecessor, partnerSellerId: 'partner-328',
    scope: 'RETAIL_ONLY', reason: 'اصلاح قیمت فروش',
    approvedAt, expiresAt: '2026-09-06T08:00:00.000Z',
    calendarVersion: calendar.version, workingDays: 3, successfulSavesAllowed: 1,
  });

  const result = await createRetailCorrectionOpportunity({
    opportunityId: 'opportunity-328', correctionId: 'correction-328', predecessor,
    partnerSellerId: 'partner-328', approvedAt, reason: 'اصلاح قیمت فروش',
  }, calendar);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(calls, [{ instant: approvedAt, days: 3 }]);
  assert.deepEqual(result.value, CorrectionOpportunitySchema.parse({
    schemaVersion: 1, opportunityId: 'opportunity-328', predecessor,
    scope: 'RETAIL_ONLY', partnerSellerId: 'partner-328', approvedAt,
    expiresAt: '2026-09-06T08:00:00.000Z', calendarVersion: calendar.version,
    workingDays: 3, successfulSavesAllowed: 1, scopeHash,
  }));
});

test('invalid calendar evidence fails closed instead of approximating three days', async () => {
  const result = await createRetailCorrectionOpportunity({
    opportunityId: 'opportunity-328', correctionId: 'correction-328', predecessor,
    partnerSellerId: 'partner-328', approvedAt: '2026-09-01T08:00:00.000Z',
    reason: 'اصلاح قیمت فروش',
  }, { version: '', addWorkingDays: async () => 'bad-date' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INTEGRITY_CONFLICT');
});
