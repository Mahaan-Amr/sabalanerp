import { lookup } from 'node:dns/promises';
import { expect, test, type Page, type Request, type Response } from '@playwright/test';
import type { CustomerAccount } from '../../frontend/src/features/accounting/customerAccountModel';
import { loginThroughBrowser } from '../support/browser-login';

const origin = 'https://erp.qa.test';
const enabled = process.env.SABALAN_ALLOCATION_QA_RUN === '1';
const reviewName = 'بررسی و تأیید تخصیص';
const reference = 'QA-459 allocation rehearsal';

test.skip(!enabled, 'Requires an explicitly authorized protected QA fixture');
test.use({ baseURL: origin, launchOptions: { args: ['--no-proxy-server'] } });

function required(name: string, pattern = /\S/) {
  const value = process.env[name];
  if (!value || !pattern.test(value)) throw new Error(`Set a valid ${name} for the isolated fixture`);
  return value;
}

const exactRequest = (request: Request, path: string, method = 'POST') =>
  request.url() === `${origin}${path}` && request.method() === method;

async function readData<T>(response: Response) {
  expect(response.status()).toBe(200);
  const body = await response.json() as { success: boolean; data: T };
  expect(body.success).toBe(true);
  return body.data;
}

async function openAllocation(page: Page) {
  await page.getByRole('button', { name: 'تخصیص به بدهی', exact: true }).click();
  return page.getByRole('region', { name: 'تخصیص به بدهی‌های مشتری', exact: true });
}

