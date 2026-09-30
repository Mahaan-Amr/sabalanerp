import { expect, test, type Page } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  assertVisibleFocus,
  loginAsAdmin,
  setViewportAndZoom,
} from './support/design-system';

const sectionId = 'section-360';
const submissionId = 'submission-360';

const form = {
  categories: [{
    id: 'category-1',
    titleFa: 'رفتار حرفه‌ای',
    templateTitleFa: 'الگوی سرپرست مستقیم',
    criteria: [{
      criterionVersionId: 'criterion-1',
      titleFa: 'کیفیت تحویل',
      meaningFa: 'کیفیت خروجی در بازه اندازه‌گیری',
      kind: 'JUDGMENT',
      anchorsFa: ['نیازمند بهبود', 'کمتر از انتظار', 'مطابق انتظار', 'فراتر از انتظار', 'برجسته'],
      evidence: { minimumReliableCount: 1, required: true, allowedKinds: ['STRUCTURED_OBSERVATION'] },
    }],
  }],
};

const mockWorkflowApi = async (page: Page, capabilities: Record<string, boolean>) => {
  await page.route('**/api/hr/personnel-performance/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    let body: unknown = { success: true };
    if (pathname.endsWith('/simple/workspace')) body = {
      currentUserId: 'reviewer-1', currentPeriodKey: '1405-07', levelLabels: {},
      evaluablePersonnelIds: [], latestFinalizedAtByPersonnel: {}, currentJobIdByPersonnel: {},
      personnel: [], historyPersonnel: [], profiles: [], assignments: [], jobs: [], capabilities,
      evaluations: [{
        id: 'pending-result-1', personnelId: 'person-1', status: 'PENDING_APPEAL',
        evaluationDate: '2026-09-01', createdAt: '2026-09-01T08:00:00Z',
        evaluatorUserId: 'supervisor-1', evaluatorAuthority: 'SUPERVISOR', evaluatorNameFa: 'سرپرست آزمون',
        profile: { id: 'profile-1', stableKey: 'fixture', nameFa: 'فرم آزمون', version: 1, indicators: [] },
        values: [], appealText: 'شاهد ثبت‌شده نیازمند بررسی است.', appealedAt: '2026-09-02T08:00:00Z',
      }],
    };
    else if (pathname.endsWith('/capabilities')) body = { success: true, capabilities };
    else if (pathname.endsWith(`/supervisor/sections/${sectionId}`)) body = {
      section: { id: sectionId, evaluationId: 'evaluation-1', status: 'DRAFT', effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveTo: '2026-07-31T23:59:59.000Z', submissionDueAt: '2026-08-05T12:00:00.000Z', reviewDueAt: null, personnel: { displayName: 'کارمند نمونه' } },
      form,
      draft: null,
      review: null,
    };
    else if (pathname.endsWith('/supervisor/sections')) body = { sections: [{ id: sectionId, status: 'DRAFT', effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveTo: '2026-07-31T23:59:59.000Z', submissionDueAt: '2026-08-05T12:00:00.000Z', reviewDueAt: null, personnel: { displayName: 'کارمند نمونه' } }] };
    else if (pathname.endsWith(`/reviews/${submissionId}`)) body = {
      submission: { id: submissionId, version: 1, submittedAt: '2026-08-01T10:00:00.000Z' },
      section: { id: sectionId, evaluationId: 'evaluation-1', effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveTo: '2026-07-31T23:59:59.000Z', reviewDueAt: '2026-08-08T12:00:00.000Z' },
      content: { narrative: 'تحویل پایدار', responses: [{ criterionVersionId: 'criterion-1', grade: 4, evidence: [{ referenceId: 'OBS-42' }] }] },
      form,
    };
    else if (pathname.endsWith('/reviews')) body = { reviews: [] };
    else if (pathname.endsWith('/lifecycle/sections')) body = { sections: [{
      id: sectionId, evaluationId: 'evaluation-1', evaluationStatus: 'ACCEPTED', hasAcceptedResult: true,
      status: 'ACCEPTED', effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveTo: '2026-07-31T23:59:59.000Z',
      submissionDueAt: '2026-08-05T12:00:00.000Z', reviewDueAt: null, personnel: { displayName: 'کارمند نمونه' },
    }] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
};

test('supervisor workflow requires complete evidence and remains accessible at mobile zoom', async ({ page }) => {
  await loginAsAdmin(page);
  await mockWorkflowApi(page, { SUBMIT_PERFORMANCE_EVALUATION: true });
  await page.goto(`/dashboard/hr/personnel/performance/supervisor/${sectionId}`);
  await expect(page.getByRole('heading', { name: 'گردش ارزیابی عملکرد' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const submit = page.getByRole('button', { name: 'ذخیره و ارسال' });
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'فراتر از انتظار' }).click();
  await page.getByRole('textbox', { name: 'مرجع شاهد' }).fill('OBS-42');
  await page.getByRole('textbox', { name: 'نسخه منبع' }).fill('3');
  await page.getByLabel('زمان شاهد').fill('2026-07-20T11:30');
  await page.getByRole('textbox', { name: 'هش شاهد' }).fill('a'.repeat(64));
  await expect(submit).toBeEnabled();
  await assertVisibleFocus(page.getByRole('textbox', { name: 'مرجع شاهد' }));
  await assertNoSeriousAxeViolations(page);
  await setViewportAndZoom(page, { width: 390, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
});

test('HR decision sheet requires a reason for rejection', async ({ page }) => {
  await loginAsAdmin(page);
  await mockWorkflowApi(page, { REVIEW_PERFORMANCE_EVALUATION: true });
  await page.goto(`/dashboard/hr/personnel/performance/reviews/${submissionId}`);
  await page.getByRole('button', { name: 'بازگرداندن' }).click();
  const dialog = page.getByRole('dialog', { name: 'بازگرداندن برای اصلاح' });
  await expect(dialog.getByRole('button', { name: 'ثبت تصمیم' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'توضیح تصمیم' }).fill('شاهد ثبت‌شده برای تصمیم کافی نیست.');
  await expect(dialog.getByRole('button', { name: 'ثبت تصمیم' })).toBeEnabled();
});

test('performance workspace hides protected actions without independent permissions', async ({ page }) => {
  await loginAsAdmin(page);
  await mockWorkflowApi(page, {});
  await page.goto('/dashboard/hr/personnel/performance');
  await expect(page.getByText('اجازه ثبت ارزیابی ندارید.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'شروع بازسازی' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ثبت ارزیابی', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'انتشار نتیجه رسمی', exact: true })).toHaveCount(0);
  for (const name of ['فرم‌ها', 'نظرسنجی', 'سابقه']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  }
});

test('independent finalization permission exposes appeal review with a required human reason', async ({ page }) => {
  await loginAsAdmin(page);
  await mockWorkflowApi(page, { FINALIZE_PERFORMANCE_RESULTS: true });
  await page.goto('/dashboard/hr/personnel/performance');
  await expect(page.getByText('اجازه ثبت ارزیابی ندارید.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'انتشار نتیجه رسمی', exact: true })).toBeDisabled();
  const review = page.getByRole('button', { name: 'ثبت رسیدگی', exact: true });
  await expect(review).toBeDisabled();
  await page.getByRole('textbox', { name: 'نتیجه رسیدگی', exact: true }).fill('شاهد ثبت‌شده پس از ممیزی معتبر نیست.');
  await expect(review).toBeEnabled();
  await review.click();
  await expect(page.getByRole('dialog', { name: 'ثبت نتیجه رسیدگی به اعتراض؟', exact: true })).toBeVisible();
});

test('legacy review workflow hides all surfaces without an independent action permission', async ({ page }) => {
  await loginAsAdmin(page);
  await mockWorkflowApi(page, {});
  await page.goto(`/dashboard/hr/personnel/performance/reviews/${submissionId}`);
  await expect(page.getByText('هیچ مجوز فعال برای گردش ارزیابی عملکرد ندارید.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'شروع بازسازی' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تعلیق اثر نتیجه', exact: true })).toHaveCount(0);
});

test('independent suspension permission retains its audited action on legacy review routes', async ({ page }) => {
  await loginAsAdmin(page);
  await mockWorkflowApi(page, { PAUSE_PERFORMANCE_EVALUATION: true });
  await page.goto(`/dashboard/hr/personnel/performance/reviews/${submissionId}`);
  await page.getByRole('button', { name: /اقدام‌های منابع انسانی/ }).click();
  await page.getByRole('button', { name: 'تعلیق اثر نتیجه' }).click();
  const dialog = page.getByRole('dialog', { name: 'تعلیق اثر نتیجه' });
  await expect(dialog.getByRole('button', { name: 'ثبت اقدام' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'دلیل ممیزی' }).fill('زمینه ارزیابی پس از ممیزی معتبر نیست.');
  await expect(dialog.getByRole('button', { name: 'ثبت اقدام' })).toBeEnabled();
});
