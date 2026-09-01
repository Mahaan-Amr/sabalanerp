import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

test('hiring SMS methods send the approved SMS.ir template IDs and exact case-sensitive parameters', async () => {
  const requests: Array<{ method?: string; url?: string; body?: any }> = [];
  let messageId = 9000;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      requests.push({ method: request.method, url: request.url, body });
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET') response.end(JSON.stringify({
        status: 1, data: { deliveryState: 1, deliveryDateTime: 1_777_000_000 },
      }));
      else response.end(JSON.stringify({ status: 1, data: { messageId: ++messageId } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fake SMS.ir receiver did not start');
    process.env.SMS_IR_API_KEY = 'test-api-key';
    process.env.SMS_IR_API_URL = `http://127.0.0.1:${address.port}`;
    process.env.SMS_IR_ENVIRONMENT = 'production';
    delete process.env.SMS_IR_HIRING_INVITATION_TEMPLATE_ID;
    process.env.SMS_IR_HIRING_CORRECTION_TEMPLATE_ID = '763918';
    process.env.SMS_IR_HIRING_OFFER_TEMPLATE_ID = '894291';
    const { default: sms } = await import('../smsService');
    const invitation = await sms.sendHiringInvitation({ phoneNumber: '09120000001', code: '123456' });
    const correction = await sms.sendHiringCorrection({ phoneNumber: '09120000001', details: 'اصلاح کد ملی', replacementCode: '123456' });
    const offer = await sms.sendHiringOfferReady({ phoneNumber: '09120000001', code: '123456' });
    const report = await sms.getDeliveryReport(Number(offer.messageId));
    assert.equal(invitation.success, true);
    assert.equal(correction.success, true);
    assert.equal(offer.success, true);
    assert.equal(report.deliveryState, 1);
    assert.deepEqual(requests.slice(0, 3).map(({ body }) => ({ templateId: body.templateId, parameters: body.parameters })), [
      { templateId: 343360, parameters: [{ name: 'CODE', value: '123456' }] },
      { templateId: 763918, parameters: [{ name: 'DETAILS', value: 'اصلاح کد ملی' }, { name: 'CODE', value: '123456' }] },
      { templateId: 894291, parameters: [{ name: 'CODE', value: '123456' }] },
    ]);
    assert.equal(requests[3].url, `/send/${offer.messageId}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
