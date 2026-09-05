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
].map(([levelCode, labelFa], index) => ({ levelCode, labelFa, count: index === 2 ? 10 : 0, percent: index === 2 ? 100 : 0 }));

const mockInsightsApi = async (page: Page, capabilities: Record<string, boolean>) => {
  await page.route('**/api/hr/personnel-performance/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const body = pathname.endsWith('/capabilities')
      ? { success: true, capabilities }
      : pathname.endsWith('/consequence-handoffs/handoff-1')
        ? { success: true, handoff: { id: 'handoff-1', status: 'RECEIVED' }, package: {
          consequenceType: 'COMPENSATION_REVIEW', policyCycleKey: '1405-H1', reasonCategory: 'SUSTAINED_CONTRIBUTION',
          reason: 'بازبینی مستقل بر پایه نتیجه مصوب و شاهد ثبت‌شده', selectedResults: [{ id: 'result-1' }],
        } }
      : pathname.endsWith('/badge/me')
        ? { success: true, badge: { state: 'LEVEL', levelCode: 'MEETS_EXPECTATIONS', labelFa: 'مطابق انتظار', meaningFa: 'عملکرد مصوب با انتظارهای نقش هم‌خوان است.', version: 1 } }
        : pathname.endsWith('/analytics')
          ? { success: true, analytics: { suppressed: false, eligibleCount: 10, levelDistribution: distribution, exactScoreStatistics: null,
            trend: { suppressed: false, fixedCohortSuppressed: true, periods: [], populationComposition: { suppressed: false, periods: [
              { periodKey: '2026-02', eligiblePopulationCount: 10, resultPopulationCount: 0, missingResultCount: 10, entriesSincePrevious: 0, exitsSincePrevious: 0 },
            ] } },
          } }
          : pathname.endsWith('/ranking')
            ? { success: true, ranking: { suppressed: false, eligibleCount: 5, peerGroups: [{ peerGroupKey: 'family-a:v1', groups: distribution.map((row, index) => ({ ...row, members: index === 2 ? [{ personnelId: 'p-1', displayName: 'پرسنل مجاز', employmentRelationshipId: 'r-1', measurementTo: '2026-08-22T20:29:59.999Z' }] : [] })) }] } }
            : { success: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
};

test('live performance insights are RTL, responsive, accessible, and disclose no score', async ({ page }) => {
  await loginAsAdmin(page);
  await mockInsightsApi(page, { VIEW_PERFORMANCE_ANALYTICS: true, VIEW_NAMED_PERFORMANCE_RANKING: true });
  await page.goto('/dashboard/hr/personnel/performance/insights');
  await expect(page.getByRole('heading', { name: 'تحلیل، رتبه‌بندی و خروجی عملکرد' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'سطح عملکرد: مطابق انتظار' })).toBeVisible();
  await expect(page.getByText(/امتیاز/)).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('روند جمعیت ثابت برای حفاظت از گروه‌های کوچک نمایش داده نمی‌شود.')).toBeVisible();
  await expect(page.getByText('جمعیت 2026-02')).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await setViewportAndZoom(page, { width: 390, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'تحلیل نام‌دار' }).click();
  await expect(page.getByText('پرسنل مجاز')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'گروه مقایسه: family-a:v1' })).toBeVisible();
});

test('performance insights expose no analytical surface without independent permissions', async ({ page }) => {
  await loginAsAdmin(page);
  await mockInsightsApi(page, {});
  await page.goto('/dashboard/hr/personnel/performance/insights');
  await expect(page.getByRole('button', { name: 'تحلیل تجمیعی' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'تحلیل نام‌دار' })).toBeDisabled();
  await expect(page.getByText('توزیع سطح‌های مصوب')).toHaveCount(0);
});

test('assigned consequence destination can receive its minimum package from the notification link', async ({ page }) => {
  await loginAsAdmin(page);
  await mockInsightsApi(page, {});
  await page.goto('/dashboard/hr/personnel/performance/insights?handoffId=handoff-1');
  await expect(page.getByRole('heading', { name: 'بسته ارجاع اختصاص‌یافته' })).toBeVisible();
  await expect(page.getByText('بازبینی مستقل بر پایه نتیجه مصوب و شاهد ثبت‌شده')).toBeVisible();
  await expect(page.getByText(/نتیجه‌های مبنا/)).toContainText('۱');
});

test('manual consequence handoff requires explicit result, evidence, and human reason', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/hr/personnel-performance/consequence-handoffs/eligible-results/**', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, results: [{
      id: 'result-1', labelFa: 'مطابق انتظار', measurementTo: '2026-08-22T20:29:59.999Z', status: 'EFFECTIVE',
    }] }),
  }));
  let submitted: any;
  await page.route('**/api/hr/personnel-performance/consequence-handoffs', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, handoff: { id: 'handoff-1' } }) });
  });
  await page.goto('/dashboard/hr/personnel/performance/consequence/new?personnelId=personnel-1&relationshipId=relationship-1');
  await expect(page.getByRole('heading', { name: 'ارجاع پیامد عملکرد' })).toBeVisible();
  await expect(page.getByText(/هیچ تغییر خودکار/)).toBeVisible();
  await page.getByRole('checkbox', { name: /مطابق انتظار/ }).check();
  await page.getByLabel('چرخه سیاستی').fill('1405-H1');
  await page.getByLabel('ارجاع شاهد مستقل').fill('evidence-42');
  await page.getByLabel('دلیل انسانی').fill('بازبینی انسانی مستقل با اتکا به شاهد ثبت‌شده و نتیجه مصوب');
  await page.getByRole('button', { name: 'ارسال برای بازبینی مستقل' }).click();
  await expect.poll(() => submitted).toBeTruthy();
  expect(submitted).toMatchObject({ personnelId: 'personnel-1', employmentRelationshipId: 'relationship-1', resultIds: ['result-1'], independentEvidenceReferences: ['evidence-42'] });
});
