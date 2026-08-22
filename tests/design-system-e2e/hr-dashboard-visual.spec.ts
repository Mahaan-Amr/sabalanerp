import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  assertMinimumTargetSize,
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  assertVisibleFocus,
  setTheme,
} from './support/design-system';

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

const backgroundAlpha = async (page: Page, selector: string) =>
  page.locator(selector).evaluate((element) => {
    const color = getComputedStyle(element).backgroundColor;
    if (color === 'transparent') return 0;
    const channels = color.match(/[\d.]+/g)?.map(Number) || [];
    return channels.length === 4 ? channels[3] : 1;
  });

test('HR sidebar and workspace dismiss layers never become opaque on hover', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await login(page);
  await page.goto('/dashboard/hr');

  await page.getByRole('button', { name: 'بازکردن منوی اصلی' }).click();
  const sidebarBackdrop = '[data-dashboard-overlay]';
  await expect(page.locator(sidebarBackdrop)).toBeVisible();
  expect(await backgroundAlpha(page, sidebarBackdrop)).toBeLessThanOrEqual(0.5);
  await page.locator(sidebarBackdrop).hover();
  expect(await backgroundAlpha(page, sidebarBackdrop)).toBeLessThanOrEqual(0.5);

  const sidebar = page.locator('[data-dashboard-sidebar]');
  await sidebar.locator('button[aria-haspopup="listbox"]').click();
  const workspaceBackdrop = 'button[aria-label="بستن فهرست فضاهای کاری"]';
  await expect(page.locator(workspaceBackdrop)).toBeVisible();
  expect(await backgroundAlpha(page, workspaceBackdrop)).toBe(0);
  await page.mouse.move(20, 450);
  expect(await backgroundAlpha(page, workspaceBackdrop)).toBe(0);
});

test('HR landing preserves real data and produces the approved responsive theme artifacts', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.startsWith('Failed to fetch RSC payload') || text === 'Failed to load resource: the server responded with a status of 404 (Not Found)') return;
    runtimeErrors.push(text);
  });
  page.on('pageerror', (error) => runtimeErrors.push(error.message));

  fs.mkdirSync(screenshotDirectory, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await login(page);
  runtimeErrors.length = 0;
  await page.goto('/dashboard/hr');

  await expect(page.getByRole('heading', { name: 'داشبورد منابع انسانی', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'وظایف و موارد نیازمند پیگیری' })).toBeVisible();
  await expect(page.getByRole('img', { name: /کارهای محول‌شده/ })).toBeVisible();
  await expect(page.getByText('نمای ظرفیت جایگاه‌ها')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /پرسنل ثبت‌شده/ })).toHaveAttribute('href', '/dashboard/hr/personnel');
  await expect(page.getByRole('link', { name: /سرانه فعال/ })).toHaveAttribute('href', '/dashboard/hr/personnel?relationshipStatus=ACTIVE');
  await expect(page.getByRole('link', { name: /ظرفیت متعهد آینده/ })).toHaveAttribute('href', '/dashboard/hr/structure/positions?filter=committed');
  await expect(page.getByRole('link', { name: /ظرفیت خالی/ })).toHaveAttribute('href', '/dashboard/hr/structure/positions?filter=vacant');
  await expect(page.getByRole('link', { name: /ساختار سازمانی/ }).first()).toHaveAttribute('href', '/dashboard/hr/structure');

  await page.goto('/dashboard/hr/structure/positions?filter=vacant');
  await expect(page.getByRole('heading', { name: 'نمای ظرفیت جایگاه‌ها' })).toBeVisible();
  await page.goto('/dashboard/hr/tasks?scope=mine');
  await expect(page.getByRole('heading', { name: 'وظایف منابع انسانی' })).toBeVisible();
  await page.goto('/dashboard/hr');

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
  await mobileNavigation.getByRole('link', { name: 'ساختار' }).click();
  await expect(page).toHaveURL(/\/dashboard\/hr\/structure$/);
  await expect(page.getByRole('navigation', { name: 'ناوبری منابع انسانی' })).toBeVisible();
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

test('limited HR landing is minimal, neumorphic, and shows only effective feature links', async ({ page }, testInfo) => {
  await login(page);
  await page.route('**/api/dashboard/profile', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.role = 'USER';
    body.data.permissions = {
      ...body.data.permissions,
      features: [
        { workspace: 'hr', feature: 'RECRUITMENT_CASES', permissionLevel: 'view' },
        { workspace: 'hr', feature: 'HR_WORK_MANAGEMENT', permissionLevel: 'view' },
        { workspace: 'hr', feature: 'PERSONNEL', permissionLevel: 'view' },
      ],
    };
    await route.fulfill({ response, json: body });
  });

  let dashboardRequests = 0;
  await page.route('**/api/hr/dashboard', async (route) => {
    dashboardRequests += 1;
    await route.continue();
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/hr');

  await expect(page.getByRole('heading', { name: 'فضای کاری منابع انسانی' })).toBeVisible();
  await expect(page.getByText('دسترسی شما به این فضای کاری محدود است')).toHaveCount(0);
  await expect(page.getByText('داشبورد منابع انسانی در مجوزهای شما نیست')).toHaveCount(0);
  const availableSections = page.getByRole('region', { name: 'بخش‌های در دسترس' });
  await expect(availableSections.getByRole('link', { name: /جذب و پرونده‌های متقاضیان/ })).toHaveAttribute('href', '/dashboard/hr/hiring');
  await expect(availableSections.getByRole('link', { name: /وظایف منابع انسانی/ })).toHaveAttribute('href', '/dashboard/hr/tasks');
  await expect(availableSections.getByRole('link', { name: /پرسنل و روابط استخدامی/ })).toHaveAttribute('href', '/dashboard/hr/personnel');
  await expect(availableSections.getByRole('link', { name: /ساختار سازمانی/ })).toHaveCount(0);
  await expect(page.getByText('پرسنل ثبت‌شده')).toHaveCount(0);
  expect(dashboardRequests).toBe(0);

  const cards = availableSections.locator('.sds-neumorphic-card.sds-neumorphic-interactive');
  await expect(cards).toHaveCount(3);
  await assertMinimumTargetSize(cards);
  await assertVisibleFocus(cards.first());
  await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);

  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await page.screenshot({ path: testInfo.outputPath(`limited-desktop-${theme}.png`), fullPage: true });
    expect(await cards.first().evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileSidebar = page.locator('[data-dashboard-sidebar]');
  const closeMobileMenu = mobileSidebar.getByRole('button', { name: 'بستن منوی اصلی' });
  if (await closeMobileMenu.isVisible()) {
    await closeMobileMenu.click({ force: true });
    await expect(mobileSidebar).toHaveClass(/translate-x-full/);
  }
  await assertNoHorizontalOverflow(page);
  await assertMinimumTargetSize(cards);
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await page.locator('main.sds-workspace').screenshot({ path: testInfo.outputPath(`limited-mobile-${theme}.png`) });
  }
});
