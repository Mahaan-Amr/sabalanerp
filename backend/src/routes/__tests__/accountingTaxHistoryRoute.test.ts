import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import router from '../accountingLedger';

test('tax overview and invoice history both require an authenticated Accounting session', async (context) => {
  const app = express();
  app.use('/api/accounting/ledger', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/ledger/tax`;
  for (const path of ['/overview', '/invoices/sample/attempts']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.equal((await response.json() as { data?: unknown }).data, undefined);
  }
});
