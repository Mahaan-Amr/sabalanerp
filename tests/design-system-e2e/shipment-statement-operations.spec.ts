import { expect, test } from '@playwright/test';
import {
  assertMinimumTargetSize,
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  loginAsAdmin,
  setTheme,
  setViewportAndZoom,
  waitForStableState,
} from './support/design-system';

const state = {
  control: {
    paused: false, incident: false, revision: 7, changedAt: '2026-09-05T07:00:00.000Z', changedBy: 'admin-1',
    reason: 'Fresh release gates were accepted.',
  },
  cutover: {
    enabled: true, cutoverAt: '2026-09-05T06:45:00.000Z', activatedAt: '2026-09-05T06:45:00.000Z', activatedBy: 'release-1',
  },
  environmentEnabled: true,
  effectiveActive: true,
  live: { totalContracts: 258, evaluatedContracts: 258, readinessCounts: { READY: 253, REPAIR_REQUIRED: 5 } },
  events: [],
};

test('Shipment statement control is responsive and protects a pending pause', async ({ page }) => {
  await loginAsAdmin(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let transitionBody: Record<string, unknown> | null = null;
  await page.route('**/api/shipment-statement-operations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: state }) });
  });
  await page.route('**/api/shipment-statement-operations/transitions', async (route) => {
    transitionBody = route.request().postDataJSON();
    await pending;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
  });

  await setViewportAndZoom(page, { width: 390, height: 844 });
  await setTheme(page, 'dark');
  await page.goto('/dashboard/admin/shipment-statements');
  await waitForStableState(page);
  await expect(page.getByText('۲۵۸', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'توقف موقت' }).click();
  const dialog = page.getByRole('dialog', { name: 'توقف موقت برنامه‌ریزی‌شده' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'دلیل' }).fill('توقف کوتاه برای بررسی سلامت جریان');
  await dialog.locator('input[type="password"]').fill('admin123');
  await dialog.getByRole('checkbox').check();
  await assertMinimumTargetSize(dialog.locator('button, input, textarea'));
  await assertNoSeriousAxeViolations(page);

  await dialog.getByRole('button', { name: 'توقف موقت' }).click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.getByRole('button', { name: 'در حال ثبت' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(transitionBody).toMatchObject({ action: 'PAUSE_PLANNED', expectedRevision: 7 });
  release();
  await expect(dialog).toBeHidden();

  await setViewportAndZoom(page, { width: 390, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
});
