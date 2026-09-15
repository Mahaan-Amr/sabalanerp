import assert from 'node:assert/strict';
import test from 'node:test';
import { readPartnerCreationContext } from '../../contract-creation/partner/partnerCreationContext';

test('a transient creation-context conflict is retried once before blocking the wizard', async () => {
  let calls = 0;
  let waits = 0;
  const result = await readPartnerCreationContext(async () => {
    calls += 1;
    if (calls === 1) throw { response: { status: 409 } };
    return 'partner-context';
  }, async milliseconds => { assert.equal(milliseconds, 150); waits += 1; });
  assert.equal(result, 'partner-context');
  assert.equal(calls, 2);
  assert.equal(waits, 1);
});

test('a permission rejection is not retried', async () => {
  let calls = 0;
  await assert.rejects(() => readPartnerCreationContext(async () => {
    calls += 1;
    throw { response: { status: 403 } };
  }, async () => undefined));
  assert.equal(calls, 1);
});
