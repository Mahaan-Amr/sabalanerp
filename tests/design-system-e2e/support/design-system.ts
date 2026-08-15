import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export const loginAsAdmin = async (page: Page) => {
  const username = process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin';
  const password = process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123';
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
};

export const isolatedTestNamespace = (testInfo: TestInfo) => [
  process.env.GITHUB_RUN_ID || 'local',
  testInfo.project.name,
  testInfo.workerIndex,
  testInfo.retry,
  testInfo.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 48)
].join('-');

export const waitForStableState = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
};

export const setTheme = async (page: Page, theme: 'light' | 'dark') => {
  await page.evaluate((nextTheme) => {
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
  }, theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
};

export const setViewportAndZoom = async (page: Page, viewport: { width: number; height: number }, zoom = 1) => {
  await page.setViewportSize(viewport);
  await page.evaluate((nextZoom) => {
    document.documentElement.style.zoom = nextZoom === 1 ? '' : String(nextZoom);
  }, zoom);
};

export const assertNoSeriousAxeViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    ({ impact }) => impact === 'critical' || impact === 'serious'
  );
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
};

export const assertMinimumTargetSize = async (locator: Locator, minimum = 44) => {
  const undersized = await locator.evaluateAll((elements, size) => elements
    .filter((element) => {
      const target = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
        ? element.closest('label') || element
        : element;
      const rectangle = target.getBoundingClientRect();
      return rectangle.width > 0 && rectangle.height > 0
        && (rectangle.width < size || rectangle.height < size);
    })
    .map((element) => {
      const target = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
        ? element.closest('label') || element
        : element;
      return ({
      tag: element.tagName,
      name: element.getAttribute('aria-label') || target.textContent?.trim().slice(0, 80),
      width: target.getBoundingClientRect().width,
      height: target.getBoundingClientRect().height
    });
    }), minimum);
  expect(undersized).toEqual([]);
};

export const assertNoHorizontalOverflow = async (page: Page) => {
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ))).toBe(true);
};

export const assertVisibleFocus = async (locator: Locator) => {
  await locator.focus();
  await expect(locator).toBeFocused();
  const focus = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow
    };
  });
  expect(
    (focus.outlineStyle !== 'none' && focus.outlineWidth > 0)
      || (focus.boxShadow && focus.boxShadow !== 'none')
  ).toBe(true);
};

export const assertSemanticSurfaceVisuals = async (locator: Locator) => {
  const visual = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundIsVisible: style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent',
      borderIsVisible: style.borderStyle !== 'none' && Number.parseFloat(style.borderWidth) > 0,
      radius: Number.parseFloat(style.borderRadius),
      textIsVisible: style.color !== 'rgba(0, 0, 0, 0)' && style.color !== 'transparent',
    };
  });
  expect(visual).toEqual({
    backgroundIsVisible: true,
    borderIsVisible: true,
    radius: expect.any(Number),
    textIsVisible: true,
  });
  expect(visual.radius).toBeGreaterThanOrEqual(16);
};

export const deterministicScreenshotMasks = (page: Page) => [
  page.locator('[data-dynamic], time, [data-testid*="timestamp"], [data-testid*="clock"]')
];
