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
  let reviewableRequests = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/accounting/dashboard') {
      dashboardRequests++;
      res.writeHead(dashboardRequests === 1 ? 503 : 200, {
        'content-type': 'application/json', 'x-accounting-request-id': decoyId, 'x-accounting-commit': commit,
      });
      if (dashboardRequests >= 3) {
        res.end(JSON.stringify({ success: true, data: {
          workspace: { queues: { contracts: [] }, deadlines: { items: [] }, commandCenter: { reviewableContracts: { count: 0 } } },
          trend: { range: '6m', points: [{ invoicedRial: 100, receivedRial: 0, outstandingRial: 100 }] },
          ...(dashboardRequests === 4 ? { trendError: 'fixture-trend-error' } : {}),
        } }));
        return;
      }
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
      res.write('{"success":true,"data":');
      if (correct) {
        const total = ++reviewableRequests >= 3 ? 51 : 0;
        const items = Array.from({ length: Math.min(total, 50) }, (_, index) => ({ id: `fixture-${index}` }));
        setTimeout(() => res.end(JSON.stringify({ items, page: 1, pageSize: 50, total }) + '}'), 900);
      }
      else res.end('null}');
      return;
    }
    if (url.pathname.startsWith('/api/duties/workspaces/accounting/')) {
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-accounting-request-id', reviewableId);
      res.setHeader('x-accounting-commit', commit);
      if (url.pathname.endsWith('/summary')) {
        setTimeout(() => res.end('{"success":true,"data":{"open":0,"available":1,"dueSoon":0,"overdue":0,"triage":0,"canManageTriage":false,"availableUnseen":0,"historyUnseen":0}}'), 450);
      } else {
        res.end(JSON.stringify({ success: true, data: url.searchParams.get('view') === 'assigned' ? [] : [{ id: 'wrong-view' }] }));
      }
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/login') {
      res.end('<label>ایمیل، نام کاربری یا شماره تماس<input></label><input name="password"><button onclick="location.href=\'/dashboard\'">ورود</button>');
    } else if (url.pathname === '/dashboard/accounting') {
      res.end(`<button>به‌روزرسانی</button><h2>کارهای امروز</h2>
        <p>در خلاصهٔ فعلی اقدام فوری برای قراردادها پیدا نشد.</p>
        <a href="#">مشاهده همه قراردادها</a>
        <h2>سررسیدها</h2><section aria-label="شاخص‌های عملیاتی حسابداری">قراردادهای قابل بررسی</section>
        <section aria-label="روند مالی قراردادها"><div aria-busy="true"></div></section><script>
        const controller = new AbortController();
        fetch('/api/accounting/dashboard?range=6m', {signal: controller.signal}).then(response => {
          const abort = setTimeout(() => controller.abort(), 250);
          return response.json().finally(() => clearTimeout(abort));
        }).then(body => {
          if (!body?.data?.trend || body.data.trendError) return;
          setTimeout(() => {
            document.querySelector('[aria-busy=true]').outerHTML = '<div aria-busy="false"><svg class="recharts-surface" width="100" height="100"><path class="recharts-area-curve" d="M0,0L100,100"></path></svg></div>';
          }, 600);
        }).catch(() => {});
      </script>`);
    } else if (url.pathname === '/dashboard/accounting/contracts') {
      navigations.push(url.search);
      res.end(`<main><input type="search"><script>
        (async () => {
          const path = '/api/accounting/contracts';
          await fetch(path);
          await fetch(path + '?view=reviewable&view=other');
          await fetch(path + '?view=reviewable', {method: 'POST'});
          const { data } = await fetch(path + '?view=reviewable&page=1&pageSize=50&private=synthetic-secret').then(r => r.json());
          document.querySelector('main').insertAdjacentHTML('beforeend', data.items.length
            ? '<table>' + data.items.map(() => '<tr><td><a href="#">مشاهده</a></td></tr>').join('') + '</table><p>نمایش ۱ تا ۵۰ از ۵۱ قرارداد</p><button disabled>قبلی</button><button>بعدی</button>'
            : '<p>قراردادی یافت نشد</p>');
        })();
      </script></main>`);
    } else if (url.pathname === '/dashboard/accounting/duties') {
      res.end(`<main><script>
        fetch('/api/duties/workspaces/accounting/duties?view=available');
        fetch('/api/duties/workspaces/accounting/duties?view=assigned').then(r => r.json()).then(() => {
          document.querySelector('main').insertAdjacentHTML('beforeend', '<p>وظیفه بازی ندارید</p>');
        });
        fetch('/api/duties/workspaces/accounting/summary').then(r => r.json()).then(() => {
          document.querySelector('main').insertAdjacentHTML('beforeend',
            '<p>باز</p><p>تا ۲۴ ساعت</p><p>گذشته از موعد</p><p>قابل دریافت</p><button>وظایف من</button><button>قابل دریافت ۱</button><button>تاریخچه</button>');
        });
      </script></main>`);
    } else res.end('');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });

  const output = path.join(directory, 'receipt.json');
  const child = spawn(process.execPath, [script], { stdio: 'inherit', env: {
    ...process.env, ACCOUNTING_TIMING_RUN: 'candidate', ACCOUNTING_TIMING_WORKLOAD: 'http-fixture',
    ACCOUNTING_TIMING_SURFACES: 'dashboard,reviewable-list,duties', ACCOUNTING_TIMING_SAMPLES: '4', ACCOUNTING_TIMING_CONCURRENCY: '1',
    ACCOUNTING_TIMING_IDENTIFIER: 'fixture', ACCOUNTING_TIMING_PASSWORD: 'fixture', ACCOUNTING_TIMING_COMMIT: commit,
    ACCOUNTING_TIMING_ORIGIN: `http://127.0.0.1:${server.address().port}`, ACCOUNTING_TIMING_OUTPUT: output,
    ACCOUNTING_TIMING_SEPIDAR_FIXTURE: '',
  } });
  const [code] = await once(child, 'exit');
  assert.equal(code, 2, 'HTTP error and aborted transfer make the run fail');
  const raw = await readFile(output, 'utf8');
  const { results, metrics } = JSON.parse(raw);
  const [unavailable, aborted, rendered, invalidChart] = results.filter(sample => sample.surface === 'dashboard');
  assert.equal(unavailable.api.path, '/api/accounting/dashboard');
  assert.equal(unavailable.api.view, null);
  assert.equal(unavailable.failure, 'API_FAILED');
  assert.equal(unavailable.browser.errors.unavailable, 1);
  assert.equal(unavailable.api.status, 503);
  assert.ok(Number.isFinite(unavailable.api.fullHttpMs));
  assert.equal(aborted.failure, 'INCOMPLETE_TRANSFER');
  assert.equal(aborted.api.transferFailure, 'client_abort');
  assert.equal(aborted.api.fullHttpMs, undefined);
  assert.equal(rendered.data.chart, 'rendered');
  assert.ok(rendered.completeMs >= 600, 'full readiness waits for the fresh rendered chart');
  assert.equal(invalidChart.failure, 'CHART_UNAVAILABLE');
  assert.equal(metrics.dashboard.fullHttpMs.count, 3);
  assert.equal(metrics.dashboard.completeMs.count, 1);
  const reviewable = results.filter(sample => sample.surface === 'reviewable-list');
  const [sample] = reviewable;
  assert.deepEqual(navigations, Array(4).fill('?view=reviewable'));
  assert.equal(sample.api.requestId, reviewableId);
  assert.equal(sample.api.path, '/api/accounting/contracts');
  assert.equal(sample.api.view, 'reviewable');
  assert.doesNotMatch(raw, /synthetic-secret/);
  assert.ok(sample.api.fullHttpMs >= 850, 'includes delayed final body bytes');
  assert.ok(sample.firstActionMs >= sample.api.fullHttpMs, 'verified empty state is measured after transfer completion');
  assert.ok(sample.api.responseBodyBytes > 0);
  assert.deepEqual(sample.data, { state: 'empty', page: 1, pageSize: 50, total: 0, rows: 0 });
  assert.deepEqual(reviewable[2].data, { state: 'rows', page: 1, pageSize: 50, total: 51, rows: 50 });
  assert.deepEqual(metrics['reviewable-list'].fullHttpMs, { count: 4, p95: Math.max(...reviewable.map(row => row.api.fullHttpMs)) });
  const [duties] = results.filter(sample => sample.surface === 'duties');
  assert.equal(duties.api.view, 'assigned');
  assert.equal(duties.data.state, 'empty');
  assert.ok(duties.firstActionMs < duties.summaryReadyMs, 'the queue and summary render independently');
  assert.ok(duties.summary.fullHttpMs >= 400);
  assert.ok(duties.completeMs >= duties.summaryReadyMs);
  assert.equal(metrics.duties.target.passed, true);
});
