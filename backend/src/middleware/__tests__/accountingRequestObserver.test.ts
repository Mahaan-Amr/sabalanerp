import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAccountingRequestObserver, reportAccountingRequestFailure } from '../accountingRequestObserver';
import { measureAccountingReadPhase } from '../../services/accountingReadTiming';

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
      }
      response.end('PRIVATE document');
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://127.0.0.1:' + address.port;
    const list = await fetch(origin + '/api/accounting/contracts/?search=PRIVATE', {
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
    const [listRecord, decisionRecord] = records as Array<{ stagesMs?: Record<string, unknown> }>;
    assert.deepEqual(Object.keys(listRecord.stagesMs ?? {}), ['lockWait', 'authorization', 'population', 'rowHydration']);
    assert.ok(Object.values(listRecord.stagesMs ?? {}).every(ms => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0));
    assert.equal(decisionRecord.stagesMs, undefined);
    assert.deepEqual(records.map(r => {
      const record = r as Record<string, unknown>;
      assert.ok(Number.isFinite(record.durationMs));
      return [record.route, record.requestId, record.status, record.outcome];
    }), [
      ['/api/accounting/contracts', list.headers.get('x-accounting-request-id'), 200, 'success'],
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
