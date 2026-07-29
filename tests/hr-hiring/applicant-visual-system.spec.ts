import { expect, test } from '@playwright/test';

test('Applicant personal information adopts the opt-in visual system without changing entry', async ({ page }) => {
  await page.goto('/apply');
  await page.getByLabel('شماره همراه').fill('09120000001');
  await page.getByLabel('کد ورود شش‌رقمی').fill('123456');
  await page.getByRole('button', { name: 'تأیید و ورود' }).click();

  await expect(page.getByRole('heading', { name: 'جایگاه آزمایشی کارشناس حسابداری' })).toBeVisible();
  await expect(page.locator('main.sds-neumorphic-applicant-shell')).toHaveCount(1);
  await expect(
    page.locator('section.sds-neumorphic-applicant-card').filter({
      has: page.getByRole('heading', { name: 'مشخصات فردی', exact: true }),
    }),
  ).toHaveCount(1);
});
