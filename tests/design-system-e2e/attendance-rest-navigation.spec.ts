import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow } from './support/design-system';

test('personnel header opens rest settings and both saves omit a manual reason', async ({ page }) => {
  if (process.env.ATTENDANCE_E2E_SESSION_FILE) {
    const state = JSON.parse(readFileSync(process.env.ATTENDANCE_E2E_SESSION_FILE, 'utf8'));
    await page.context().addCookies([state.cookie]);
  } else await loginAsAdmin(page);
  await page.route('**/api/hr/personnel-attendance-rest', route => route.fulfill({ json: { success: true, data: { canEdit: true, policies: [], personnel: [{ id: 'qa-person', firstName: 'نمونه', lastName: 'استراحت', attendanceRestAssignments: [] }] } } }));
  const saved: Array<{ kind: string; body: Record<string, unknown> }> = [];
  for (const kind of ['policies', 'assignments']) await page.route(`**/api/hr/personnel-attendance-rest/${kind}`, async route => {
    saved.push({ kind, body: route.request().postDataJSON() });
    await route.fulfill({ json: { success: true, data: {} } });
  });
  await page.goto('/dashboard/hr/personnel');
  const shortcut = page.getByRole('link', { name: 'استراحت پرسنل', exact: true });
  await expect(shortcut).toBeVisible(); await expect(shortcut).toHaveAttribute('href', '/dashboard/hr/personnel/attendance-rest');
  await shortcut.click(); await expect(page).toHaveURL(/\/dashboard\/hr\/personnel\/attendance-rest$/);
  await expect(page.getByRole('textbox', { name: 'دلیل تغییر', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ثبت بازه مشترک', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'ثبت بازه مشترک', exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].kind).toBe('policies'); expect(saved[0].body).not.toHaveProperty('reason');
  expect(saved[0].body.startTime).toBe('13:00'); expect(saved[0].body.endTime).toBe('14:00');
  await expect(page.getByRole('button', { name: 'ثبت تخصیص ۰ نفر' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'تخصیص استراحت' }).selectOption('YES');
  await page.getByRole('checkbox', { name: 'نمونه استراحت', exact: true }).check();
  await page.getByRole('button', { name: 'ثبت تخصیص ۱ نفر' }).click();
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[1].body).not.toHaveProperty('reason'); expect(saved[1].body.hasRest).toBe(true); expect(saved[1].body.personnelIds).toEqual(['qa-person']);
  await page.setViewportSize({ width: 390, height: 844 }); await assertNoHorizontalOverflow(page);
  await page.screenshot({ animations: 'disabled', path: '.codex-tmp/attendance/rest-window-2026-10-21/shortcut-rest-mobile.png', fullPage: true });
  await page.goto('/dashboard/hr/personnel'); await expect(shortcut).toBeVisible(); await assertNoHorizontalOverflow(page);
  await page.screenshot({ animations: 'disabled', path: '.codex-tmp/attendance/rest-window-2026-10-21/shortcut-personnel-mobile.png', fullPage: true });
});
