import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('the independent replacement audit API uses current authentication and returns the existing audit outcome', async ({ page, request }) => {
  const replacement = '/api/accounting/replacement';
  const unauthenticated = await request.get(`${replacement}/audit-verification?bookId=fixture`);
  expect(unauthenticated.status()).toBe(401);

  await loginAsAdmin(page);
  const context = await page.request.get('/api/accounting/ledger/context');
  expect(context.ok()).toBeTruthy();
  const bookId = (await context.json()).data.books[0]?.id ?? 'replacement-488-uninitialized-book';
  const [legacy, independent, audit, wrongSnapshot] = await Promise.all([
    page.request.get(`${replacement}/overview`, { params: { bookId } }),
    page.request.get(`${replacement}/overview`, { params: { bookId, includeAudit: 'false' } }),
    page.request.get(`${replacement}/audit-verification`, { params: { bookId } }),
    page.request.get(`${replacement}/sepidar-snapshots/missing-488/readiness`, { params: { bookId } }),
  ]);
  expect(legacy.ok()).toBeTruthy();
  expect(independent.ok()).toBeTruthy();
  expect(audit.ok()).toBeTruthy();
  expect(wrongSnapshot.status()).toBe(404);
  const legacyData = (await legacy.json()).data;
  const overviewData = (await independent.json()).data;
  const auditData = (await audit.json()).data;
  expect(overviewData.auditVerification).toBeNull();
  expect(auditData.auditVerification).toEqual(legacyData.auditVerification);
  expect(auditData.exception).toEqual(legacyData.exceptions.find((row: { category: string }) => row.category === 'ممیزی') ?? null);
  expect(Number.isFinite(Date.parse(auditData.verificationTiming.completedAt))).toBeTruthy();
  expect(auditData.verificationTiming.durationMs).toBeGreaterThanOrEqual(0);
});

test('replacement overview and source readiness stay usable while an audit check fails and retries', async ({ page }) => {
  await loginAsAdmin(page);
  const verifiedAt = '2026-11-23T10:00:00.000Z';
  const replacement = '**/api/accounting/replacement';
  const ok = (data: unknown) => ({ json: { success: true, data } });
  await page.route('**/api/accounting/ledger/context', route => route.fulfill(ok({ books: [{ id: 'book-488' }] })));
  await page.route(`${replacement}/overview?**`, route => {
    expect(new URL(route.request().url()).searchParams.get('includeAudit')).toBe('false');
    return route.fulfill(ok({ sepidarLedger: [{ year: '1405', status: 'POSTED', count: 45 }] }));
  });
  await page.route(`${replacement}/sepidar-snapshots?**`, route => route.fulfill(ok([
    { id: 'source-488', status: 'COMPLETE', completedAt: verifiedAt, tables: [] },
  ])));
  await page.route(`${replacement}/sepidar-snapshots/source-488/readiness?**`, route => route.fulfill(ok({
    officialReportsBlocked: true,
    sourceCoverage: { missingEarlyDetail: true },
    inventory1405: { unvaluedUnlinkedDeliveries: 15, negativeStockSummaries: 12 },
    verificationTiming: { completedAt: verifiedAt, durationMs: 832 },
  })));
  await page.route(`${replacement}/parallel-comparisons/context?**`, route => route.fulfill(ok({ periods: [], targets: [] })));
  let releaseAudit!: () => void;
  const firstAudit = new Promise<void>(resolve => { releaseAudit = resolve; });
  let auditStatus = 500;
  await page.route(`${replacement}/audit-verification?**`, async route => {
    await firstAudit;
    if (auditStatus !== 200) return route.fulfill({ status: auditStatus, json: { success: false } });
    return route.fulfill(ok({
      auditVerification: { valid: true, failedSequence: null },
      exception: null,
      verificationTiming: { completedAt: verifiedAt, durationMs: 927 },
    }));
  });

  await page.goto('/dashboard/accounting/replacement');
  const audit = page.getByRole('region', { name: 'بررسی زنجیره ممیزی جایگزینی' });
  const readiness = page.getByRole('region', { name: 'آمادگی منبع سپیدار' });
  try {
    await expect(page.getByRole('heading', { name: 'ثبت عملیاتی اسناد سپیدار' })).toBeVisible();
    await expect(readiness.getByText('گزارش رسمی مسدود است.')).toBeVisible();
    await expect(readiness.getByText(/۸۳۲ میلی‌ثانیه/)).toBeVisible();
    await expect(readiness.locator(`time[datetime="${verifiedAt}"]`)).toBeVisible();
  } finally {
    releaseAudit();
  }

  const auditError = audit.getByRole('alert').filter({ hasText: 'سرویس موقتاً پاسخ‌گو نیست.' });
  await expect(auditError).toBeVisible();
  await expect(auditError).toContainText(/کد پیگیری [a-z0-9-]+ را به پشتیبانی اعلام کنید\./i);
  await expect(readiness.getByText('گزارش رسمی مسدود است.')).toBeVisible();
  auditStatus = 200;
  await audit.getByRole('button', { name: 'بررسی دوباره' }).click();
  await expect(audit.getByText('زنجیره ممیزی معتبر است.')).toBeVisible();
  await expect(audit.getByText(/۹۲۷ میلی‌ثانیه/)).toBeVisible();

  auditStatus = 503;
  await audit.getByRole('button', { name: 'بررسی دوباره' }).click();
  await expect(audit.getByText('نتیجهٔ آخرین بررسی کامل‌شده')).toBeVisible();
  await expect(auditError).toBeVisible();

  auditStatus = 403;
  await audit.getByRole('button', { name: 'بررسی دوباره' }).click();
  await expect(page.getByText('دسترسی به جایگزینی حسابداری تأیید نشد.')).toBeVisible();
  await expect(audit.getByText('زنجیره ممیزی معتبر است.')).toHaveCount(0);
  await expect(readiness.getByText('گزارش رسمی مسدود است.')).toHaveCount(0);
});
