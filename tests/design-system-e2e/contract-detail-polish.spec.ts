import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNoSeriousAxeViolations, loginAsAdmin, setTheme, setViewportAndZoom } from './support/design-system';

// Read-only acceptance against the local contract used to approve the design.
const contractId = process.env.CONTRACT_DETAIL_QA_ID || 'cmtzjrcoo006euxbvpwmqt8c4';

test('local contract detail preserves output choices, mounted seller selection and RTL across tabs', async ({ page }, info) => {
  await loginAsAdmin(page);
  await page.goto(`/dashboard/sales/contracts/${contractId}`);
  await expect(page.getByRole('heading', { name: 'مشخصات قرارداد', exact: true })).toBeVisible();
  await setViewportAndZoom(page, { width: 1600, height: 1200 });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('main.sds-workspace h1')).toContainText('قرارداد');
  const printVersion = page.getByRole('combobox', { name: 'نسخه چاپ', exact: true });
  await printVersion.selectOption('summary');
  await expect(printVersion).toHaveValue('summary');
  await expect(page.getByRole('button', { name: 'دانلود PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'پرینت', exact: true })).toBeVisible();
  await printVersion.selectOption('original');

  const disclosure = page.getByRole('button', { name: /تغییر مسئول فروش قرارداد/ });
  const seller = page.getByRole('combobox', { name: 'مسئول فروش جدید', exact: true });
  await expect(seller).toBeHidden();
  await disclosure.click();
  await expect(seller).toBeVisible();
  const option = await seller.locator('option').evaluateAll(options => options.map(option => option.value).find(Boolean));
  expect(option).toBeTruthy();
  await seller.selectOption(option!);
  await disclosure.click();
  await expect(seller).toBeHidden();
  await disclosure.click();
  await expect(seller).toHaveValue(option!);
  await seller.selectOption('');
  await disclosure.click();
  await expect(page.getByRole('button', { name: 'ثبت مسئول فروش', exact: true })).toBeHidden();

  for (const [tab, heading] of [['اقلام و تحویل', 'اقلام قرارداد'], ['وضعیت مالی', 'وضعیت حسابداری'], ['سوابق', 'تاریخچه']] as const) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(printVersion).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'دانلود PDF', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'خلاصه', exact: true }).click();
  await expect(printVersion).toHaveValue('original');
  await expect(page.getByText('مهلت ثبت اولین رکورد مالی', { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [400, 600, 700].every(weight => document.fonts.check(`${weight} 14px "Yekan Bakh"`, 'قرارداد فروش')))).toBe(true);

  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await page.evaluate(() => scrollTo(0, 0));
    await page.mouse.move(0, 0);
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
    await page.screenshot({ path: info.outputPath(`contract-detail-${theme}.png`), fullPage: true });
  }
  await setViewportAndZoom(page, { width: 390, height: 1000 });
  await setTheme(page, 'dark');
  await assertNoHorizontalOverflow(page);
  await disclosure.scrollIntoViewIfNeeded();
  await disclosure.click();
  await expect(seller).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await disclosure.click();
  await assertNoSeriousAxeViolations(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('contract-detail-mobile.png'), fullPage: true });
  await setViewportAndZoom(page, { width: 1280, height: 1000 }, 2);
  await assertNoHorizontalOverflow(page);
});
