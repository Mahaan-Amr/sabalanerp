import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const env = process.env;
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const commitPattern = /^[0-9a-f]{40}$/;
const validOutcome = new Set([
  'success', 'client_abort', 'contention', 'pool_timeout', 'transaction_expired',
  'unavailable', 'upstream_unavailable', 'upstream_timeout', 'internal_error', 'rejected',
]);
const timeout = 30_000;
const targetMs = 3_000;

export function options(env) {
  const baseURL = new URL(env.ACCOUNTING_TIMING_ORIGIN ?? 'http://127.0.0.1:3000');
  if (!loopback.has(baseURL.hostname) || !['http:', 'https:'].includes(baseURL.protocol)
    || baseURL.username || baseURL.password || baseURL.href !== baseURL.origin + '/') throw Error('LOOPBACK_ORIGIN_REQUIRED');

  const commit = env.ACCOUNTING_TIMING_COMMIT;
  const workload = env.ACCOUNTING_TIMING_WORKLOAD;
  const samples = Number(env.ACCOUNTING_TIMING_SAMPLES ?? 20);
  const concurrency = Number(env.ACCOUNTING_TIMING_CONCURRENCY ?? 1);
  const phase = env.ACCOUNTING_TIMING_PHASE ?? 'cold';
  const actorClass = env.ACCOUNTING_TIMING_ACTOR_CLASS ?? 'authenticated';
  const run = env.ACCOUNTING_TIMING_RUN;
  const output = env.ACCOUNTING_TIMING_OUTPUT;
  if (!commitPattern.test(commit ?? '') || !/^[a-z0-9-]{1,48}$/.test(workload ?? '')
    || !['baseline', 'candidate'].includes(run) || !['cold', 'warm', 'mixed'].includes(phase) || !output
    || !['accountant', 'administrator', 'authenticated'].includes(actorClass)
    || !Number.isSafeInteger(samples) || samples < 1 || samples > 1000
    || (phase === 'mixed' && samples < 2)
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 20 || concurrency > samples
    || !env.ACCOUNTING_TIMING_IDENTIFIER || !env.ACCOUNTING_TIMING_PASSWORD) throw Error('INVALID_TIMING_INPUT');
  return { baseURL, commit, workload, samples, concurrency, phase, actorClass, run, output };
}

const list = '/api/accounting/dispatch-candidates';
const detail = /^\/api\/accounting\/dispatch-candidates\/[^/]+\/document-read-model$/;
const reference = /^\/api\/accounting\/loadings\/[^/]+\/sepidar-reference$/;
const dutyList = '/api/duties/workspaces/accounting/duties';
const dutySummary = '/api/duties/workspaces/accounting/summary';
const paymentPlanCandidates = { api: '/api/partner/accounting/sabalan-plan-candidates' };
const accountingPage = '/dashboard/accounting';

function register(name, { path = name, endpoint = path, view = null, kind, empty, itemLabel, pageSize = 50 }) {
  return {
    name, page: `${accountingPage}/${path}${view ? `?view=${view}` : ''}`,
    api: `/api/accounting/${endpoint}`, view,
    query: { page: '1', ...(name === 'customer-accounts' ? {} : { pageSize: String(pageSize) }), ...(kind ? { kind } : {}) },
    register: { empty, itemLabel, pageSize }, target: name !== 'customer-accounts',
  };
}

