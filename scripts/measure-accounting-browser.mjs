import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const env = process.env;
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const commitPattern = /^[0-9a-f]{40}$/;
const validOutcome = new Set([
  'success', 'client_abort', 'contention', 'pool_timeout', 'transaction_expired',
  'unavailable', 'upstream_unavailable', 'upstream_timeout', 'internal_error', 'rejected',
]);
const timeout = 30_000;

function options() {
  const baseURL = new URL(env.ACCOUNTING_TIMING_ORIGIN ?? 'http://127.0.0.1:3000');
  if (!loopback.has(baseURL.hostname) || !['http:', 'https:'].includes(baseURL.protocol)
    || baseURL.username || baseURL.password || baseURL.href !== baseURL.origin + '/') throw Error('LOOPBACK_ORIGIN_REQUIRED');

  const commit = env.ACCOUNTING_TIMING_COMMIT;
  const workload = env.ACCOUNTING_TIMING_WORKLOAD;
  const samples = Number(env.ACCOUNTING_TIMING_SAMPLES ?? 20);
  const concurrency = Number(env.ACCOUNTING_TIMING_CONCURRENCY ?? 1);
  const run = env.ACCOUNTING_TIMING_RUN;
  const output = env.ACCOUNTING_TIMING_OUTPUT;
  if (!commitPattern.test(commit ?? '') || !/^[a-z0-9-]{1,48}$/.test(workload ?? '')
    || !['baseline', 'candidate'].includes(run) || !output
    || !Number.isSafeInteger(samples) || samples < 1 || samples > 1000
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 20 || concurrency > samples
    || !env.ACCOUNTING_TIMING_IDENTIFIER || !env.ACCOUNTING_TIMING_PASSWORD) throw Error('INVALID_TIMING_INPUT');
  return { baseURL, commit, workload, samples, concurrency, run, output };
}

