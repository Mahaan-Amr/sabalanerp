import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

for (const result of ['acknowledged', 'recovered', 'resumed', 'reloaded'] as const) {
  test(`loading confirms a command that is ${result} before refreshing its group`, async ({ page }) => {
    await loginAsAdmin(page);
    const reads: (string | null)[] = [];
    const posts: string[] = [];
    const receiptReads: string[] = [];
    let failRefresh = true;
    let committed = false;
    let canReadReceipt = result !== 'reloaded';
    let releaseRefresh!: () => void;
    const refreshResponse = new Promise<void>(resolve => { releaseRefresh = resolve; });
    const rows = [
      { id: 'a', loadingId: 'group-a', driver: 'راننده الف' },
      { id: 'b', loadingId: 'group-a', driver: 'راننده ب' },
      { id: 'c', loadingId: 'group-b', driver: 'راننده ج' },
    ];
    const issued = { status: 'ISSUED', invoice: { id: 'invoice-42', number: '42' } };
    await page.route('**/api/accounting/dispatch-candidates**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/document-read-model')) {
        return route.fulfill({ json: { success: true, data: { id: 'a', status: 'PENDING', allocationRevision: {} } } });
      }
      const group = url.searchParams.get('loadingId');
      reads.push(group);
      if (group && failRefresh) {
        await refreshResponse;
        return route.fulfill({ status: 503, json: { success: false } });
      }
      return route.fulfill({ json: { success: true, capabilities: {
        canManageAccountingCandidates: true, canManageAccountingConfirmation: false,
      }, data: rows.filter(row => !group || row.loadingId === group).map(row => ({
        id: row.id, loadingId: row.loadingId, status: group ? 'ACCEPTED' : 'PENDING',
        summary: { driverName: row.driver, loadingNumber: row.loadingId }, canManage: true, waybills: [],
      })) } });
    });
    await page.route('**/api/accounting/loadings/group-a/sales-invoices', route => route.fulfill({
      json: { success: true, data: { ready: committed, documentsComplete: committed,
        invoices: committed ? [{ ...issued.invoice, status: 'ISSUED' }] : [] } },
    }));
    await page.route('**/api/accounting/loadings/group-a/issue-dispatch-documents', route => {
      const { commandId } = route.request().postDataJSON();
      posts.push(commandId);
      committed = result !== 'resumed' || posts.length > 1;
      return result !== 'acknowledged' && posts.length === 1
        ? route.abort() : route.fulfill({ json: { success: true, data: { ...issued, commandId } } });
    });
    await page.route('**/api/accounting/loadings/group-a/issue-dispatch-documents/*', route => {
      const commandId = new URL(route.request().url()).pathname.split('/').at(-1)!;
      receiptReads.push(commandId);
      if (!canReadReceipt) return route.fulfill({ status: 503, json: { success: false } });
      if (!committed) {
        return route.fulfill({ status: 404, json: { success: false, code: 'LOADING_ISSUE_RECEIPT_MISSING' } });
      }
      return route.fulfill({ json: { success: true, data: { ...issued, commandId } } });
    });

    await page.goto('/dashboard/accounting/dispatch');
    const openLoading = () => page.getByRole('row').filter({ hasText: 'راننده الف' })
      .getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری' }).click();
    await openLoading();
    const dialog = page.getByRole('dialog');
    const issue = dialog.getByRole('button', { name: 'صدور بارنامه‌ها و فاکتور فروش', exact: true });
    await issue.dblclick({ timeout: 5_000 });
    if (result === 'resumed') {
      await expect(dialog.getByText('نتیجهٔ فرمان صدور هنوز مشخص نیست.')).toBeVisible();
      expect(posts).toHaveLength(1);
      await dialog.getByRole('button', { name: 'ادامهٔ همان فرمان صدور' }).click();
    }
    if (result === 'reloaded') {
      await expect(dialog.getByText('نتیجهٔ فرمان صدور هنوز مشخص نیست.')).toBeVisible();
      await page.reload();
      canReadReceipt = true;
      await openLoading();
      await dialog.getByRole('button', { name: 'بررسی دوبارهٔ رسید صدور' }).click();
    }
    await expect(dialog.getByText('بارنامه‌ها و فاکتور فروش صادر شدند.')).toBeVisible();
    await expect(dialog.getByText('بارنامه‌ها و فاکتور فروش صادر شدند.')).toContainText('42');
    expect(posts).toHaveLength(result === 'resumed' ? 2 : 1);
    expect(posts[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(posts).size).toBe(1);
    expect(receiptReads).toEqual(result === 'acknowledged' ? [] : result === 'reloaded' ? [posts[0], posts[0]] : [posts[0]]);
    releaseRefresh();
    const retry = dialog.getByRole('button', { name: 'تلاش دوباره برای خواندن وضعیت بارگیری' });
    await expect(retry).toBeVisible();
    await expect(issue).toBeDisabled();
    failRefresh = false;
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(reads).toEqual(result === 'reloaded' ? [null, null, 'group-a', 'group-a'] : [null, 'group-a', 'group-a']);
    expect(posts).toHaveLength(result === 'resumed' ? 2 : 1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('row').filter({ hasText: 'راننده ب' })).toContainText('پذیرفته‌شده');
    await expect(page.getByRole('row').filter({ hasText: 'راننده ج' })).toContainText('در انتظار بررسی');
  });
}
