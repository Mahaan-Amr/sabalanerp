import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const screenshotDirectory = path.resolve(
  __dirname,
  '../../.scratch/hr-dashboard-design-system/screenshots',
);

const login = async (page: Page) => {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill('admin');
  await page.locator('input[name="password"]').fill('admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
};

test('HR landing preserves real data and produces the approved responsive theme artifacts', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  page.on('pageerror', (error) => runtimeErrors.push(error.message));

  fs.mkdirSync(screenshotDirectory, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await login(page);
  runtimeErrors.length = 0;
  await page.goto('/dashboard/hr');

  await expect(page.getByRole('heading', { name: 'داشبورد منابع انسانی', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'وظایف و موارد نیازمند پیگیری' })).toBeVisible();
  await expect(page.getByRole('img', { name: /پوشش ظرفیت جایگاه‌ها/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /ساختار سازمانی/ }).first()).toHaveAttribute('href', '/dashboard/hr/structure');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: path.join(screenshotDirectory, 'desktop-dark-1920x1080.png') });

  await page.getByRole('button', { name: 'فعال‌کردن حالت روشن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: path.join(screenshotDirectory, 'desktop-light-1920x1080.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'بازکردن منوی اصلی' })).toBeVisible();
  const mobileNavigation = page.getByRole('navigation', { name: 'ناوبری منابع انسانی' });
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.getByRole('link')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(screenshotDirectory, 'mobile-light-390x844.png') });

  await page.getByRole('button', { name: 'بازکردن منوی اصلی' }).click();
  const mobileSidebar = page.locator('[data-dashboard-sidebar]');
  await expect(mobileSidebar).toBeVisible();
  await mobileSidebar.getByRole('button', { name: 'فعال‌کردن حالت تیره' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await mobileSidebar.getByRole('button', { name: 'بستن منوی اصلی' }).click();
  await expect(mobileSidebar).toHaveClass(/translate-x-full/);
  await expect(page.locator('[data-dashboard-overlay]')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(screenshotDirectory, 'mobile-dark-390x844.png') });

  expect(runtimeErrors).toEqual([]);
});
