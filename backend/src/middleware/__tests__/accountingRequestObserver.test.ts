import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { createAccountingRequestObserver, reportAccountingRequestFailure } from '../accountingRequestObserver';
import { countAccountingReadRows, measureAccountingReadPhase } from '../../services/accountingReadTiming';
import { asyncRoute } from '../asyncRoute';

test('Accounting responses and operational records share a server-issued correlation without leaking inputs', async () => {
  const records: unknown[] = [];
  const middleware = createAccountingRequestObserver('7'.repeat(40), record => records.push(record));
  const server = createServer((request, response) => {
    middleware(request, response, async () => {
      if (request.url?.includes('/decision')) {
        reportAccountingRequestFailure(response, { code: 'P2034', message: 'PRIVATE document and person' });
        response.statusCode = 500;
      } else {
        for (const phase of ['lockWait', 'authorization', 'population', 'rowHydration'] as const) {
          await measureAccountingReadPhase(phase, async () => {});
        }
        countAccountingReadRows('receiptCandidates', 5);
        countAccountingReadRows('receiptPageRows', 2);
      }
      response.end('PRIVATE document');
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://127.0.0.1:' + address.port;
    const list = await fetch(origin + '/api/accounting/payments/?search=PRIVATE', {
      headers: { 'X-Accounting-Request-Id': 'PRIVATE', 'X-Correlation-Id': 'PRIVATE', referer: 'https://private.invalid/PRIVATE' },
    });
    await list.text();
    const decision = await fetch(origin + '/api/accounting/dispatch-candidates/PRIVATE/decision', {
      method: 'POST', body: 'PRIVATE',
    });
    await decision.text();
    assert.equal(list.status, 200);
    assert.match(list.headers.get('x-accounting-request-id')!, /^[0-9a-f-]{36}$/);
    assert.equal(list.headers.get('x-accounting-commit'), '7'.repeat(40));
    assert.equal(decision.headers.get('x-accounting-outcome'), 'contention');
    assert.equal(records.length, 2);
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE|private\.invalid/);
    const [listRecord, decisionRecord] = records as Array<{ stagesMs?: Record<string, unknown>; readWork?: Record<string, number> }>;
    assert.deepEqual(Object.keys(listRecord.stagesMs ?? {}), ['lockWait', 'authorization', 'population', 'rowHydration']);
    assert.ok(Object.values(listRecord.stagesMs ?? {}).every(ms => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0));
    assert.equal(decisionRecord.stagesMs, undefined);
    assert.deepEqual(listRecord.readWork, { receiptCandidates: 5, receiptPageRows: 2 });
    assert.equal(decisionRecord.readWork, undefined);
    assert.deepEqual(records.map(r => {
      const record = r as Record<string, unknown>;
      assert.ok(Number.isFinite(record.durationMs));
      return [record.route, record.requestId, record.status, record.outcome];
    }), [
      ['/api/accounting/payments', list.headers.get('x-accounting-request-id'), 200, 'success'],
      ['/api/accounting/dispatch-candidates/:id/decision', decision.headers.get('x-accounting-request-id'), 500, 'contention'],
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('an interrupted request and server outcomes each record one classified attempt', async () => {
  const records: Array<{ status: number | null; outcome: string }> = [];
  const middleware = createAccountingRequestObserver(undefined, record => records.push(record));
  const routes = new Map([['/drain', 503], ['/fault', 500], ['/conflict', 409], ['/abort', 200]]);
  let abortedRequest: Promise<void>;
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      const action = request.url!.slice(request.url!.lastIndexOf('/'));
      response.statusCode = routes.get(action)!;
      if (action === '/abort') {
        abortedRequest = once(response, 'close').then(() => {});
        response.write('partial');
      } else {
        response.end();
      }
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://127.0.0.1:' + address.port + '/api/accounting';
    for (const action of ['/drain', '/fault', '/conflict']) {
      const response = await fetch(origin + action);
      await response.text();
      assert.equal(response.headers.get('x-accounting-commit'), 'unattested');
    }
    await new Promise<void>((resolve, reject) => {
      const request = get(origin + '/abort', response => {
        response.destroy();
        resolve();
      });
      request.once('error', reject);
    });
    await abortedRequest!;
    assert.deepEqual(records.map(({ status, outcome }) => [status, outcome]), [
      [503, 'unavailable'], [500, 'internal_error'], [409, 'rejected'], [null, 'client_abort'],
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('dashboard reads and the exact reviewable view receive distinct fixed route labels', async () => {
  const records: Array<{ route: string; requestId: string }> = [];
  const middleware = createAccountingRequestObserver('local', record => records.push(record));
  const server = createServer((request, response) => {
    middleware(request, response, () => response.end());
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const requests = [
      ['/api/accounting/dashboard?search=PRIVATE', '/api/accounting/dashboard'],
      ['/api/accounting/dashboard/workspace?search=PRIVATE', '/api/accounting/dashboard/workspace'],
      ['/api/accounting/dashboard/change?search=PRIVATE', '/api/accounting/dashboard/change'],
      ['/api/accounting/contracts/?pageSize=50&view=reviewable&search=PRIVATE', '/api/accounting/contracts?view=reviewable'],
      ['/api/accounting/contracts?view=reviewable&view=PRIVATE', '/api/accounting/contracts'],
      ['/api/accounting/contracts?view=reviewable&view%5B0%5D=PRIVATE', '/api/accounting/contracts'],
      ['/api/accounting/contracts?view=PRIVATE', '/api/accounting/contracts'],
    ];
    for (const [path, route] of requests) {
      const response = await fetch(origin + path);
      await response.text();
      assert.deepEqual([records.at(-1)?.route, records.at(-1)?.requestId], [route, response.headers.get('x-accounting-request-id')]);
    }
    assert.equal(records.length, requests.length);
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Accounting-related read records retain fixed labels and database failure codes', async () => {
  const records: Array<{ route: string; requestId: string; outcome: string; code?: string }> = [];
  const middleware = createAccountingRequestObserver('local', record => records.push(record));
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      const expires = request.url?.includes('/unread-count') || request.url?.includes('/sabalan-plan-candidates');
      const code = expires ? 'P2028' : /\/(summary|route-availability)/.test(request.url ?? '') ? 'P2024' : undefined;
      if (code) {
        reportAccountingRequestFailure(response, { code, message: 'PRIVATE' });
        response.statusCode = 500;
      }
      response.end();
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const reads = [
      ['/api/duties/workspaces/accounting/duties?search=PRIVATE', '/api/duties/workspaces/accounting/duties', 'success', undefined],
      ['/api/hr-duties/workspaces/accounting/duties?view=history&search=PRIVATE', '/api/duties/workspaces/accounting/duties?view=history', 'success', undefined],
      ['/api/duties/workspaces/accounting/summary?search=PRIVATE', '/api/duties/workspaces/accounting/summary', 'pool_timeout', 'P2024'],
      ['/api/notifications/?cursor=PRIVATE', '/api/notifications', 'success', undefined],
      ['/api/notifications/metadata?workspace=PRIVATE', '/api/notifications/metadata', 'success', undefined],
      ['/api/notifications/unread-count?workspace=PRIVATE', '/api/notifications/unread-count', 'transaction_expired', 'P2028'],
      ['/api/partner/accounting/sabalan-plan-candidates?search=PRIVATE', '/api/partner/accounting/sabalan-plan-candidates', 'transaction_expired', 'P2028'],
      ['/api/dashboard/route-availability?path=%2Fdashboard%2Faccounting%2Fcontracts%2FPRIVATE',
        '/api/dashboard/route-availability?scope=accounting', 'pool_timeout', 'P2024'],
    ];
    for (const [path, route, outcome, code] of reads) {
      const response = await fetch(origin + path);
      await response.text();
      const record = records.at(-1);
      assert.match(response.headers.get('x-accounting-request-id') ?? '', /^[0-9a-f-]{36}$/);
      assert.deepEqual([record?.route, record?.requestId, record?.outcome, record?.code],
        [route, response.headers.get('x-accounting-request-id'), outcome, code]);
    }
    for (const path of [
      '/api/duties/workspaces/sales/duties?search=PRIVATE',
      '/api/dashboard/route-availability?path=/dashboard/sales',
      '/api/dashboard/route-availability?path=/dashboard/accounting-private',
      '/api/dashboard/route-availability?path=/dashboard/accounting&path=/dashboard/sales',
      '/api/dashboard/route-availability?path=/dashboard/accounting&path%5B0%5D=PRIVATE',
    ]) {
      const response = await fetch(origin + path);
      await response.text();
      assert.equal(response.headers.get('x-accounting-request-id'), null);
    }
    for (const path of [
      '/api/notifications/unread-count',
      '/api/duties/workspaces/accounting/summary',
      '/api/partner/accounting/sabalan-plan-candidates',
      '/api/partner/accounting/sabalan-payment-plan',
    ]) {
      const response = await fetch(origin + path, { method: 'POST' });
      await response.text();
      assert.equal(response.headers.get('x-accounting-request-id'), null);
      assert.equal(response.headers.get('x-accounting-outcome'), null);
    }
    assert.equal(records.length, reads.length);
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('an observed notification failure retains its Prisma code through the actual async route boundary', async () => {
  const records: Array<{ outcome: string; code?: string }> = [];
  const app = express();
  app.use(createAccountingRequestObserver('local', record => records.push(record)));
  app.get('/api/notifications/unread-count', asyncRoute(async () => {
    throw Object.assign(new Error('PRIVATE'), { code: 'P2028' });
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/notifications/unread-count`);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('x-accounting-outcome'), 'transaction_expired');
    assert.doesNotMatch(await response.text(), /PRIVATE/);
    assert.equal(records[0]?.code, 'P2028');
    assert.equal(records[0]?.outcome, 'transaction_expired');
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