const scenarios = [
  { name: 'dashboard', page: accountingPage, view: null, api: '/api/accounting/dashboard', query: { range: '6m' }, target: true },
  register('reviewable-list', { path: 'contracts', view: 'reviewable', empty: 'قراردادی یافت نشد', itemLabel: 'قرارداد' }),
  register('invoice-candidates', { endpoint: 'financial-records', view: 'actionable', kind: 'INVOICE_CANDIDATE',
    empty: 'صورتحسابی در این فیلتر وجود ندارد', itemLabel: 'رکورد' }),
  register('correction-requests', { view: 'active', empty: 'درخواست اصلاح بازی وجود ندارد', itemLabel: 'درخواست' }),
  register('receivables', { view: 'open', empty: 'دریافتنی ثبت نشده است', itemLabel: 'دریافتنی' }),
  register('payments', { view: 'due-soon', empty: 'دریافت یا چکی ثبت نشده است', itemLabel: 'دریافت' }),
  register('tax', { view: 'needs-attention', empty: 'پرونده مالیاتی ثبت نشده است', itemLabel: 'پرونده' }),
  register('audit', { empty: 'هنوز سابقه‌ای ثبت نشده است', itemLabel: 'سابقه' }),
  { name: 'duties', page: `${accountingPage}/duties`, api: dutyList, view: 'assigned', target: true },
  { name: 'dispatch', page: '/dashboard/accounting/dispatch', api: list,
    ready: page => page.getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری', exact: true }).first() },
  register('customer-accounts', { endpoint: 'ledger/customer-accounts', empty: 'مشتری مستقیمی ثبت نشده است', pageSize: 25 }),
];
const defaultSurfaces = ['dashboard', 'reviewable-list', 'dispatch'];
const readKinds = new Map([
  ...scenarios.map(scenario => [scenario.api, scenario.name]),
  [list, 'dispatch-list'],
  [dutyList, 'duties-list'],
  [dutySummary, 'duties-summary'],
  [paymentPlanCandidates.api, 'payment-plan-candidates'],
  ['/api/accounting/dashboard/workspace', 'dashboard-workspace'],
  ['/api/accounting/dashboard/change', 'dashboard-change'],
  ['/api/accounting/financial-trend', 'financial-trend'],
  ['/api/notifications/unread-count', 'notification-count'],
  ['/api/notifications', 'notification-preview'],
  ['/api/auth/me', 'session-context'],
  ['/api/dashboard/profile', 'dashboard-profile'],
  ['/api/dashboard/route-availability', 'route-access'],
  ['/api/workspace-permissions/user-workspaces', 'workspace-access'],
  ['/api/system-recovery/environment', 'runtime-environment'],
  ['/api/personnel-performance/badge/me', 'personnel-badge'],
]);

function requestKind(request) {
  const url = new URL(request.url());
  if (!loopback.has(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return;
  const path = url.pathname;
  if (readKinds.has(path)) return readKinds.get(path);
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
    const result = {
      requestCount: entries.size, completedRequests: 0, unfinishedRequests: 0,
      responseBodyBytes: 0, requestsByKind: {}, errors: {}, errorsByKind: {},
    };
    for (const entry of entries.values()) {
      result.requestsByKind[entry.kind] = (result.requestsByKind[entry.kind] ?? 0) + 1;
      const sizes = await entry.sizes;
      if (sizes) {
        result.completedRequests++;
        result.responseBodyBytes += sizes.responseBodySize;
      }
      if (!entry.sizes && !entry.failed) result.unfinishedRequests++;
      const status = entry.status;
      const failure = entry.failed ?? entry.outcome ?? (status === 499 ? 'client_abort' :
        status === 502 ? 'upstream_unavailable' : status === 503 ? 'unavailable' :
        status === 504 ? 'upstream_timeout' : status >= 500 ? 'internal_error' : status >= 400 ? 'rejected' : undefined);
      if (failure) {
        result.errors[failure] = (result.errors[failure] ?? 0) + 1;
        const errors = result.errorsByKind[entry.kind] ??= {};
        errors[failure] = (errors[failure] ?? 0) + 1;
      }
    }
    return result;
  };
}

const validId = value => /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(value ?? '') ? value : undefined;
const reviewableDefaults = {
  lifecycleView: 'active', status: 'ALL', sourceStatus: 'ALL', sourceKind: 'ALL',
  taxStatus: 'ALL', search: '', dateFrom: '', dateTo: '', sort: '',
};
function matchesRead(response, scenario, origin) {
  const url = new URL(response.url());
  if (response.request().method() !== 'GET' || url.pathname !== scenario.api || url.origin !== origin) return false;
  if ([...url.searchParams.keys()].some(key => key.includes('['))) return false;
  if (scenario.name === 'reviewable-list' && !Object.entries(reviewableDefaults).every(([key, value]) => {
    const values = url.searchParams.getAll(key);
    return values.length === 0 || values.length === 1 && values[0] === value;
  })) return false;
  return Object.entries({ view: scenario.view ?? null, ...scenario.query }).every(([key, expected]) => {
    const values = url.searchParams.getAll(key);
    return expected === null ? values.length === 0 : values.length === 1 && values[0] === expected;
  });
}

async function fullTransfer(page, response, navigationStartedAt) {
  const request = response.request();
  let timer;
  let onFailure;
  try {
    const interrupted = new Promise(resolve => {
      onFailure = failed => { if (failed === request) resolve(false); };
      page.on('requestfailed', onFailure);
      timer = setTimeout(() => resolve(false), timeout);
    });
    const complete = !request.failure() && await Promise.race([
      response.finished().then(error => !error, () => false), interrupted,
    ]);
    const timing = request.timing();
    const duration = timing.responseEnd;
    if (complete && !request.failure() && Number.isFinite(duration) && duration >= 0) {
      const sizes = await request.sizes().catch(() => null);
      const requestStartMs = timing.startTime - navigationStartedAt;
      return { fullHttpMs: duration, responseBodyBytes: sizes?.responseBodySize,
        requestStartMs: Number.isFinite(requestStartMs) && requestStartMs >= 0 ? requestStartMs : undefined };
    }
    return { transferFailure: request.failure()?.errorText === 'net::ERR_ABORTED' ? 'client_abort' : 'incomplete_transfer' };
  } finally {
    clearTimeout(timer);
    page.off('requestfailed', onFailure);
  }
}

function checkResponse(response, config) {
  const headers = response.headers();
  const requestId = validId(headers['x-accounting-request-id']);
  const evidenceCommit = headers['x-accounting-commit'];
  const outcome = headers['x-accounting-outcome'];
  if (evidenceCommit && commitPattern.test(evidenceCommit) && evidenceCommit !== config.commit) throw Error('BUILD_MISMATCH');
  if (config.run === 'candidate' && response.ok() && (!requestId || evidenceCommit !== config.commit)) throw Error('BUILD_UNATTESTED');
  return { requestId, status: response.status(), outcome: validOutcome.has(outcome) ? outcome : undefined };
}

async function readData(page, response, config, scenario, result, navigationStartedAt, key = 'api') {
  const receipt = result[key] = {
    ...checkResponse(response, config), path: scenario.api, view: scenario.view ?? null,
  };
  Object.assign(receipt, await fullTransfer(page, response, navigationStartedAt));
  if (receipt.transferFailure) throw Error('INCOMPLETE_TRANSFER');
  if (!response.ok()) throw Error('API_FAILED');
  const body = await response.json().catch(() => null);
  if (receipt.outcome && receipt.outcome !== 'success'
    && !(scenario.name === 'dashboard' && body?.data?.trendError)) throw Error('API_FAILED');
  if (body?.success !== true || body.data == null) throw Error('INVALID_READ_DATA');
  return body.data;
}

const visible = locator => locator.waitFor({ state: 'visible' });
const count = value => Number.isSafeInteger(value) && value >= 0;
const fa = value => value.toLocaleString('fa-IR');

async function readyRegister(page, data, scenario) {
  const { empty, itemLabel, pageSize } = scenario.register;
  const { items, page: pageNumber, total } = data;
  if (!Array.isArray(items) || pageNumber !== 1 || data.pageSize !== pageSize || !count(total)
    || items.length !== Math.min(total, pageSize)) throw Error('INVALID_READ_DATA');

  const rows = page.getByRole('row').filter({ has: page.getByRole('cell') });
  const controls = [visible(page.getByRole('searchbox'))];
  if (items.length && scenario.name === 'customer-accounts') {
    controls.push(visible(page.getByText(`${fa(total)} مشتری · صفحه ${fa(pageNumber)}`, { exact: true })));
  } else if (items.length) {
    controls.push(visible(page.getByText(`نمایش ${fa(1)} تا ${fa(items.length)} از ${fa(total)} ${itemLabel}`, { exact: true })));
  }
  if (items.length) {
    controls.push(...['قبلی', 'بعدی'].map(name => visible(page.getByRole('button', { name, exact: true }))));
  }
  controls.push(items.length ? visible(rows.nth(items.length - 1)) : visible(page.getByText(empty, { exact: true })));
  if (scenario.name === 'reviewable-list' && items.length) {
    controls.push(rows.first().getByRole('link', { name: /^(مشاهده|مشاهده پرونده)$/ }).click({ trial: true }));
  }
  await Promise.all(controls);
  if (await rows.count() !== items.length) throw Error('INVALID_RENDERED_DATA');
  return { state: items.length ? 'rows' : 'empty', page: pageNumber, pageSize, total, rows: items.length };
}

async function readyDashboard(page, data, queueReady) {
  const { workspace, trend, trendError } = data;
  if (!Array.isArray(workspace?.queues?.contracts) || !Array.isArray(workspace?.deadlines?.items)
    || !count(workspace?.commandCenter?.reviewableContracts?.count)) throw Error('INVALID_READ_DATA');
  const workQueueRows = workspace.queues.contracts.filter(row => row?.attention).slice(0, 6).length;
  const waitForQueue = () => Promise.all([
    visible(page.getByRole('heading', { name: 'کارهای امروز', exact: true })),
    visible(page.getByRole('link', { name: 'مشاهده همه قراردادها', exact: true })),
    visible(workQueueRows ? page.getByText(/^مدرک یا مغایرت:/).nth(workQueueRows - 1)
      : page.getByText('در خلاصهٔ فعلی اقدام فوری برای قراردادها پیدا نشد.', { exact: true })),
  ]).then(queueReady);
  if (trendError) {
    await waitForQueue();
    throw Error('CHART_UNAVAILABLE');
  }
  if (trend?.range !== '6m' || !Array.isArray(trend.points) || !trend.points.length) throw Error('INVALID_READ_DATA');
  const points = trend.points.flatMap(point => [point?.invoicedRial, point?.receivedRial, point?.outstandingRial]);
  if (!points.every(Number.isFinite)) throw Error('INVALID_READ_DATA');
  const hasChart = points.some(value => value !== 0);
  const chart = page.getByRole('region', { name: 'روند مالی قراردادها', exact: true });
  const metrics = page.getByRole('region', { name: 'شاخص‌های عملیاتی حسابداری', exact: true });
  await Promise.all([
    waitForQueue(),
    visible(page.getByRole('heading', { name: 'سررسیدها', exact: true })),
    visible(workspace.deadlines.items.length
      ? page.getByRole('link', { name: /· سررسید / }).nth(workspace.deadlines.items.length - 1)
      : page.getByText('موردی در این فیلتر وجود ندارد', { exact: true })),
    visible(metrics.getByRole('link', { name: /^قراردادهای قابل بررسی/ })
      .getByText(fa(workspace.commandCenter.reviewableContracts.count), { exact: true })),
    visible(hasChart ? chart.locator('div[aria-busy="false"] svg.recharts-surface:has(.recharts-area-curve[d])')
      : chart.getByText('هنوز رویداد مالی معناداری برای این بازه ثبت نشده است.', { exact: true })),
  ]);
  await metrics.getByText('در حال بررسی دسترسی', { exact: true }).first().waitFor({ state: 'hidden' });
  if (await page.getByText('شاخص‌های استخدام در دسترس نیستند. برای تلاش دوباره از به‌روزرسانی استفاده کنید.',
    { exact: true }).isVisible()) throw Error('METRICS_UNAVAILABLE');
  return { chart: hasChart ? 'rendered' : 'empty', workQueueRows };
}

async function readyDutyQueue(page, duties) {
  if (!Array.isArray(duties)) throw Error('INVALID_READ_DATA');
  if (duties.length) {
    await page.getByRole('link', { name: 'مشاهده وظیفه', exact: true }).first().click({ trial: true });
  } else {
    await visible(page.getByText('وظیفه بازی ندارید', { exact: true }));
  }
  return { state: duties.length ? 'rows' : 'empty', rows: duties.length };
}

async function readyDutySummary(page, summary) {
  const badges = [['وظایف من', summary.open], ['قابل دریافت', summary.available], ['تاریخچه', summary.historyUnseen]];
  if (summary.canManageTriage) badges.push(['بدون مسئول', summary.triage]);
  if (typeof summary.canManageTriage !== 'boolean'
    || ![summary.dueSoon, summary.overdue, summary.triage, ...badges.map(([, value]) => value)].every(count)) {
    throw Error('INVALID_READ_DATA');
  }
  await Promise.all([
    ...['باز', 'تا ۲۴ ساعت', 'گذشته از موعد', 'قابل دریافت'].map(label => visible(page.getByText(label, { exact: true }).first())),
    ...badges.map(([label, value]) => visible(page.getByRole('button', { name: value ? `${label} ${fa(value)}` : label, exact: true }))),
  ]);
}

async function readyPaymentPlanCandidates(page, response, config, result, navigationStartedAt) {
  const expectScopeDenial = response.status() === 403 && config.actorClass !== 'administrator';
  let data;
  if (expectScopeDenial) {
    const evidence = checkResponse(response, config);
    if (!evidence.requestId || response.headers()['x-accounting-commit'] !== config.commit) throw Error('BUILD_UNATTESTED');
    result.paymentPlan = { ...evidence, path: paymentPlanCandidates.api,
      ...await fullTransfer(page, response, navigationStartedAt) };
    if (result.paymentPlan.transferFailure) throw Error('INCOMPLETE_TRANSFER');
    const body = await response.json().catch(() => null);
    if (body?.success !== false || body.code !== 'FORBIDDEN') throw Error('INVALID_READ_DATA');
    data = [];
  } else {
    data = await readData(page, response, config, paymentPlanCandidates, result, navigationStartedAt, 'paymentPlan');
    if (!Array.isArray(data)) throw Error('INVALID_READ_DATA');
  }
  const actions = page.getByRole('button', { name: 'ثبت برنامه پرداخت به سبلان', exact: true });
  if (data.length) {
    await visible(actions.nth(data.length - 1));
    if (await actions.count() !== data.length) throw Error('INVALID_RENDERED_DATA');
  } else {
    await actions.first().waitFor({ state: 'hidden' });
  }
  result.paymentPlan.rows = data.length;
}

async function measureFirstRead(page, config, scenario, result) {
  const navigationStartedAt = Date.now();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const waitFor = spec => page.waitForResponse(response => matchesRead(response, spec, config.baseURL.origin));
  const actions = [
    waitFor(scenario).then(async response => {
      if (scenario.name === 'dispatch') {
        result.api = { ...checkResponse(response, config), path: scenario.api,
          ...await fullTransfer(page, response, navigationStartedAt) };
        if (result.api.transferFailure) throw Error('INCOMPLETE_TRANSFER');
        if (!response.ok() || (result.api.outcome && result.api.outcome !== 'success')) throw Error('API_FAILED');
        await scenario.ready(page).click({ trial: true });
      } else {
        const data = await readData(page, response, config, scenario, result, navigationStartedAt);
        if (scenario.register) result.data = await readyRegister(page, data, scenario);
        else if (scenario.name === 'dashboard') {
          result.data = await readyDashboard(page, data, () => { result.firstActionMs = elapsed(); });
          result.completeMs = elapsed();
          return;
        }
        else result.data = await readyDutyQueue(page, data);
      }
      result.firstActionMs = elapsed();
    }),
  ];
  if (scenario.name === 'duties') {
    const summary = { api: dutySummary };
    actions.push(waitFor(summary).then(async response => {
      const data = await readData(page, response, config, summary, result, navigationStartedAt, 'summary');
      await readyDutySummary(page, data);
      result.summaryReadyMs = elapsed();
    }));
  }
  // The deployed baseline does not mount the URL its invoice page requests.
  // Measure the first invoice rows on both builds and attach the plan result on candidates.
  if (scenario.name === 'invoice-candidates' && config.run === 'candidate') {
    actions.push(waitFor(paymentPlanCandidates).then(async response => {
      await readyPaymentPlanCandidates(page, response, config, result, navigationStartedAt);
      result.paymentPlanReadyMs = elapsed();
    }));
  }
  const [navigation, ...reads] = await Promise.allSettled([page.goto(scenario.page, { waitUntil: 'commit' }), ...actions]);
  for (const outcome of [navigation, ...reads]) {
    if (outcome.status === 'rejected') throw outcome.reason;
  }
  result.completeMs ??= Math.max(result.firstActionMs, result.summaryReadyMs ?? 0, result.paymentPlanReadyMs ?? 0);
}

async function sample(browser, config, scenario, command, phase) {
  const context = await browser.newContext({ baseURL: config.baseURL.origin, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  const result = { surface: scenario.name, phase, commandsEnabled: Boolean(command) };
  let stop;
  let stage = 'login';
  try {
    await page.goto('/login');
    if (new URL(page.url()).origin !== config.baseURL.origin) throw Error('UNEXPECTED_ORIGIN');
    await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(env.ACCOUNTING_TIMING_IDENTIFIER);
    await page.locator('input[name="password"]').fill(env.ACCOUNTING_TIMING_PASSWORD);
    await Promise.all([page.waitForURL(/\/dashboard$/), page.getByRole('button', { name: 'ورود', exact: true }).click()]);
    if (phase === 'warm') {
      stage = 'warmup';
      await measureFirstRead(page, config, scenario, {});
    }
    stage = 'first_action';
    stop = monitor(page);
    await measureFirstRead(page, config, scenario, result);
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
      if (!receipt.response.ok() || (result.command.outcome && result.command.outcome !== 'success')) throw Error('COMMAND_FAILED');
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
    const safeErrors = new Set(['BUILD_MISMATCH', 'BUILD_UNATTESTED', 'API_FAILED', 'COMMAND_FAILED', 'ACK_TIME_UNATTESTED',
      'UNEXPECTED_ORIGIN', 'INCOMPLETE_TRANSFER', 'INVALID_READ_DATA', 'INVALID_RENDERED_DATA', 'CHART_UNAVAILABLE', 'METRICS_UNAVAILABLE']);
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

function readinessMetrics(samples, name, target) {
  const failures = samples.filter(sample => sample.failed).length;
  const firstActionMs = p95(samples, sample => sample.firstActionMs);
  const completeMs = p95(samples, sample => sample.completeMs);
  const chartEmptySamples = samples.filter(sample => sample.data?.chart === 'empty').length;
  return {
    samples: samples.length,
    failures,
    firstActionMs,
    completeMs,
    ...(target ? { target: { belowMs: targetMs, passed: samples.length > 0
      && failures === 0 && chartEmptySamples === 0
      && firstActionMs.count === samples.length && firstActionMs.p95 < targetMs
      && completeMs.count === samples.length && completeMs.p95 < targetMs } } : {}),
    ...(name === 'dashboard' ? { chartEmptySamples } : {}),
  };
}

export function summarizeSurface(samples, { name, target, phase }) {
  const aggregate = readinessMetrics(samples, name, target);
  const phases = phase === 'mixed' ? ['cold', 'warm'] : [phase];
  const byPhase = Object.fromEntries(phases.map(phase => [
    phase, readinessMetrics(samples.filter(sample => sample.phase === phase), name, target),
  ]));
  if (aggregate.target) {
    aggregate.target.passed &&= Object.values(byPhase).every(metrics => metrics.target.passed);
  }
  return {
    ...aggregate,
    byPhase,
    fullHttpMs: p95(samples, sample => sample.api?.fullHttpMs),
    apiRequestStartMs: p95(samples, sample => sample.api?.requestStartMs),
    apiResponseBodyBytes: p95(samples, sample => sample.api?.responseBodyBytes),
    ...(name === 'invoice-candidates' ? {
      paymentPlanReadyMs: p95(samples, sample => sample.paymentPlanReadyMs),
      paymentPlanFullHttpMs: p95(samples, sample => sample.paymentPlan?.fullHttpMs),
    } : {}),
    ...(name === 'duties' ? {
      summaryReadyMs: p95(samples, sample => sample.summaryReadyMs),
      summaryFullHttpMs: p95(samples, sample => sample.summary?.fullHttpMs),
      summaryResponseBodyBytes: p95(samples, sample => sample.summary?.responseBodyBytes),
    } : {}),
    submitToVisibleMs: p95(samples, sample => sample.submitToVisibleMs),
    responseToVisibleMs: p95(samples, sample => sample.responseToVisibleMs),
    commitAcknowledgedToVisibleMs: p95(samples, sample => sample.commitAcknowledgedToVisibleMs),
    requestCount: p95(samples, sample => sample.browser?.requestCount),
    responseBodyBytes: p95(samples, sample => sample.browser?.responseBodyBytes),
  };
}

async function run() {
  const config = options(env);
  const selected = env.ACCOUNTING_TIMING_SURFACES?.split(',').map(value => value.trim()) ?? defaultSurfaces;
  if (!(selected.length === 1 && selected[0] === 'all')
    && selected.some(name => !scenarios.some(scenario => scenario.name === name))) throw Error('INVALID_TIMING_SURFACES');
  const measuredScenarios = selected.includes('all') ? scenarios : scenarios.filter(scenario => selected.includes(scenario.name));
  const file = env.ACCOUNTING_TIMING_SEPIDAR_FIXTURE;
  const commands = file ? JSON.parse(await readFile(file, 'utf8')) : [];
  if (!Array.isArray(commands) || (file && commands.length !== config.samples)
    || commands.some(command => !command || typeof command.row !== 'string' || !command.row.trim()
      || typeof command.reference !== 'string' || !/^\d{1,64}$/.test(command.reference)
      || typeof command.amount !== 'string' || !/^\d+$/.test(command.amount))
    || new Set(commands.map(command => command.row)).size !== commands.length
    || new Set(commands.map(command => command.reference)).size !== commands.length) throw Error('INVALID_SEPIDAR_FIXTURE');

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  const started = new Date().toISOString();
  try {
    // Each sample opens an independently authenticated browser context.
    for (const scenario of measuredScenarios) {
      for (let i = 0; i < config.samples; i += config.concurrency) {
        const batch = Array.from({ length: Math.min(config.concurrency, config.samples - i) }, (_, offset) => {
          const index = i + offset;
          const phase = config.phase === 'mixed' ? (index % 2 === 0 ? 'cold' : 'warm') : config.phase;
          return sample(browser, config, scenario, scenario.name === 'dispatch' ? commands[index] : undefined, phase);
        });
        results.push(...await Promise.all(batch));
      }
    }
  } finally {
    await browser.close();
  }
  const metrics = Object.fromEntries(measuredScenarios.map(({ name, target }) => [
    name, summarizeSurface(results.filter(sample => sample.surface === name), { name, target, phase: config.phase }),
  ]));
  await writeFile(config.output, JSON.stringify({
    format: 'sabalan-accounting-browser-timing/v1', started, commit: config.commit, workload: config.workload,
    run: config.run, concurrency: config.concurrency, phase: config.phase, actorClass: config.actorClass, metrics, results,
  }, null, 2) + '\n', { flag: 'wx' });
  if (results.some(sample => sample.failed) || Object.values(metrics).some(surface => surface.target?.passed === false)) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => {
    console.error('Accounting browser timing failed to start or write evidence.');
    process.exitCode = 1;
  });
}
