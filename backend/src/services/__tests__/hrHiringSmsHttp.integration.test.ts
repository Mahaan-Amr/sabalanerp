import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import test from 'node:test';

test('SMS uses system DNS first, falls back before sending, and does not replay a lost response', async t => {
  const hostname = 'sms-provider.invalid';
  let systemFails = false;
  let fallbackFails = false;
  let loseResponse = false;
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests += 1;
    if (loseResponse) {
      request.socket.destroy();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ status: 1, data: { messageId: 9001 } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const environment = {
      SMS_IR_API_KEY: 'test-api-key',
      SMS_IR_API_URL: `http://${hostname}:${address.port}`,
      SMS_IR_ENVIRONMENT: 'production',
      SMS_IR_DNS_SERVERS: '127.0.0.1',
      NO_PROXY: hostname,
      no_proxy: hostname,
    };
    const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
    Object.assign(process.env, environment);
    const system = t.mock.method(dns, 'lookup', (host, options, callback) => {
      assert.equal(host, hostname);
      if (systemFails) callback(Object.assign(new Error('lookup failed'), { code: 'EAI_AGAIN' }));
      else if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
      else callback(null, '127.0.0.1', 4);
    });
    const ipv4Fallback = t.mock.method(dns.Resolver.prototype, 'resolve4', (host, callback) => {
      assert.equal(host, hostname);
      if (fallbackFails) callback(Object.assign(new Error('fallback failed'), { code: 'ESERVFAIL' }));
      else callback(null, ['127.0.0.1']);
    });
    const ipv6Fallback = t.mock.method(dns.Resolver.prototype, 'resolve6', (host, callback) => {
      assert.equal(host, hostname);
      callback(Object.assign(new Error('fallback failed'), { code: 'ESERVFAIL' }));
    });
    try {
      const { default: sms } = await import('../smsService');
      const Constructor = sms.constructor as new () => typeof sms;
      const service = new Constructor();
      const send = () => service.sendVerificationCode('09120000001', '123456');

      assert.equal((await send()).success, true);
      assert.equal(system.mock.callCount(), 1);
      assert.equal(ipv4Fallback.mock.callCount(), 0);

      systemFails = true;
      assert.equal((await send()).success, true);
      assert.equal(ipv4Fallback.mock.callCount(), 1);
      assert.equal(requests, 2);

      fallbackFails = true;
      const dnsError = await send();
      assert.equal(dnsError.success, false);
      assert.equal(dnsError.errorCode, 'ESERVFAIL');
      assert.equal(ipv6Fallback.mock.callCount(), 1);
      assert.equal(requests, 2);

      systemFails = false;
      loseResponse = true;
      assert.equal((await send()).success, false);
      assert.equal(ipv4Fallback.mock.callCount(), 2);
      assert.equal(requests, 3);
    } finally {
      system.mock.restore();
      ipv4Fallback.mock.restore();
      ipv6Fallback.mock.restore();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

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
    // Production retains the previous image's configuration for safe rollback.
    process.env.SMS_IR_HIRING_INVITATION_TEMPLATE_ID = '343360';
    process.env.SMS_IR_HIRING_CORRECTION_TEMPLATE_ID = '763918';
    process.env.SMS_IR_HIRING_OFFER_TEMPLATE_ID = '894291';
    const { default: singleton } = await import('../smsService');
    const Constructor = singleton.constructor as new () => typeof singleton;
    const sms = new Constructor();
    const invitation = await sms.sendHiringInvitation({ phoneNumber: '09120000001', code: '123456' });
    const correction = await sms.sendHiringCorrection({ phoneNumber: '09120000001', details: 'اصلاح کد ملی', replacementCode: '123456' });
    const offer = await sms.sendHiringOfferReady({ phoneNumber: '09120000001', code: '123456' });
    const report = await sms.getDeliveryReport(Number(offer.messageId));
    assert.equal(invitation.success, true);
    assert.equal(correction.success, true);
    assert.equal(offer.success, true);
    assert.equal(report.deliveryState, 1);
    assert.deepEqual(requests.slice(0, 3).map(({ body }) => ({ templateId: body.templateId, parameters: body.parameters })), [
      { templateId: 343660, parameters: [{ name: 'CODE', value: '123456' }] },
      { templateId: 763918, parameters: [{ name: 'DETAILS', value: 'اصلاح کد ملی' }, { name: 'CODE', value: '123456' }] },
      { templateId: 894291, parameters: [{ name: 'CODE', value: '123456' }] },
    ]);
    assert.equal(requests[3].url, `/send/${offer.messageId}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
