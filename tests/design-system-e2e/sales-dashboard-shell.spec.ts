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

const contrastAgainst = async (locator: Locator, backgroundSelector: string) =>
  locator.evaluate((element, selector) => {
    const parseColor = (color: string) => {
      const values = color.match(/[\d.]+/g)?.map(Number) || [];
      if (color.startsWith('color(srgb')) {
        return {
          channels: values.slice(0, 3).map((value) => value * 255),
          alpha: values[3] ?? 1,
        };
      }
      return { channels: values.slice(0, 3), alpha: values[3] ?? 1 };
    };
    const composite = (
      foreground: { channels: number[]; alpha: number },
      background: { channels: number[]; alpha: number },
    ) => {
      const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
      return {
        channels: foreground.channels.map(
          (channel, index) =>
            (channel * foreground.alpha +
              background.channels[index] * background.alpha * (1 - foreground.alpha)) /
            alpha,
        ),
        alpha,
      };
    };
    const renderedBackground = (target: Element) => {
      const layers: Element[] = [];
      for (let current: Element | null = target; current; current = current.parentElement) {
        layers.push(current);
      }
      return layers.reverse().reduce(
        (background, layer) =>
          composite(parseColor(getComputedStyle(layer).backgroundColor), background),
        { channels: [255, 255, 255], alpha: 1 },
      ).channels;
    };
    const luminance = (channels: number[]) => {
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.03928
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const background = element.closest(selector);
    if (!background) throw new Error(`Missing contrast background: ${selector}`);
    const foregroundLuminance = luminance(parseColor(getComputedStyle(element).color).channels);
    const backgroundLuminance = luminance(renderedBackground(background));
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }, backgroundSelector);

test('dashboard navigation stays contained and aligned across desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto('/dashboard/sales');

  const sidebar = page.locator('[data-dashboard-sidebar]');
  const topbar = page.locator('[data-dashboard-topbar]');
  await expect(sidebar).toBeVisible();
  const topbarBox = await topbar.boundingBox();
  const desktopSidebarBox = await sidebar.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(desktopSidebarBox).not.toBeNull();
  expect(topbarBox!.x).toBe(0);
  expect(topbarBox!.width).toBe(1440);
  expect(desktopSidebarBox!.y).toBe(topbarBox!.y + topbarBox!.height + 8);
  expect(await backgroundAlpha(sidebar)).toBeLessThanOrEqual(0.05);
  const desktopRail = sidebar.locator('.sds-dashboard-rail');
  expect(await backgroundAlpha(desktopRail)).toBeLessThanOrEqual(0.05);
  const railSections = sidebar.locator('.sds-dashboard-rail > [data-sidebar-section]');
  expect(await railSections.count()).toBeGreaterThanOrEqual(3);
  expect(await railSections.evaluateAll((sections) => {
    const rail = sections[0]?.parentElement;
    if (!rail) return false;
    const railColor = getComputedStyle(rail).backgroundColor;
    return sections.every((section) => {
      const color = getComputedStyle(section).backgroundColor;
      return color === 'rgba(0, 0, 0, 0)' || color === 'transparent' || color === railColor;
    });
  })).toBe(true);
  const desktopShellDecoration = await sidebar.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderLeftWidth: style.borderLeftWidth, boxShadow: style.boxShadow };
  });
  expect(desktopShellDecoration.borderLeftWidth).toBe('0px');
  expect(desktopShellDecoration.boxShadow).toBe('none');
  await expect(sidebar.locator('[data-dashboard-sidebar-surface]')).toHaveCount(0);

  const collapsedSidebarBox = await sidebar.boundingBox();
  expect(collapsedSidebarBox).not.toBeNull();
  expect(collapsedSidebarBox!.width).toBe(80);

  const collapsedTheme = sidebar.getByRole('button', { name: /فعال‌کردن حالت/ });
  const collapsedLogout = sidebar.getByRole('button', { name: 'خروج' });
  const collapsedThemeBox = await collapsedTheme.boundingBox();
  const collapsedLogoutBox = await collapsedLogout.boundingBox();
  expect(collapsedThemeBox).not.toBeNull();
  expect(collapsedLogoutBox).not.toBeNull();
  expect(collapsedThemeBox!.width).toBe(collapsedLogoutBox!.width);
  expect(collapsedThemeBox!.height).toBe(collapsedLogoutBox!.height);
  const activeCollapsedItem = sidebar.locator('a[aria-current="page"]').first();
  const activeCollapsedItemBox = await activeCollapsedItem.boundingBox();
  const activeCollapsedIconBox = await activeCollapsedItem.locator('.sds-dashboard-nav-icon').boundingBox();
  expect(activeCollapsedItemBox).not.toBeNull();
  expect(activeCollapsedIconBox).not.toBeNull();
  expect(Math.abs(
    activeCollapsedItemBox!.x + activeCollapsedItemBox!.width / 2 -
      (activeCollapsedIconBox!.x + activeCollapsedIconBox!.width / 2),
  )).toBeLessThanOrEqual(1);
  const collapsedRows = sidebar.getByRole('navigation', { name: 'ناوبری فضای کاری' }).locator(':scope > div > div');
  expect(await collapsedRows.evaluateAll((rows) => rows.every((row) => {
    const icon = row.querySelector<HTMLElement>('.sds-dashboard-nav-icon');
    if (!icon) return true;
    const rowBox = row.getBoundingClientRect();
    const iconBox = icon.getBoundingClientRect();
    return Math.abs(
      rowBox.left + rowBox.width / 2 - (iconBox.left + iconBox.width / 2),
    ) <= 1;
  }))).toBe(true);

  await sidebar.getByRole('button', { name: 'بازکردن منو' }).click();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(256);
  expect(await backgroundAlpha(desktopRail)).toBeGreaterThan(0.95);
  const expandedThemeBox = await sidebar.getByRole('button', { name: /فعال‌کردن حالت/ }).boundingBox();
  const expandedLogoutBox = await sidebar.getByRole('button', { name: 'خروج' }).boundingBox();
  expect(expandedThemeBox).not.toBeNull();
  expect(expandedLogoutBox).not.toBeNull();
  expect(Math.abs(
    expandedThemeBox!.y + expandedThemeBox!.height / 2 -
      (expandedLogoutBox!.y + expandedLogoutBox!.height / 2),
  )).toBeLessThanOrEqual(1);

  const workspaceTrigger = sidebar.locator('button[aria-haspopup="listbox"]');
  const triggerLabel = workspaceTrigger.getByText('فروش', { exact: true });
  const triggerIcons = workspaceTrigger.locator('svg');
  await expect(triggerIcons).toHaveCount(2);
  const triggerCenters = await Promise.all([
    verticalCenter(triggerIcons.nth(0)),
    verticalCenter(triggerLabel),
    verticalCenter(triggerIcons.nth(1)),
  ]);
  expect(Math.max(...triggerCenters) - Math.min(...triggerCenters)).toBeLessThanOrEqual(2);
  const triggerLabelBox = await triggerLabel.boundingBox();
  const triggerChevronBox = await triggerIcons.nth(1).boundingBox();
  expect(triggerLabelBox).not.toBeNull();
  expect(triggerChevronBox).not.toBeNull();
  expect(triggerChevronBox!.x).toBeLessThan(triggerLabelBox!.x);
  await workspaceTrigger.click();
  const workspaceChoice = sidebar.getByRole('listbox', { name: 'فضای کاری' }).getByRole('button').first();
  const choiceCenters = await Promise.all([
    verticalCenter(workspaceChoice.locator('svg')),
    verticalCenter(workspaceChoice.locator('strong')),
  ]);
  expect(Math.max(...choiceCenters) - Math.min(...choiceCenters)).toBeLessThanOrEqual(2);
  await sidebar.getByRole('button', { name: 'بستن فهرست فضاهای کاری' }).click({ position: { x: 2, y: 2 } });
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
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const salesDashboard = sidebar.getByRole('link', { name: 'داشبورد فروش', exact: true });
  await salesDashboard.hover();
  expect(await contrastAgainst(salesDashboard, '.sds-dashboard-rail')).toBeGreaterThanOrEqual(4.5);

  const workspaceNavigation = sidebar.getByRole('navigation', { name: 'ناوبری فضای کاری' });
  const logout = sidebar.getByRole('button', { name: 'خروج' });
  await expect(workspaceNavigation).toBeVisible();
  await expect(logout).toBeVisible();
  const navigationBox = await workspaceNavigation.boundingBox();
  const logoutBox = await logout.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect(logoutBox).not.toBeNull();
  expect(navigationBox!.y + navigationBox!.height).toBeLessThanOrEqual(logoutBox!.y);

  await sidebar.getByRole('button', { name: 'فعال‌کردن حالت روشن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await backgroundAlpha(sidebar)).toBeLessThanOrEqual(0.05);
  await expect(workspaceNavigation).toBeVisible();
  await expect(logout).toBeVisible();

  await sidebar.getByRole('button', { name: 'جمع‌کردن منو' }).click();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(80);
  expect(await backgroundAlpha(sidebar)).toBeLessThanOrEqual(0.05);
  await expect(sidebar.getByRole('button', { name: 'خروج' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const hamburger = topbar.locator('button[aria-label="بازکردن منوی اصلی"]');
  const brand = topbar.getByRole('img', { name: 'Sabalan ERP' });
  await expect.poll(async () => {
    const hamburgerBox = await hamburger.boundingBox();
    const brandBox = await brand.boundingBox();
    expect(hamburgerBox).not.toBeNull();
    expect(brandBox).not.toBeNull();
    return hamburgerBox!.x - brandBox!.x;
  }).toBeGreaterThan(0);

  await hamburger.click();
  await expect(sidebar).toBeVisible();
  const mobileTopbarBox = await topbar.boundingBox();
  const mobileSidebarBox = await sidebar.boundingBox();
  expect(mobileTopbarBox).not.toBeNull();
  expect(mobileSidebarBox).not.toBeNull();
  expect(mobileSidebarBox!.y).toBe(mobileTopbarBox!.y + mobileTopbarBox!.height + 8);
  expect(await backgroundAlpha(sidebar)).toBeGreaterThan(0.95);
  await expect(sidebar.getByRole('button', { name: /فعال‌کردن حالت/ })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'خروج' })).toBeVisible();
  const mobileNavigationBox = await sidebar.getByRole('navigation', { name: 'ناوبری فضای کاری' }).boundingBox();
  const mobileLogoutBox = await sidebar.getByRole('button', { name: 'خروج' }).boundingBox();
  expect(mobileNavigationBox).not.toBeNull();
  expect(mobileLogoutBox).not.toBeNull();
  expect(mobileNavigationBox!.y + mobileNavigationBox!.height).toBeLessThanOrEqual(mobileLogoutBox!.y);
  await sidebar.getByRole('button', { name: 'خروج' }).scrollIntoViewIfNeeded();
  const scrolledMobileLogoutBox = await sidebar.getByRole('button', { name: 'خروج' }).boundingBox();
  expect(scrolledMobileLogoutBox).not.toBeNull();
  expect(scrolledMobileLogoutBox!.y + scrolledMobileLogoutBox!.height).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerHeight),
  );

  await sidebar.getByRole('button', { name: 'فعال‌کردن حالت تیره' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await backgroundAlpha(sidebar)).toBeGreaterThan(0.95);
  await expect(sidebar.getByRole('button', { name: 'خروج' })).toBeVisible();
});

