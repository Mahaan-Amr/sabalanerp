import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { renderContractHtml } from '../printTemplate';

test('contract print timestamps use Tehran time independently of the server timezone', (t) => {
  const previousTimezone = process.env.TZ;
  t.after(() => {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T10:12:30.000Z') });
  const contract = { id: 'print-time', contractNumber: '100568', status: 'SIGNED',
    contractData: { contractDate: '1405/07/06' }, createdAt: new Date('2026-09-28'),
    currency: 'IRR', totalAmount: 110000000, items: [], payments: [], deliveries: [] };
  const expected = new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
  const bodies: string[] = [];
  for (const timezone of ['UTC', 'Asia/Tehran', 'America/Los_Angeles']) {
    process.env.TZ = timezone;
    const html = renderContractHtml(contract, { variant: 'accounting' });
    assert(html.includes(`<strong>زمان چاپ:</strong> ${expected}`), timezone);
    assert(html.includes(`تاریخ چاپ: ${expected}`), timezone);
    bodies.push(createHash('sha256').update(html).digest('hex'));
  }
  assert.equal(bodies[0], bodies[1], 'the remaining PDF content must be preserved');
  assert.equal(bodies[1], bodies[2], 'server timezone must not affect the PDF');
});

test('a newly generated print uses the current Tehran day and time at midnight', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T20:29:59.000Z') });
  const contract = { id: 'print-midnight', contractNumber: '100568',
    printedAt: '2026-09-01T00:00:00.000Z', contractData: { contractDate: '1405/07/06' } };
  const before = renderContractHtml(contract, { variant: 'accounting' });
  assert(before.includes('۱۴۰۵/۷/۹, ۲۳:۵۹:۵۹'));
  t.mock.timers.tick(1000);
  const after = renderContractHtml(contract, { variant: 'accounting' });
  assert(after.includes('۱۴۰۵/۷/۱۰, ۰:۰۰:۰۰'));
});
