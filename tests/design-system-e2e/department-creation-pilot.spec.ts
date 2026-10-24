import { expect, test } from '@playwright/test';
import {
  assertMinimumTargetSize,
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  assertVisibleFocus,
  deterministicScreenshotMasks,
  loginAsAdmin,
  setTheme,
  setViewportAndZoom
} from './support/design-system';

test('Department Creation is a stable RTL, responsive, themed, and accessible pilot', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/dashboard/departments/create');

  const topbar = page.locator('[data-dashboard-topbar]');
  const welcome = topbar.getByText(/^خوش آمدید/);
  for (const label of ['تأیید ورود همین حساب', 'حفظ پیش‌نویس', 'نسخه‌های محفوظ همین فرم', 'حفظ و تازه‌سازی']) {
    const control = page.getByRole('button', { name: label, exact: true });
    await expect(control).toBeVisible();
    await expect(control).toBeEnabled();
  }
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await assertNoSeriousAxeViolations(page);
  await assertVisibleFocus(page.getByRole('textbox', { name: /نام انگلیسی/ }));
  await assertMinimumTargetSize(page.locator('button, a, input, textarea'));

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await setViewportAndZoom(page, { width: 1280, height: 900 });
    await expect(welcome).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await expect.soft(page).toHaveScreenshot(`department-create-desktop-${theme}.png`, {
      animations: 'disabled', caret: 'hide', mask: [...deterministicScreenshotMasks(page), welcome], fullPage: true, maxDiffPixelRatio: 0.002
    });

    await setViewportAndZoom(page, { width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    // Main's platform alignment (128bb009) moved the compact mobile title
    // below the controls and hid the welcome subtitle; verify that contract.
    await expect(topbar.getByRole('heading', { name: 'داشبورد اصلی', exact: true })).toBeVisible();
    await expect(welcome).toBeHidden();
    await expect(topbar.getByRole('button', { name: 'بازکردن منوی اصلی' })).toBeVisible();
    await expect.soft(page).toHaveScreenshot(`department-create-mobile-${theme}.png`, {
      animations: 'disabled', caret: 'hide', mask: [...deterministicScreenshotMasks(page), welcome], fullPage: true, maxDiffPixelRatio: 0.002
    });
  }

  await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: 'ایجاد دپارتمان' })).toBeVisible();
});

test('canonical feedback overlay labels, traps, restores, unlocks, and closes with Escape', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/departments', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'خطای کنترل‌شده آزمایشی' })
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/dashboard/departments/create');
  await page.getByRole('textbox', { name: /نام انگلیسی/ }).fill('Quality');
  await page.getByRole('textbox', { name: /نام فارسی/ }).fill('کیفیت');
  await page.getByRole('textbox', { name: /توضیحات/ }).fill('کنترل کیفیت');
  const submit = page.getByRole('button', { name: 'ایجاد دپارتمان' });
  await submit.click();

  const dialog = page.getByRole('dialog', { name: 'خطا' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await assertNoSeriousAxeViolations(page);

  const close = dialog.getByRole('button', { name: 'بستن' });
  await expect(close).toBeFocused();
  const dialogButtons = dialog.getByRole('button');
  await dialogButtons.last().focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(submit).toBeDisabled();
  await expect(page.getByRole('textbox', { name: /نام انگلیسی/ })).toBeFocused();
  await expect(page.getByRole('textbox', { name: /نام انگلیسی/ })).toHaveValue('Quality');
  await expect(page.getByRole('textbox', { name: /نام فارسی/ })).toHaveValue('کیفیت');
  await expect(page.getByRole('textbox', { name: /توضیحات/ })).toHaveValue('کنترل کیفیت');
  await expect(page.getByText('نتیجهٔ ثبت مشخص نیست؛ پیش از تکرار، وضعیت ثبت را بررسی کنید. این فرم را نبندید.', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});
