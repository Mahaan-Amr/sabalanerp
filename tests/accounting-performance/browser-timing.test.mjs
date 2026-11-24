import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/measure-accounting-browser.mjs', import.meta.url));
const commit = 'a'.repeat(40);
const reviewableId = 'b'.repeat(32);
const decoyId = 'c'.repeat(32);

test('browser receipts attribute complete responses and aborted transfers independently of action readiness', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'accounting-browser-timing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const navigations = [];
  let dashboardRequests = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/accounting/dashboard') {
      dashboardRequests++;
      res.writeHead(dashboardRequests === 1 ? 503 : 200, {
        'content-type': 'application/json', 'x-accounting-request-id': decoyId, 'x-accounting-commit': commit,
      });
      res.write('[');
      if (dashboardRequests === 1) res.end(']');
      return;
    }
    if (url.pathname === '/api/accounting/contracts') {
      const correct = req.method === 'GET' && url.searchParams.getAll('view').join(',') === 'reviewable';
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-accounting-request-id': correct ? reviewableId : decoyId,
        'x-accounting-commit': commit,
      });
      res.write('[');
      if (correct) setTimeout(() => res.end(']'), 900);
      else res.end(']');
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/login') {
      res.end('<label>ایمیل، نام کاربری یا شماره تماس<input></label><input name="password"><button onclick="location.href=\'/dashboard\'">ورود</button>');
    } else if (url.pathname === '/dashboard/accounting') {
      res.end(`<button>به‌روزرسانی</button><script>
        const controller = new AbortController();
        fetch('/api/accounting/dashboard', {signal: controller.signal}).then(response => {
          if (response.ok) setTimeout(() => controller.abort(), 250);
          return response.text();
        }).catch(() => {});
      </script>`);
    } else if (url.pathname === '/dashboard/accounting/contracts') {
      navigations.push(url.search);
      res.end(`<table><tr><td><a href="#">مشاهده</a></td></tr></table><script>
        (async () => {
          const path = '/api/accounting/contracts';
          await fetch(path);
          await fetch(path + '?view=reviewable&view=other');
          await fetch(path + '?view=reviewable', {method: 'POST'});
          await fetch(path + '?view=reviewable&private=synthetic-secret').then(r => r.text());
        })();
      </script>`);
    } else res.end('');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });

  const output = path.join(directory, 'receipt.json');
  const child = spawn(process.execPath, [script], { stdio: 'inherit', env: {
    ...process.env, ACCOUNTING_TIMING_RUN: 'candidate', ACCOUNTING_TIMING_WORKLOAD: 'http-fixture',
    ACCOUNTING_TIMING_SURFACES: 'dashboard,reviewable-list', ACCOUNTING_TIMING_SAMPLES: '2', ACCOUNTING_TIMING_CONCURRENCY: '1',
    ACCOUNTING_TIMING_IDENTIFIER: 'fixture', ACCOUNTING_TIMING_PASSWORD: 'fixture', ACCOUNTING_TIMING_COMMIT: commit,
    ACCOUNTING_TIMING_ORIGIN: `http://127.0.0.1:${server.address().port}`, ACCOUNTING_TIMING_OUTPUT: output,
    ACCOUNTING_TIMING_SEPIDAR_FIXTURE: '',
  } });
  const [code] = await once(child, 'exit');
  assert.equal(code, 2, 'HTTP error and aborted transfer make the run fail');
  const raw = await readFile(output, 'utf8');
  const { results, metrics } = JSON.parse(raw);
  const [unavailable, aborted] = results.filter(sample => sample.surface === 'dashboard');
  assert.equal(unavailable.api.path, '/api/accounting/dashboard');
  assert.equal(unavailable.api.view, null);
  assert.equal(unavailable.failure, 'API_FAILED');
  assert.equal(unavailable.browser.errors.unavailable, 1);
  assert.equal(unavailable.api.status, 503);
  assert.ok(Number.isFinite(unavailable.api.fullHttpMs));
  assert.equal(aborted.failure, 'INCOMPLETE_TRANSFER');
  assert.equal(aborted.api.transferFailure, 'client_abort');
  assert.equal(aborted.api.fullHttpMs, undefined);
  assert.deepEqual(metrics.dashboard.fullHttpMs, { count: 1, p95: unavailable.api.fullHttpMs });
  const reviewable = results.filter(sample => sample.surface === 'reviewable-list');
  const [sample] = reviewable;
  assert.deepEqual(navigations, ['?view=reviewable', '?view=reviewable']);
  assert.equal(sample.api.requestId, reviewableId);
  assert.equal(sample.api.path, '/api/accounting/contracts');
  assert.equal(sample.api.view, 'reviewable');
  assert.doesNotMatch(raw, /synthetic-secret/);
  assert.ok(sample.api.fullHttpMs >= 850, 'includes delayed final body bytes');
  assert.ok(sample.firstActionMs < sample.api.fullHttpMs, 'ready action is measured before transfer completion');
  assert.deepEqual(metrics['reviewable-list'].fullHttpMs, { count: 2, p95: Math.max(...reviewable.map(row => row.api.fullHttpMs)) });
});
