import { expect, test, type Page } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  loginAsAdmin,
  setViewportAndZoom,
} from './support/design-system';

const distribution = [
  ['URGENT_IMPROVEMENT', 'نیازمند بهبود فوری'],
  ['IMPROVEMENT_NEEDED', 'نیازمند بهبود'],
  ['MEETS_EXPECTATIONS', 'مطابق انتظار'],
  ['EXCEEDS_EXPECTATIONS', 'فراتر از انتظار'],
  ['OUTSTANDING', 'عملکرد برجسته'],
].map(([levelCode, labelFa]) => ({ levelCode, labelFa, count: 2, percent: 20 }));

const mockInsightsApi = async (page: Page, capabilities: Record<string, boolean>) => {
  await page.route('**/api/hr/personnel-performance/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const body = pathname.endsWith('/capabilities')
      ? { success: true, capabilities }
      : pathname.endsWith('/badge/me')
        ? { success: true, badge: { state: 'LEVEL', levelCode: 'MEETS_EXPECTATIONS', labelFa: 'مطابق انتظار', meaningFa: 'عملکرد مصوب با انتظارهای نقش هم‌خوان است.', version: 1 } }
        : pathname.endsWith('/analytics')
          ? { success: true, analytics: { suppressed: false, eligibleCount: 10, levelDistribution: distribution, exactScoreStatistics: null } }
          : pathname.endsWith('/ranking')
            ? { success: true, ranking: { suppressed: false, eligibleCount: 5, groups: distribution.map((row, index) => ({ ...row, members: index === 2 ? [{ personnelId: 'p-1', displayName: 'پرسنل مجاز', employmentRelationshipId: 'r-1', measurementTo: '2026-08-22T20:29:59.999Z' }] : [] })) } }
            : { success: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
};

test('live performance insights are RTL, responsive, accessible, and disclose no score', async ({ page }) => {
  await loginAsAdmin(page);
  await mockInsightsApi(page, { VIEW_PERFORMANCE_ANALYTICS: true, VIEW_NAMED_PERFORMANCE_RANKING: true });
  await page.goto('/dashboard/hr/personnel/performance/insights');
  await expect(page.getByRole('heading', { name: 'تحلیل، رتبه‌بندی و خروجی عملکرد' })).toBeVisible();
  await expect(page.getByText('مطابق انتظار')).toBeVisible();
  await expect(page.getByText(/امتیاز/)).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await assertNoSeriousAxeViolations(page);
  await setViewportAndZoom(page, { width: 390, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'تحلیل نام‌دار' }).click();
  await expect(page.getByText('پرسنل مجاز')).toBeVisible();
});

test('performance insights expose no analytical surface without independent permissions', async ({ page }) => {
  await loginAsAdmin(page);
  await mockInsightsApi(page, {});
  await page.goto('/dashboard/hr/personnel/performance/insights');
  await expect(page.getByRole('button', { name: 'تحلیل تجمیعی' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'تحلیل نام‌دار' })).toBeDisabled();
  await expect(page.getByText('توزیع سطح‌های مصوب')).toHaveCount(0);
});