test('real grouped allocation cancels an unposted intent, recovers a committed response after reload and reverses one share', async ({ page, context }) => {
  if (process.env.SABALAN_ALLOCATION_QA_ORIGIN !== origin) throw new Error('Use the private https://erp.qa.test origin');
  const addresses = await lookup('erp.qa.test', { all: true });
  expect(addresses.length).toBeGreaterThan(0);
  for (const { address } of addresses) expect(['127.0.0.1', '::1']).toContain(address);

  const identifier = required('SABALAN_ALLOCATION_QA_USERNAME', /^qa-459-[a-z0-9-]+$/);
  const password = required('SABALAN_ALLOCATION_QA_PASSWORD');
  const marker = required('SABALAN_ALLOCATION_QA_MARKER', /^QA-459-[a-z0-9-]+$/);
  const idPattern = /^[a-zA-Z0-9_-]+$/;
  const profileId = required('SABALAN_ALLOCATION_QA_PROFILE_ID', idPattern);
  const customerId = required('SABALAN_ALLOCATION_QA_CUSTOMER_ID', idPattern);
  const path = `/api/accounting/ledger/customer-accounts/${profileId}`;
  const treasury = `${path}/treasury`;
  const intent = `${treasury}/allocation-intent`;
  const accountPage = `/dashboard/accounting/customer-accounts/${profileId}`;
  const waitFor = (url: string, method = 'POST') => page.waitForResponse(response => exactRequest(response.request(), url, method));
  let phase: 'preflight' | 'cancel' | 'post' | 'reverse' = 'preflight';
  let recordedPost: { id: string; allocationIds: string[] } | undefined;
  let reversedCreditId: string | undefined;
  let expectedShares: object[] = [];
  let forwardedGroups = 0;
  let forwardedReversals = 0;
  const groupCommands: Array<{ idempotencyKey: string }> = [];
  const abortedPostKeys: string[] = [];
  const prepareKeys: string[] = [];
  const allowedWrites = new Set([treasury, intent, `${intent}/cancel`, `${intent}/status`]);

  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const reject = () => route.abort('blockedbyclient');
    if (url.origin !== origin) return reject();
    if (!url.pathname.startsWith('/api/accounting/') || ['GET', 'HEAD'].includes(request.method())) return route.continue();
    if (request.method() !== 'POST' || url.search || !allowedWrites.has(url.pathname) || phase === 'preflight') return reject();
    try {
      const command = request.postDataJSON();
      if (phase === 'reverse') {
        expect(url.pathname).toBe(treasury);
        expect(command).toMatchObject({ kind: 'REVERSE_ALLOCATION', allocationId: reversedCreditId, confirmed: true, reference });
        expect(forwardedReversals).toBe(0);
        forwardedReversals += 1;
        return route.continue();
      }
      expect(command).toMatchObject({ kind: 'ALLOCATION', confirmed: true, reference, sourceAllocations: expectedShares });
      expect(command.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
      if (url.pathname === intent) {
        prepareKeys.push(command.idempotencyKey);
        return route.continue();
      }
      if (url.pathname !== treasury) {
        const canceling = phase === 'cancel' && url.pathname === `${intent}/cancel`;
        const checkingStatus = phase === 'post' && url.pathname === `${intent}/status`;
        expect(canceling || checkingStatus).toBe(true);
        expect(command).toEqual(groupCommands.at(-1));
        return route.continue();
      }

      groupCommands.push(command);
      expect(command.idempotencyKey).toBe(prepareKeys.at(-1));
      if (phase === 'cancel') {
        abortedPostKeys.push(command.idempotencyKey);
        return route.abort('failed');
      }

      expect(forwardedGroups).toBe(0);
      forwardedGroups += 1;
      // Forward the intact original request, then drop only the browser's response.
      const upstream = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
      expect(upstream.status()).toBe(200);
      const body = await upstream.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ id: command.idempotencyKey, allocationIds: [expect.any(String), expect.any(String)] });
      recordedPost = body.data;
      await route.abort('failed');
    } catch (error) {
      await reject();
      throw error;
    }
  });

  await loginThroughBrowser(page, identifier, password, '/dashboard', origin);
  const readAccount = async (reload = false) => {
    const response = waitFor(path, 'GET');
    if (reload) await page.reload();
    else await page.goto(accountPage);
    return readData<CustomerAccount>(await response);
  };

  const before = await readAccount();
  expect(before).toMatchObject({
    displayName: marker, customerId, profile: { id: profileId }, capabilities: { canManageTreasury: true },
    contracts: [], debitOpenRials: '30', standaloneCreditRials: '10', netBalanceRials: '0',
    receipts: [{ componentKind: 'BANK', remainingRials: '20', allocatedRials: '0', allocations: [] }],
    creditAllocations: [], refunds: [],
  });
  expect(before.openItems).toHaveLength(2);
  const debt = before.openItems.find(item => item.kind === 'RECEIVABLE')!;
  const credit = before.openItems.find(item => item.kind === 'CREDIT')!;
  const receipt = before.receipts[0];
  expect(debt).toMatchObject({ remainingRials: '30', originalRials: '30', contractId: null });
  expect(credit).toMatchObject({ remainingRials: '10', originalRials: '10', contractId: null });
  expectedShares = [
    { receiptId: receipt.id, allocations: [{ openItemId: debt.id, amountRials: '20' }] },
    { creditItemId: credit.id, allocations: [{ openItemId: debt.id, amountRials: '10' }] },
  ];

  const submit = async () => {
    const workspace = await openAllocation(page);
    await workspace.getByRole('checkbox', { name: /^بانکی ·/ }).check();
    await workspace.getByRole('checkbox', { name: `بستانکاری · ${credit.invoiceNumber}`, exact: true }).check();
    await workspace.getByRole('checkbox', { name: `انتخاب ${debt.invoiceNumber}`, exact: true }).check();
    await workspace.getByRole('button', { name: 'تکمیل مانده انتخاب‌شده', exact: true }).click();
    await workspace.getByRole('button', { name: 'بررسی تخصیص', exact: true }).click();
    const review = page.getByRole('dialog', { name: reviewName, exact: true });
    await expect(review.getByText('سهم منابع و مانده بدهی‌ها', { exact: true })).toBeVisible();
    await expect(review.getByText('۲ تومان', { exact: true })).toBeVisible();
    await expect(review.getByText('۱ تومان', { exact: true })).toBeVisible();
    const post = review.getByRole('button', { name: 'ثبت قطعی تخصیص', exact: true });
    await expect(post).toBeDisabled();
    await review.getByRole('textbox', { name: 'دلیل / شرح عملیات', exact: true }).fill('آزمون تخصیص گروهی در محیط آزمایشی');
    await review.getByRole('textbox', { name: 'مرجع مستندات', exact: true }).fill(reference);
    await review.getByRole('checkbox', { name: 'مبلغ بدهی‌ها و سهم دقیق منابع را بررسی و تأیید می‌کنم.', exact: true }).check();
    const beforePrepareCount = prepareKeys.length;
    const prepared = waitFor(intent);
    await post.click();
    expect(await readData(await prepared)).toEqual({ status: 'PENDING', idempotencyKey: prepareKeys[beforePrepareCount] });
    await expect(review.getByRole('button', { name: 'تلاش دوباره همان درخواست', exact: true })).toBeEnabled();
    return review;
  };

  await test.step('Cancel a real reservation before its financial request reaches the backend', async () => {
    phase = 'cancel';
    const review = await submit();
    const canceled = waitFor(`${intent}/cancel`);
    await review.getByRole('button', { name: 'لغو درخواست تخصیص', exact: true }).click();
    expect(await readData(await canceled)).toEqual({ status: 'CANCELED' });
    await expect(review).toHaveCount(0);
    const unchanged = await readAccount(true);
    expect(unchanged).toMatchObject({ debitOpenRials: '30', standaloneCreditRials: '10', netBalanceRials: '0',
      receipts: [{ remainingRials: '20', allocations: [] }], creditAllocations: [] });
  });

  await test.step('Lose the committed response and recover the exact command and result after reload', async () => {
    phase = 'post';
    await submit();
    expect(recordedPost).toBeDefined();
    expect(abortedPostKeys).toHaveLength(1);
    expect(recordedPost!.id).not.toBe(abortedPostKeys[0]);
    await readAccount(true);
    const restored = await openAllocation(page);
    await restored.getByRole('button', { name: 'ادامه بررسی درخواست قبلی', exact: true }).click();
    const review = page.getByRole('dialog', { name: reviewName, exact: true });
    await expect(review.getByText(reference, { exact: true })).toBeVisible();
    const status = waitFor(`${intent}/status`);
    const refreshed = waitFor(path, 'GET');
    await review.getByRole('button', { name: 'بررسی وضعیت درخواست', exact: true }).click();
    expect(await readData(await status)).toEqual({ status: 'COMMITTED', result: recordedPost });
    await expect(review).toHaveCount(0);

    const settled = await readData<CustomerAccount>(await refreshed);
    const [receiptAllocationId, creditAllocationId] = recordedPost!.allocationIds;
    expect(receiptAllocationId).not.toBe(creditAllocationId);
    expect(settled).toMatchObject({ debitOpenRials: '0', standaloneCreditRials: '0', netBalanceRials: '0',
      receipts: [{ id: receipt.id, remainingRials: '0', allocatedRials: '20', allocations: [{
        id: receiptAllocationId, reversedAt: null, lines: [{ openItemId: debt.id, amountRials: '20' }],
      }] }],
      creditAllocations: [{
        id: creditAllocationId, creditItemId: credit.id, reversedAt: null, lines: [{ openItemId: debt.id, amountRials: '10' }],
      }],
    });
    expect(forwardedGroups).toBe(1);
    expect(prepareKeys).toEqual([abortedPostKeys[0], recordedPost!.id]);
    reversedCreditId = creditAllocationId;
  });

  await test.step('Reverse only the independent credit share and observe the exact restored balances', async () => {
    phase = 'reverse';
    await page.getByRole('button', { name: 'دریافت‌ها و چک‌ها', exact: true }).click();
    await page.getByRole('button', { name: 'برگشت تخصیص اعتبار', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'برگشت تخصیص', exact: true });
    await review.getByRole('textbox', { name: 'دلیل / شرح عملیات', exact: true }).fill('آزمون برگشت سهم اعتبار در محیط آزمایشی');
    await review.getByRole('textbox', { name: 'مرجع مستندات', exact: true }).fill(reference);
    await review.getByRole('checkbox', { name: 'اطلاعات و اثر مالی را بررسی کردم؛ ثبت قطعی انجام شود.', exact: true }).check();
    const response = waitFor(treasury);
    const refreshed = waitFor(path, 'GET');
    await review.getByRole('button', { name: 'ثبت قطعی', exact: true }).click();
    expect(await readData(await response)).toMatchObject({ reversesId: reversedCreditId, id: expect.any(String) });
    await expect(review).toHaveCount(0);
    const corrected = await readData<CustomerAccount>(await refreshed);
    expect(corrected).toMatchObject({ debitOpenRials: '10', standaloneCreditRials: '10', netBalanceRials: '0',
      receipts: [{ id: receipt.id, remainingRials: '0', allocatedRials: '20',
        allocations: [{ id: recordedPost!.allocationIds[0], reversedAt: null }] }],
      creditAllocations: [{ id: reversedCreditId, reversedAt: expect.any(String), reversalVoucherId: expect.any(String) }],
    });
    expect(corrected.openItems).toHaveLength(2);
    expect(corrected.openItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: debt.id, remainingRials: '10' }),
      expect.objectContaining({ id: credit.id, remainingRials: '10' }),
    ]));
  });
});