const list = '/api/accounting/dispatch-candidates';
const detail = /^\/api\/accounting\/dispatch-candidates\/[^/]+\/document-read-model$/;
const reference = /^\/api\/accounting\/loadings\/[^/]+\/sepidar-reference$/;
const scenarios = [
  { name: 'dashboard', page: '/dashboard/accounting', api: '/api/accounting/dashboard',
    ready: page => page.getByRole('button', { name: 'به‌روزرسانی', exact: true }) },
  { name: 'reviewable-list', page: '/dashboard/accounting/contracts', api: '/api/accounting/contracts',
    ready: page => page.getByRole('row').filter({ has: page.getByRole('cell') }).first().getByRole('link', { name: /^(مشاهده|مشاهده پرونده)$/ }) },
  { name: 'dispatch', page: '/dashboard/accounting/dispatch', api: list,
    ready: page => page.getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری', exact: true }).first() },
];

function requestKind(request) {
  const url = new URL(request.url());
  if (!loopback.has(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return;
  const path = url.pathname;
  if (path === list) return 'dispatch-list';
  if (detail.test(path)) return 'dispatch-detail';
  if (reference.test(path)) return 'dispatch-reference-command';
  if (path.startsWith('/api/')) return 'api';
  if (request.resourceType() === 'document') return 'document';
  return 'asset';
}

function monitor(page) {
  const entries = new Map();
  let active = true;
  page.on('request', request => {
    const kind = requestKind(request);
    if (active && kind) entries.set(request, { kind });
  });
  page.on('response', response => {
    const entry = entries.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    const outcome = response.headers()['x-accounting-outcome'];
    if (validOutcome.has(outcome) && outcome !== 'success') entry.outcome = outcome;
  });
  page.on('requestfinished', request => {
    const entry = entries.get(request);
    if (active && entry) entry.sizes = request.sizes().catch(() => null);
  });
  page.on('requestfailed', request => {
    const entry = entries.get(request);
    if (active && entry) entry.failed = request.failure()?.errorText === 'net::ERR_ABORTED' ? 'client_abort' : 'transport_error';
  });
  return async () => {
    active = false;
    const result = { requestCount: entries.size, completedRequests: 0, responseBodyBytes: 0, requestsByKind: {}, errors: {} };
    for (const entry of entries.values()) {
      result.requestsByKind[entry.kind] = (result.requestsByKind[entry.kind] ?? 0) + 1;
      const sizes = await entry.sizes;
      if (sizes) {
        result.completedRequests++;
        result.responseBodyBytes += sizes.responseBodySize;
      }
      const status = entry.status;
      const failure = entry.failed ?? entry.outcome ?? (status === 499 ? 'client_abort' :
        status === 502 ? 'upstream_unavailable' : status === 503 ? 'unavailable' :
        status === 504 ? 'upstream_timeout' : status >= 500 ? 'internal_error' : status >= 400 ? 'rejected' : undefined);
      if (failure) result.errors[failure] = (result.errors[failure] ?? 0) + 1;
    }
    return result;
  };
}

const validId = value => /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(value ?? '') ? value : undefined;
const pathIs = (response, path, method) => response.request().method() === method
  && new URL(response.url()).pathname === path;

function checkResponse(response, config) {
  const headers = response.headers();
  const requestId = validId(headers['x-accounting-request-id']);
  const evidenceCommit = headers['x-accounting-commit'];
  const outcome = headers['x-accounting-outcome'];
  if (evidenceCommit && commitPattern.test(evidenceCommit) && evidenceCommit !== config.commit) throw Error('BUILD_MISMATCH');
  if (config.run === 'candidate' && response.ok() && (!requestId || evidenceCommit !== config.commit)) throw Error('BUILD_UNATTESTED');
  return { requestId, status: response.status(), outcome: validOutcome.has(outcome) ? outcome : undefined };
}

async function sample(browser, config, scenario, command) {
  const context = await browser.newContext({ baseURL: config.baseURL.origin, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  const result = { surface: scenario.name, commandsEnabled: Boolean(command) };
  let stop;
  let stage = 'login';
  try {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(env.ACCOUNTING_TIMING_IDENTIFIER);
    await page.locator('input[name="password"]').fill(env.ACCOUNTING_TIMING_PASSWORD);
    await Promise.all([page.waitForURL(/\/dashboard$/), page.getByRole('button', { name: 'ورود', exact: true }).click()]);
    stage = 'first_action';
    stop = monitor(page);
    const started = performance.now();
    const [response] = await Promise.all([
      page.waitForResponse(response => pathIs(response, scenario.api, 'GET')),
      page.goto(scenario.page, { waitUntil: 'commit' }),
    ]);
    result.api = checkResponse(response, config);
    if (!response.ok() || result.api.outcome) throw Error('API_FAILED');
    await scenario.ready(page).click({ trial: true });
    result.firstActionMs = Math.round(performance.now() - started);
    result.browser = await stop();
    stop = undefined;

    if (command) {
      stage = 'command';
      const row = page.getByRole('row').filter({ hasText: command.row });
      const invoiceAction = row.getByRole('button', { name: 'ثبت فاکتور سپیدار', exact: true });
      const legacyAction = row.getByRole('button', { name: 'ثبت شماره بارگیری سپیدار', exact: true });
      await invoiceAction.or(legacyAction).waitFor({ state: 'visible' });
      const invoiceWorkflow = await invoiceAction.isVisible();
      result.commandWorkflow = invoiceWorkflow ? 'loading-invoices' : 'legacy-loading-reference';
      await (invoiceWorkflow ? invoiceAction : legacyAction).click();
      await page.getByRole('textbox', { name: invoiceWorkflow ? 'شماره فاکتور سپیدار' : 'شماره بارگیری سپیدار', exact: true }).fill(command.reference);
      await page.getByRole('textbox', { name: invoiceWorkflow ? 'مبلغ فاکتور (ریال)' : 'مبلغ سپیدار (ریال)', exact: true }).fill(command.amount);
      stop = monitor(page);
      const commandStarted = performance.now();
      const [receipt] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'POST' && reference.test(new URL(response.url()).pathname))
          .then(response => ({ response, at: performance.now() })),
        page.getByRole('button', { name: invoiceWorkflow ? 'ذخیره فاکتورها' : 'ثبت شماره', exact: true }).click(),
      ]);
      result.command = checkResponse(receipt.response, config);
      if (!receipt.response.ok() || result.command.outcome) throw Error('COMMAND_FAILED');
      await page.getByText(invoiceWorkflow ? 'فاکتورهای سپیدار ثبت شدند.' : 'شماره بارگیری سپیدار ثبت شد.',
        { exact: true }).waitFor({ state: 'visible' });
      const visibleAt = Date.now();
      const acknowledged = Number(receipt.response.headers()['x-accounting-commit-acknowledged-ms']);
      result.submitToVisibleMs = Math.round(performance.now() - commandStarted);
      result.responseToVisibleMs = Math.round(performance.now() - receipt.at);
      if (Number.isSafeInteger(acknowledged) && acknowledged > 0 && acknowledged <= visibleAt) {
        result.commitAcknowledgedToVisibleMs = visibleAt - acknowledged;
      }
      if (config.run === 'candidate' && result.commitAcknowledgedToVisibleMs === undefined) throw Error('ACK_TIME_UNATTESTED');
    }
  } catch (error) {
    result.failed = stage;
    const safeErrors = new Set(['BUILD_MISMATCH', 'BUILD_UNATTESTED', 'API_FAILED', 'COMMAND_FAILED', 'ACK_TIME_UNATTESTED']);
    result.failure = safeErrors.has(error.message) ? error.message : error.name === 'TimeoutError' ? 'TIMEOUT' : 'BROWSER_FAILURE';
  } finally {
    if (stop) result[stage === 'command' ? 'commandBrowser' : 'browser'] = await stop();
    await context.close();
  }
  return result;
}

function p95(samples, measure) {
  const values = samples.map(measure).filter(Number.isFinite).sort((a, b) => a - b);
  return { count: values.length, p95: values.length ? values[Math.ceil(values.length * 0.95) - 1] : null };
}

async function run() {
  const config = options();
  const selected = env.ACCOUNTING_TIMING_SURFACES?.split(',').map(value => value.trim());
  if (selected?.some(name => !scenarios.some(scenario => scenario.name === name))) throw Error('INVALID_TIMING_SURFACES');
  const measuredScenarios = selected ? scenarios.filter(scenario => selected.includes(scenario.name)) : scenarios;
  const file = env.ACCOUNTING_TIMING_SEPIDAR_FIXTURE;
  const commands = file ? JSON.parse(await readFile(file, 'utf8')) : [];
  if (!Array.isArray(commands) || (file && commands.length !== config.samples)
    || commands.some(command => !command || typeof command.row !== 'string' || !command.row.trim()
      || typeof command.reference !== 'string' || !/^\d{1,64}$/.test(command.reference)
      || typeof command.amount !== 'string' || !/^\d+$/.test(command.amount))
    || new Set(commands.map(command => command.row)).size !== commands.length
    || new Set(commands.map(command => command.reference)).size !== commands.length) throw Error('INVALID_SEPIDAR_FIXTURE');

  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  const started = new Date().toISOString();
  try {
    // Each sample opens an independently authenticated browser context.
    for (const scenario of measuredScenarios) {
      for (let i = 0; i < config.samples; i += config.concurrency) {
        const batch = Array.from({ length: Math.min(config.concurrency, config.samples - i) }, (_, offset) =>
          sample(browser, config, scenario, scenario.name === 'dispatch' ? commands[i + offset] : undefined));
        results.push(...await Promise.all(batch));
      }
    }
  } finally {
    await browser.close();
  }
  const metrics = Object.fromEntries(measuredScenarios.map(({ name }) => {
    const samples = results.filter(sample => sample.surface === name);
    return [name, {
      samples: samples.length,
      failures: samples.filter(sample => sample.failed).length,
      firstActionMs: p95(samples, sample => sample.firstActionMs),
      submitToVisibleMs: p95(samples, sample => sample.submitToVisibleMs),
      responseToVisibleMs: p95(samples, sample => sample.responseToVisibleMs),
      commitAcknowledgedToVisibleMs: p95(samples, sample => sample.commitAcknowledgedToVisibleMs),
      requestCount: p95(samples, sample => sample.browser?.requestCount),
      responseBodyBytes: p95(samples, sample => sample.browser?.responseBodyBytes),
    }];
  }));
  await writeFile(config.output, JSON.stringify({
    format: 'sabalan-accounting-browser-timing/v1', started, commit: config.commit, workload: config.workload,
    run: config.run, concurrency: config.concurrency, actorClass: 'authorized-accountant', metrics, results,
  }, null, 2) + '\n', { flag: 'wx' });
  if (results.some(sample => sample.failed)) process.exitCode = 2;
}

run().catch(() => {
  console.error('Accounting browser timing failed to start or write evidence.');
  process.exitCode = 1;
});