test('Sales landing keeps its destinations in a neutral neumorphic workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto('/dashboard/sales');

  const main = page.locator('[data-dashboard-main]');
  await expect(main.getByRole('heading', { name: 'داشبورد فروش', exact: true })).toBeVisible();
  const workspaceTitle = page.locator('[data-dashboard-topbar] h1');
  expect(await contrastAgainst(workspaceTitle, '[data-dashboard-topbar]')).toBeGreaterThanOrEqual(4.5);

  await page.getByRole('button', { name: 'فعال‌کردن حالت روشن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await contrastAgainst(workspaceTitle, '[data-dashboard-topbar]')).toBeGreaterThanOrEqual(4.5);

  const destinations = [
    ['مشاهده قراردادها', '/dashboard/sales/contracts'],
    ['ایجاد قرارداد جدید', '/dashboard/sales/contracts/create'],
    ['ایجاد مشتری', '/dashboard/crm/customers/create'],
    ['ایجاد محصول', '/dashboard/sales/products/create'],
    ['گزارش فروش', '/dashboard/sales/reports'],
    ['ثبت حسابداری فروشندگان', '/dashboard/sales/reports?view=accounting-registered&period=month'],
  ] as const;

  for (const [name, href] of destinations) {
    await expect(main.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', href);
  }

  const cards = main.locator('.sds-neumorphic-card');
  await expect(cards).toHaveCount(destinations.length);
  const cardPresentation = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, shadow: style.boxShadow };
    }),
  );
  expect(new Set(cardPresentation.map(({ background }) => background)).size).toBe(1);
  expect(cardPresentation.every(({ shadow }) => shadow !== 'none')).toBe(true);
  for (const badge of ['عملیات روزانه', 'پرکاربرد', 'CRM', 'کاتالوگ', 'تحلیل']) {
    await expect(main.getByText(badge, { exact: true })).toHaveCount(0);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const mobileNavigation = page.getByRole('navigation', { name: 'ناوبری فروش' });
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.getByRole('link')).toHaveCount(5);
  await expect(mobileNavigation.getByRole('link', { name: 'داشبورد' })).toHaveAttribute('aria-current', 'page');
  await expect(mobileNavigation.getByRole('link', { name: 'قراردادها' })).toHaveAttribute('href', '/dashboard/sales/contracts');
  await expect(mobileNavigation.getByRole('link', { name: 'مشتریان' })).toHaveAttribute('href', '/dashboard/crm/customers?workspace=sales');
  await expect(mobileNavigation.getByRole('link', { name: 'محصولات' })).toHaveAttribute('href', '/dashboard/sales/products');
  await expect(mobileNavigation.getByRole('link', { name: 'گزارش‌ها' })).toHaveAttribute('href', '/dashboard/sales/reports');

  const finalCard = cards.last();
  await finalCard.scrollIntoViewIfNeeded();
  const finalCardBox = await finalCard.boundingBox();
  const bottomNavigationBox = await mobileNavigation.boundingBox();
  expect(finalCardBox).not.toBeNull();
  expect(bottomNavigationBox).not.toBeNull();
  expect(finalCardBox!.y + finalCardBox!.height).toBeLessThanOrEqual(bottomNavigationBox!.y);

  await page.locator('[data-dashboard-topbar]').getByRole('button', { name: 'بازکردن منوی اصلی' }).click();
  const mobileSidebar = page.locator('[data-dashboard-sidebar]');
  await mobileSidebar.getByRole('button', { name: 'فعال‌کردن حالت تیره' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await mobileSidebar.getByRole('button', { name: 'بستن منوی اصلی' }).first().click();
  await expect(finalCard).toBeVisible();
  await expect(mobileNavigation).toBeVisible();
  expect(
    await contrastAgainst(
      cards.filter({ hasText: 'گزارش فروش' }).getByText('گزارش فروش', { exact: true }),
      '.sds-neumorphic-card',
    ),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    await contrastAgainst(
      mobileNavigation.getByRole('link', { name: 'داشبورد' }).locator('span'),
      'a',
    ),
  ).toBeGreaterThanOrEqual(4.5);

  await mobileNavigation.getByRole('link', { name: 'مشتریان' }).click();
  await expect(page).toHaveURL(/\/dashboard\/crm\/customers\?workspace=sales$/);
  await expect(page.getByRole('navigation', { name: 'ناوبری فروش' }).getByRole('link', { name: 'مشتریان' })).toHaveAttribute('aria-current', 'page');

  await page.goto('/dashboard/crm/customers');
  await expect(page.getByRole('navigation', { name: 'ناوبری فروش' })).toHaveCount(0);
  await page.goto('/dashboard/crm/customers?workspace=sales');

  // The customer collection replaces its loading surface after the data request.
  // Wait for that committed view so the navigation link is not replaced between
  // pointer-down and click while React applies the collection result.
  await expect(page.getByText(/^نمایش .* از .* مشتری$/)).toBeVisible();
  await page.getByRole('navigation', { name: 'ناوبری فروش' }).getByRole('link', { name: 'محصولات' }).click();
  await expect(page).toHaveURL(/\/dashboard\/sales\/products$/);
  await expect(page.getByRole('navigation', { name: 'ناوبری فروش' }).getByRole('link', { name: 'محصولات' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.dashboard-shell')).toHaveClass(/sds-neumorphic-scope/);
});
