import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, setTheme, setViewportAndZoom, assertNoHorizontalOverflow } from './support/design-system';

const badge = { state: 'LEVEL', levelCode: 'SUPERIOR', labelFa: 'ستون', meaningFa: 'تکیه‌گاه ماست', officialResult: true, romanNumeral: 'II', version: 2 };
const person = { id: 'badge-profile-qa', firstName: 'پرسنل', lastName: 'آزمایشی', nationalCode: '0012345678', employeeNumber: '42', hrEmploymentRelationships: [{ id: 'relationship-qa', status: 'ACTIVE', effectiveFrom: '2026-09-01T00:00:00Z', assignments: [] }], retentionCapabilities: { canArchive: true, canPermanentlyDelete: false } };
async function fixture(page: Page, historyAllowed: boolean) {
  await loginAsAdmin(page);
  let historyRequests = 0;
  await page.route('**/api/hr/authorization/me', route => route.fulfill({ json: { data: { actionPermissionCodes: ['VIEW_PERFORMANCE_BADGE_LIST', ...(historyAllowed ? ['VIEW_PERFORMANCE_EVALUATIONS'] : [])], effectiveAccess: { features: [{ feature: 'PERSONNEL', permission: 'edit' }] } } } }));
  await page.route(/\/api\/hr\/personnel(?:\?|$)/, route => route.fulfill({ json: { data: [person], meta: { page: 1, total: 1, totalPages: 1 } } }));
  await page.route('**/api/hr/operational-reference/personnel', route => route.fulfill({ json: { data: { positions: [] } } }));
  await page.route('**/api/hr/personnel-performance/badges', route => route.fulfill({ json: { badges: [{ personnelId: person.id, badge }] } }));
  await page.route('**/api/hr/personnel-performance/badge/me', route => route.fulfill({ json: { badge } }));
  await page.route('**/api/hr/personnel-performance/simple/history/**', route => {
    historyRequests++;
    return route.fulfill({ json: { evaluations: [{ id: 'evaluation-qa', status: 'FINAL', levelCode: 'SUPERIOR', score: '87', evaluationDate: '2026-09-30T00:00:00Z', finalizedAt: '2026-10-01T12:00:00Z', evaluatorNameFa: 'ارزیاب مجاز' }], legacyEvaluations: [], hasMore: false } });
  });
  await page.route('**/api/hr/personnel/badge-profile-qa/work-schedule', route => route.fulfill({ json: { data: { workSchedules: [], workScheduleCapabilities: { canEdit: true } } } }));
  await page.goto('/dashboard/hr/personnel');
  return () => historyRequests;
}

test('Personnel profile preserves independent disclosure and schedule draft confirmation', async ({ page }) => {
  const historyRequests = await fixture(page, false);
  const row = page.locator('[data-personnel-id="badge-profile-qa"]');
  const opener = row.getByRole('button', { name: 'مشاهده پروندهٔ پرسنل آزمایشی' });
  const box = await opener.boundingBox();
  await opener.click({ position: { x: box!.width * .6, y: 20 } });
  const profile = page.getByRole('dialog', { name: 'پروندهٔ پرسنل' });
  await expect(profile).toBeVisible();
  await expect(profile.getByText('دسترسی به امتیاز و سوابق ارزیابی ندارید.')).toBeVisible();
  await profile.getByRole('button', { name: 'عملکرد و سوابق', exact: true }).click();
  expect(historyRequests()).toBe(0);
  await profile.getByRole('button', { name: 'برنامهٔ کاری', exact: true }).click();
  await profile.getByRole('button', { name: 'همه روزها', exact: true }).click();
  await profile.getByRole('button', { name: 'برنامهٔ کاری', exact: true }).click();
  await profile.getByRole('button', { name: 'نمای کلی', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'بستن برنامه کاری بدون ذخیره؟' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'ادامه ویرایش' }).click();
  await expect(profile.getByRole('button', { name: 'همه روزها', exact: true })).toBeVisible();
  await profile.getByRole('button', { name: 'نمای کلی', exact: true }).click();
  await confirm.getByRole('button', { name: 'کنار گذاشتن', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(profile.getByText('دسترسی به امتیاز و سوابق ارزیابی ندارید.')).toBeVisible();
  await expect(page).toHaveURL(/focus=badge-profile-qa/);
  await page.keyboard.press('Escape');
  await expect(profile).toBeHidden();
  await expect(opener).toBeFocused();
  expect(historyRequests()).toBe(0);
  await opener.click({ position: { x: box!.width * .6, y: 20 } });
  await profile.getByRole('button', { name: 'برنامهٔ کاری', exact: true }).click();
  await profile.getByRole('button', { name: 'همه روزها', exact: true }).click();
  await profile.getByRole('button', { name: 'بستن', exact: true }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'کنار گذاشتن', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(profile).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Seven floating stones preserve roadmap order, current emphasis and responsive profiles', async ({ page }) => {
  await fixture(page, true);
  const row = page.locator('[data-personnel-id="badge-profile-qa"]');
  await expect(row.getByRole('button', { name: 'سطح عملکرد: ستون' })).toBeVisible();
  await row.getByRole('button', { name: 'سطح عملکرد: ستون' }).click();
  const roadmapDialog = page.getByRole('dialog', { name: 'خلاصه سطح عملکرد' });
  await expect(roadmapDialog.getByRole('button')).toHaveCount(8); // seven stages and canonical close
  await expect(roadmapDialog.locator('[aria-current="step"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: 'مشاهده پروندهٔ پرسنل آزمایشی' }).click();
  const profile = page.getByRole('dialog', { name: 'پروندهٔ پرسنل' });
  await expect(profile.getByText('87', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    for (const width of [1440, 390]) {
      await setViewportAndZoom(page, { width, height: 1000 });
      const journey = profile.getByRole('region', { name: 'مسیر هفت نشان عملکرد' });
      const boxes = await journey.getByRole('button').evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })));
      expect(boxes).toHaveLength(7);
      if (width === 1440) expect(boxes.every((box, index) => !index || box.x > boxes[index - 1].x)).toBeTruthy();
      else expect(boxes.every((box, index) => !index || box.y > boxes[index - 1].y)).toBeTruthy();
      const filters = await journey.locator('[style*="background-image"]').evaluateAll(elements => elements.map(element => getComputedStyle(element).filter));
      expect(filters.slice(0, 5)).toEqual(Array(5).fill('none'));
      expect(filters.slice(5)).toEqual(Array(2).fill('brightness(0.78)'));
      await assertNoHorizontalOverflow(page);
    }
  }
  await profile.getByRole('button', { name: 'عملکرد و سوابق', exact: true }).click();
  await expect(profile.getByText(/ارزیاب مجاز/)).toBeVisible();
});
