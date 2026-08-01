import { expect, test, type Locator, type Page } from '@playwright/test';

const login = async (page: Page) => {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill('admin');
  await page.locator('input[name="password"]').fill('admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
};

const backgroundAlpha = async (locator: Locator) =>
  locator.evaluate((element) => {
    const color = getComputedStyle(element).backgroundColor;
    if (color === 'transparent') return 0;
    const channels = color.match(/[\d.]+/g)?.map(Number) || [];
    return channels.length === 4 ? channels[3] : 1;
  });

const verticalCenter = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!.y + box!.height / 2;
};

test('dashboard navigation stays contained and aligned across desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto('/dashboard/sales');

  const sidebar = page.locator('[data-dashboard-sidebar]');
  await expect(sidebar).toBeVisible();
  expect(await backgroundAlpha(sidebar)).toBe(0);

  const sidebarSurface = sidebar.locator('[data-dashboard-sidebar-surface]');
  await expect(sidebarSurface).toBeVisible();
  expect(await backgroundAlpha(sidebarSurface)).toBeGreaterThan(0.95);

  await sidebar.getByRole('button', { name: 'بازکردن منو' }).click();
  const contracts = sidebar.getByRole('button', { name: /قراردادها/ });
  await expect(contracts).toBeVisible();

  const contractLabel = contracts.getByText('قراردادها', { exact: true });
  const contractIcons = contracts.locator('svg');
  await expect(contractIcons).toHaveCount(2);
  const rowCenters = await Promise.all([
    verticalCenter(contractIcons.nth(0)),
    verticalCenter(contractLabel),
    verticalCenter(contractIcons.nth(1)),
  ]);
  expect(Math.max(...rowCenters) - Math.min(...rowCenters)).toBeLessThanOrEqual(3);

  await contracts.click();
  const allContracts = sidebar.getByRole('link', { name: /همه قراردادها/ });
  await expect(allContracts).toBeVisible();
  const childCenters = await Promise.all([
    verticalCenter(allContracts.locator('svg').first()),
    verticalCenter(allContracts.getByText('همه قراردادها', { exact: true })),
  ]);
  expect(Math.max(...childCenters) - Math.min(...childCenters)).toBeLessThanOrEqual(3);

  const workspaceNavigation = sidebar.getByRole('navigation', { name: 'ناوبری فضای کاری' });
  const logout = sidebar.getByRole('button', { name: 'خروج' });
  await expect(workspaceNavigation).toBeVisible();
  await expect(logout).toBeVisible();
  const navigationBox = await workspaceNavigation.boundingBox();
  const logoutBox = await logout.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect(logoutBox).not.toBeNull();
  expect(navigationBox!.y + navigationBox!.height).toBeLessThanOrEqual(logoutBox!.y);

  await page.setViewportSize({ width: 390, height: 844 });
  const hamburger = page.getByRole('button', { name: 'بازکردن منوی اصلی' });
  const brand = page.getByRole('img', { name: 'Sabalan ERP' });
  const hamburgerBox = await hamburger.boundingBox();
  const brandBox = await brand.boundingBox();
  expect(hamburgerBox).not.toBeNull();
  expect(brandBox).not.toBeNull();
  expect(hamburgerBox!.x).toBeGreaterThan(brandBox!.x);

  await hamburger.click();
  await expect(sidebar).toBeVisible();
  expect(await backgroundAlpha(sidebar)).toBeGreaterThan(0.95);
  await expect(sidebar.getByRole('button', { name: /فعال‌کردن حالت/ })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'خروج' })).toBeVisible();
});
