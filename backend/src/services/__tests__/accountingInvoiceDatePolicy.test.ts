import assert from 'node:assert/strict';
import { validateSystemInvoiceDate } from '../accountingService';

const selectedMonday = validateSystemInvoiceDate('2026-09-28');
assert.equal(selectedMonday.toISOString(), '2026-09-28T00:00:00.000Z');
assert.equal(new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(selectedMonday), '1405/07/06', 'invoice day must remain 6 Mehr after server normalization');

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
