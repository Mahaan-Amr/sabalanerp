import test from 'node:test';
import assert from 'node:assert/strict';
import { partnerCommercialStatus } from '@sabalanerp/partner-sales-contracts';
import { partnerCommercialEditStatus } from '../partnerSales/cases/commercialEditStatus';

test('every editing terminal state agrees with full commercial presentation for all approval, pricing, expiry and cancellation combinations', () => {
  for (let bits = 0; bits < 256; bits++) {
    const flags = { salesApproved: Boolean(bits & 1), customerAccepted: Boolean(bits & 2),
      pricingAccepted: Boolean(bits & 4), pricingReceived: Boolean(bits & 8), inquiryWaiting: Boolean(bits & 16),
      edited: Boolean(bits & 32), expired: Boolean(bits & 64), cancelled: Boolean(bits & 128) };
    const full = partnerCommercialStatus(flags);
    assert.equal(partnerCommercialEditStatus(flags), ['FINAL', 'EXPIRED', 'CANCELLED'].includes(full) ? full : 'OTHER');
  }
});
