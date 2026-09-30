import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash, normalizePartnerInput, partnerInputHash } from '../src';

test('Partner text, identifiers and decimal input use the same English digits before hashing', async () => {
  const persian = { amount: '۱۲۳٫۴۵', count: '۵', phone: '٠٩١٢٣',
    reason: 'عرض ۳۰، طبقه ۲', nested: [{ date: '۲۰۲۶-۰۹-۲۸' }] };
  const english = { amount: '123.45', count: '5', phone: '09123',
    reason: 'عرض 30, طبقه 2', nested: [{ date: '2026-09-28' }] };
  assert.deepEqual(normalizePartnerInput(persian), english);
  assert.deepEqual(normalizePartnerInput(english), english);
  assert.equal(await partnerInputHash(persian), await canonicalHash(english));
  assert.notEqual(await canonicalHash(persian), await canonicalHash(english), 'persisted integrity semantics stay unchanged');
  assert.equal(persian.amount, '۱۲۳٫۴۵', 'input is not mutated');
});

test('cleared optional object fields hash exactly as JSON transport without weakening persisted integrity', async () => {
  const input = { discountPercent: undefined, plan: { nationalCode: undefined, amount: '500' }, items: [{ note: undefined }] };
  const transport = JSON.parse(JSON.stringify(input));
  assert.deepEqual(normalizePartnerInput(input), transport);
  assert.equal(await partnerInputHash(input), await canonicalHash(transport));
  await assert.rejects(canonicalHash(input), /Expected canonical JSON/);
  await assert.rejects(partnerInputHash([undefined]), /Expected canonical JSON/);
});
