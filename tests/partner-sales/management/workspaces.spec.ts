import { expect, test } from '@playwright/test';
import { loginAsAdmin, setTheme, assertNoHorizontalOverflow, assertVisibleFocus, assertNoSeriousAxeViolations, waitForStableState } from '../../design-system-e2e/support/design-system';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('HR sees gate-only commercial status; ordinary Manager title grants no management actions', async ({ page }) => {
  await page.goto('/dashboard/sales/partners?fixture=HR');
  await expect(page.getByRole('heading', { name: 'شرایط فعال‌سازی' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'تغییر شرایط تجاری', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تغییر شرایط اعتبار', exact: true })).toHaveCount(0);
  await page.goto('/dashboard/sales/partners?fixture=MANAGER');
  await expect(page.getByText('اقدامی در دسترس نیست.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'فعال‌سازی', exact: true })).toHaveCount(0);
});

test('independent bulk prices survive partial response and a stale row requires fresh selection', async ({ page }) => {
  await page.goto('/dashboard/sales/partner-inquiries?fixture=PARTIAL');
  await page.getByRole('checkbox', { name: 'انتخاب ردیف 1', exact: true }).check();
  await page.getByRole('checkbox', { name: 'انتخاب ردیف 2', exact: true }).check();
  await page.getByRole('textbox', { name: /قیمت هر واحد ردیف 1/ }).fill('120000');
  await page.getByRole('textbox', { name: /قیمت هر واحد ردیف 2/ }).fill('250000');
  const review = page.getByRole('button', { name: 'بررسی پاسخ ردیف‌های انتخاب‌شده', exact: true });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(review).toBeFocused();
  await assertVisibleFocus(review);
  await review.click();
  const dialog = page.getByRole('dialog', { name: 'بررسی پاسخ قیمت' });
  await expect(dialog).toContainText('120000');
  await expect(dialog).toContainText('250000');
  await page.getByRole('button', { name: 'ثبت پاسخ‌ها', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('1 ردیف ثبت شد؛ 1 ردیف نیازمند بررسی است.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /قیمت هر واحد ردیف 2/ })).toHaveValue('250000');
  await expect(page.getByRole('checkbox', { name: 'انتخاب ردیف 2', exact: true })).not.toBeChecked();
});

test('HR identity decision requires a reason and returns focus when cancelled', async ({ page }) => {
  await page.goto('/dashboard/hr/partners?fixture=HR');
  const trigger = page.getByRole('button', { name: 'تأیید هویت', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'تأیید هویت', exact: true });
  await dialog.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
  await expect(dialog.getByText('دلیل تصمیم را به فارسی بنویسید.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('textbox', { name: 'دلیل تصمیم' }).fill('مدرک هویت آزمایشی بررسی شد');
  await dialog.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('تصمیم ثبت شد.', { exact: true })).toBeVisible();
});

test('onboarding gates block activation until each separately projected condition is completed', async ({ page }) => {
  await page.goto('/dashboard/sales/partners?fixture=ADMIN');
  await expect(page.getByRole('button', { name: 'فعال‌سازی', exact: true })).toBeDisabled();
  for (const action of ['تأیید هویت', 'تغییر شرایط تجاری', 'تغییر شرایط اعتبار', 'تعیین پاسخ‌دهنده']) {
    await page.getByRole('button', { name: action, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: action, exact: true });
    if (action !== 'تأیید هویت') await dialog.getByRole('combobox', { name: 'گزینه جدید' }).selectOption({ index: 1 });
    await dialog.getByRole('textbox', { name: 'دلیل تصمیم' }).fill('شرایط همکاری آزمایشی بررسی شد');
    await dialog.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await waitForStableState(page);
  }
  await page.getByRole('button', { name: 'فعال‌سازی', exact: true }).click();
  const activation = page.getByRole('dialog', { name: 'فعال‌سازی', exact: true });
  await activation.getByRole('textbox', { name: 'دلیل تصمیم' }).fill('همه شرایط آزمایشی تکمیل شده است');
  await activation.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
  await expect(page.getByRole('button', { name: 'تعلیق همکاری', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'خاتمه همکاری', exact: true }).click();
  const termination = page.getByRole('dialog', { name: 'خاتمه همکاری', exact: true });
  await expect(termination).toContainText('سوابق و کارهای قطعی حسابداری و تحویل حفظ می‌شوند.');
  await termination.getByRole('textbox', { name: 'دلیل تصمیم' }).fill('همکاری آزمایشی پایان یافت');
  await termination.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
  await expect(page.getByText('خاتمه‌یافته', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'شرایط فعال‌سازی', exact: true })).toBeVisible();
});

test('CRM transfer decision uses masked match evidence and an explicit reason', async ({ page }) => {
  await page.goto('/dashboard/sales/partners?fixture=CRM');
  await expect(page.getByText('****1234', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تغییر شرایط اعتبار', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'تأیید انتقال', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'تصمیم انتقال مشتری', exact: true });
  await expect(dialog).toContainText('تاریخچه، مسئولیت پروژه و اعتبار فروش تغییر نمی‌کند.');
  await dialog.getByRole('textbox', { name: 'دلیل تصمیم' }).fill('نشانه تطبیق آزمایشی بررسی شد');
  await dialog.getByRole('button', { name: 'تأیید و ثبت', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('اقدامی در دسترس نیست.', { exact: true })).toBeVisible();
});

test('lost acknowledgement protects the review and retries the exact response', async ({ page }) => {
  await page.goto('/dashboard/sales/partner-inquiries?fixture=UNCERTAIN');
  await page.getByRole('checkbox', { name: 'انتخاب ردیف 1', exact: true }).check();
  await page.getByRole('textbox', { name: /قیمت هر واحد ردیف 1/ }).fill('120000');
  await page.getByRole('button', { name: 'بررسی پاسخ ردیف‌های انتخاب‌شده', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'بررسی پاسخ قیمت' });
  await dialog.getByRole('button', { name: 'ثبت پاسخ‌ها', exact: true }).click();
  const retry = dialog.getByRole('button', { name: 'بررسی همان درخواست', exact: true });
  await expect(retry).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'ثبت پاسخ‌ها', exact: true })).toBeDisabled();
  await retry.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('1 ردیف ثبت شد؛ 0 ردیف نیازمند بررسی است.', { exact: true })).toBeVisible();
});

test('denied post-command refresh releases the editor lock and permits recovery', async ({ page }) => {
  await page.goto('/dashboard/sales/partner-inquiries?fixture=REFRESH_DENIED');
  await page.getByRole('checkbox', { name: 'انتخاب ردیف 1', exact: true }).check();
  await page.getByRole('textbox', { name: /قیمت هر واحد ردیف 1/ }).fill('120000');
  await page.getByRole('button', { name: 'بررسی پاسخ ردیف‌های انتخاب‌شده', exact: true }).click();
  await page.getByRole('button', { name: 'ثبت پاسخ‌ها', exact: true }).click();
  const recovery = page.getByRole('button', { name: 'دریافت وضعیت تازه', exact: true });
  await expect(recovery).toBeEnabled();
  await recovery.click();
  await expect(page.getByRole('heading', { name: 'همکار آزمایشی آریا', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'انتخاب ردیف 1', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'انتخاب ردیف 2', exact: true })).toBeEnabled();
});

test('switching between assigned inquiries preserves each unfinished response', async ({ page }) => {
  await page.goto('/dashboard/sales/partner-inquiries?fixture=MULTIPLE');
  await page.getByRole('textbox', { name: /قیمت هر واحد ردیف 1/ }).fill('120000');
  await page.getByRole('textbox', { name: /یادداشت ردیف 1/ }).fill('یادداشت پاسخ اول');
  await page.getByRole('button', { name: 'همکار آزمایشی سپید', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /قیمت هر واحد ردیف 1/ })).toHaveValue('');
  await page.getByRole('textbox', { name: /قیمت هر واحد ردیف 1/ }).fill('99000');
  await page.getByRole('button', { name: 'همکار آزمایشی آریا', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /قیمت هر واحد ردیف 1/ })).toHaveValue('120000');
  await expect(page.getByRole('textbox', { name: /یادداشت ردیف 1/ })).toHaveValue('یادداشت پاسخ اول');
  await page.getByRole('button', { name: 'همکار آزمایشی سپید', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /قیمت هر واحد ردیف 1/ })).toHaveValue('99000');
});

for (const [scenario, message] of [['PAUSED', 'عملیات موقتاً متوقف شده است.'], ['REASSIGNED', 'پاسخ این استعلام به شما واگذار نشده است.']] as const) {
  test(`${scenario} defeats a stale response and refresh removes mutation controls`, async ({ page }) => {
    await page.goto(`/dashboard/sales/partner-inquiries?fixture=${scenario}`);
    await page.getByRole('checkbox', { name: 'انتخاب ردیف 1', exact: true }).check();
    await page.getByRole('textbox', { name: /قیمت هر واحد ردیف 1/ }).fill('120000');
    await page.getByRole('button', { name: 'بررسی پاسخ ردیف‌های انتخاب‌شده', exact: true }).click();
    await page.getByRole('button', { name: 'ثبت پاسخ‌ها', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(message, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'انتخاب ردیف 1', exact: true })).toHaveCount(0);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`management and responder remain usable at 390px and 200% (${theme})`, async ({ page }, testInfo) => {
    for (const route of ['partners?fixture=ADMIN', 'partner-inquiries?fixture=RESPONDER']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/dashboard/sales/${route}`);
      await expect(page.getByText('داده آزمایشی؛ هیچ اقدام واقعی ثبت نمی‌شود.', { exact: true })).toBeVisible();
      await waitForStableState(page);
      await setTheme(page, theme);
      await assertNoSeriousAxeViolations(page);
      await assertNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`${route.split('?')[0]}-${theme}-390.png`), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
      await assertNoHorizontalOverflow(page);
      await page.getByRole('button', { name: route.startsWith('partners?') ? 'تازه‌سازی' : 'تازه‌سازی صف', exact: true }).click();
      await waitForStableState(page);
      await page.screenshot({ path: testInfo.outputPath(`${route.split('?')[0]}-${theme}-200percent.png`), fullPage: true });
    }
  });
}
