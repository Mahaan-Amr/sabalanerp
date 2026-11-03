import assert from 'node:assert/strict';
import { validateSystemInvoiceDate } from '../accountingService';

assert.equal(
  validateSystemInvoiceDate('1390-01-01').toISOString(),
  '1390-01-01T00:00:00.000Z',
  'an otherwise valid historical invoice date must not expire',
);

assert.throws(
  () => validateSystemInvoiceDate('not-a-date'),
  /required/i,
  'removing the age restriction must not remove date-shape validation',
);

console.log('Accounting invoice date policy tests passed.');
