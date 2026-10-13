import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import smsService from '../smsService';

// Test instances use the application's existing SMS class; no real request is
// allowed and no production environment or credentials are read by the gateway.
const Constructor = smsService.constructor as new () => typeof smsService;
const environment = {
  SMS_IR_API_KEY: 'qa-fake-key', SMS_IR_API_URL: 'https://api.sms.ir/v1',
  SMS_IR_ENVIRONMENT: 'production', SMS_IR_CONTRACT_CANCEL_TEMPLATE_ID: '774074',
};
function withEnvironment(run: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  return run().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test('cancellation uses the existing SMS.ir template transport and exact ContractNumber parameter', async t => withEnvironment(async () => {
  const requests: unknown[][] = [];
  t.mock.method(axios, 'post', async (...args: unknown[]) => {
    requests.push(args);
    return { data: { status: 1, message: 'accepted', data: { messageId: 404 } } };
  });
  const service = new Constructor();
  const result = await service.sendContractCancellationMessage({ phoneNumber: '09120000002', contractNumber: '1405-001234' });
  assert.equal(result.success, true);
  assert.equal(result.messageId, 404);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], 'https://api.sms.ir/v1/send/verify');
  assert.deepEqual(requests[0][1], { mobile: '09120000002', templateId: 774074,
    parameters: [{ name: 'ContractNumber', value: '1405-001234' }] });
}));

test('missing or invalid cancellation template cannot send through the confirmation template', async t => withEnvironment(async () => {
  const request = t.mock.method(axios, 'post', async () => { throw new Error('Unexpected external request'); });
  for (const templateId of ['', '0', '-1', 'not-a-number', '880001.5']) {
    process.env.SMS_IR_CONTRACT_CANCEL_TEMPLATE_ID = templateId;
    const result = await new Constructor().sendContractCancellationMessage({ phoneNumber: '09120000002', contractNumber: '404' });
    assert.equal(result.success, false);
    assert.match(result.error!, /قالب/);
  }
  assert.equal(request.mock.callCount(), 0);
}));
