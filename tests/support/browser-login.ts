import { expect, type Page } from '@playwright/test';

export async function loginThroughBrowser(page: Page, identifier: string, password: string, landingPath = '/dashboard', expectedOrigin?: string) {
  const loginUrl = expectedOrigin ? new URL('/login', expectedOrigin).href : '/login';
  await page.goto(loginUrl);
  if (expectedOrigin) await expect(page).toHaveURL(loginUrl);
  const landingUrl = new URL(landingPath, page.url()).href;
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(identifier);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(landingUrl, { timeout: 60_000 });
}
