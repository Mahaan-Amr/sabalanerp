import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from '../../backend/node_modules/express';
import accountingRoutes from '../../backend/src/routes/accounting';
import { dispatchDocumentApiPaths } from '../../frontend/src/features/accounting/dispatch-documents/dispatchDocumentsClient';

test('every production Accounting UI path reaches a mounted backend route protected by auth', async (context) => {
  const app = express();
  app.use(express.json());
  app.use('/api/accounting', accountingRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const paths = dispatchDocumentApiPaths(`${origin}/api/accounting`);
  const requests: Array<[string, RequestInit?]> = [
    [paths.candidates()],
    [paths.readModel('candidate-1')],
    [paths.decision('candidate-1'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    [paths.replace('waybill-1'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    [paths.artifact('waybill-1', 'artifact-1')],
    [paths.print('waybill-1'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
  ];

  for (const [url, init] of requests) {
    const response = await fetch(url, init);
    assert.equal(response.status, 401, `${new URL(url).pathname} must be mounted behind canonical Accounting auth`);
  }
});
