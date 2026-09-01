import { expect, test, type Page } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  assertNoSeriousAxeViolations,
  assertVisibleFocus,
  loginAsAdmin,
  setViewportAndZoom,
} from './support/design-system';

const mockPolicyApi = async (page: Page, canManage = true) => {
  await page.route('**/api/hr/personnel-performance/**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/capabilities')
      ? { success: true, capabilities: canManage ? { MANAGE_PERFORMANCE_POLICY: true, VIEW_PERFORMANCE_HISTORY: true } : {} }
      : url.pathname.endsWith('/criteria') ? { success: true, criteria: [] }
        : url.pathname.endsWith('/templates') ? { success: true, templates: [] }
          : url.pathname.endsWith('/policies') ? { success: true, policies: [] }
            : { success: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
};

test('performance policy administration sheets are RTL, accessible, responsive, and validation-safe', async ({ page }) => {
  await loginAsAdmin(page);
  await mockPolicyApi(page);
  await page.goto('/dashboard/hr/personnel/performance-policies');
  await expect(page.getByRole('heading', { name: 'معیارها و سیاست‌های عملکرد' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByRole('button', { name: 'معیار جدید' }).click();
  const criterionDialog = page.getByRole('dialog', { name: 'ساخت نسخه معیار' });
  await expect(criterionDialog).toBeVisible();
  await expect(criterionDialog.getByText('عنوان فارسی معیار الزامی است.')).toBeVisible();
  await expect(criterionDialog.getByRole('button', { name: 'ذخیره پیش‌نویس' })).toBeDisabled();
  await assertVisibleFocus(criterionDialog.getByRole('textbox', { name: 'عنوان فارسی' }));
  await assertNoSeriousAxeViolations(page);
  await setViewportAndZoom(page, { width: 390, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(criterionDialog).toBeHidden();

  await page.getByRole('button', { name: 'الگو و افزوده' }).click();
  await page.getByRole('button', { name: 'الگوی جدید' }).click();
  const templateDialog = page.getByRole('dialog', { name: 'ساخت پیش‌نویس الگو' });
  await expect(templateDialog.getByText('جمع وزن دسته‌ها: ۱۰۰٪')).toBeVisible();
  await templateDialog.getByRole('button', { name: 'افزودن معیار به دسته اصلی' }).click();
  await expect(templateDialog.getByText('جمع وزن معیارهای دسته اصلی: ۱۰۰٪')).toBeVisible();
  await templateDialog.getByRole('button', { name: 'افزودن دسته وزنی' }).click();
  await expect(templateDialog.getByText('عنوان دسته الزامی است.')).toBeVisible();
  await expect(templateDialog.getByRole('button', { name: 'ساخت الگو' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(templateDialog).toBeHidden();

  await setViewportAndZoom(page, { width: 1440, height: 900 }, 1);
  await page.getByRole('button', { name: 'سیاست‌های سازمانی' }).click();
  await page.getByRole('button', { name: 'نسخه سیاست جدید' }).click();
  const policyDialog = page.getByRole('dialog', { name: 'ساخت پیش‌نویس سیاست' });
  await expect(policyDialog.getByRole('spinbutton', { name: 'مرز پایین امتیاز' })).toHaveCount(5);
  await expect(policyDialog.getByRole('textbox', { name: 'معنای فارسی سطح' })).toHaveCount(5);
  await policyDialog.getByRole('spinbutton', { name: 'مرز پایین امتیاز' }).nth(1).fill('0');
  await expect(policyDialog.getByText('مقادیر سیاست با قواعد انتشار سازگار نیست')).toBeVisible();
  await expect(policyDialog.getByRole('button', { name: 'ساخت نسخه' })).toBeDisabled();
  await policyDialog.getByRole('spinbutton', { name: 'مرز پایین امتیاز' }).nth(1).fill('25');
  await expect(policyDialog.getByRole('button', { name: 'ساخت نسخه' })).toBeEnabled();
  const policyRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/api/hr/personnel-performance/policies'));
  await policyDialog.getByRole('button', { name: 'ساخت نسخه' }).click();
  const postedPolicy = (await policyRequest).postDataJSON() as { content: { thresholds: Array<{ minimum: string; maximumExclusive?: string }> } };
  expect(postedPolicy.content.thresholds[0].maximumExclusive).toBe('25.000000');
  expect(postedPolicy.content.thresholds[1].minimum).toBe('25.000000');
});

test('performance policy administration hides mutation controls without its independent permission', async ({ page }) => {
  await loginAsAdmin(page);
  await mockPolicyApi(page, false);
  await page.goto('/dashboard/hr/personnel/performance-policies');
  await expect(page.getByText('مجوز مستقل مدیریت سیاست عملکرد برای این صفحه فعال نیست.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'معیار جدید' })).toHaveCount(0);
});

test('retired dashboard prototypes redirect to canonical production surfaces', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/dashboard/hr/personnel/performance-analytics-prototype');
  await expect(page).toHaveURL(/\/dashboard\/hr\/personnel\/performance\/insights$/);
  await page.goto('/dashboard/hr/personnel/performance-criteria-prototype');
  await expect(page).toHaveURL(/\/dashboard\/hr\/personnel\/performance-policies$/);
  await page.goto('/dashboard/hr/personnel/performance-badge-prototype');
  await expect(page).toHaveURL(/\/dashboard\/hr\/personnel$/);
});

test('criteria publication rejects a missing or non-future effective date', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/prototype/performance-criteria?variant=D');
  await page.getByRole('button', { name: 'ساخت معیار جدید' }).click();
  const editor = page.getByRole('dialog', { name: 'ساخت معیار جدید' });
  await editor.getByRole('textbox', { name: 'سهم این معیار' }).fill('۳۰');
  await editor.getByRole('textbox', { name: 'توضیح امتیاز ۵' }).fill('رفتار برجسته و کاملاً قابل مشاهده');
  await editor.getByRole('button', { name: 'بررسی نهایی' }).click();
  const review = page.getByRole('dialog', { name: 'بررسی نهایی' });
  await review.getByRole('textbox', { name: 'تاریخ اثر' }).fill('');
  await review.getByRole('button', { name: 'زمان‌بندی نسخه' }).click();
  await expect(page.getByText('تاریخ اثر باید یک تاریخ معتبر در آینده باشد.')).toBeVisible();
  await expect(review).toBeVisible();
});
