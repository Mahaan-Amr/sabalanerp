import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

async function setup(page: Page) {
  await loginAsAdmin(page);
  const events: string[] = [];
  let failedFinger: string | null = null;
  let finalFails = false;
  await page.route('**/api/dispatch-master-data/external-drivers/biometric-fixture/eligibility', route => route.fulfill({ json: {
    data: { identity: { firstName: 'راننده', lastName: 'آزمایشی' }, driver: { id: 'driver', currentEligibility: { status: 'ELIGIBLE' } }, activeBiometricEnrollment: null },
    capabilities: { canManageEligibility: true, canManageBiometricEnrollment: true },
  } }));
  await page.route('**/api/dispatch-confirmation/external-drivers/biometric-fixture/**', async route => {
    const data = route.request().postDataJSON();
    if (route.request().url().endsWith('/enrollment-session/cancel')) {
      await route.fulfill({ json: { data: {} } });
    } else if (route.request().url().endsWith('/enrollment-commands')) {
      events.push(`command:${data.finger}`);
      await route.fulfill({ json: { data: { command: { commandId: data.finger } } } });
    } else if (route.request().url().endsWith('/enrollment-captures')) {
      if (data.signedResponse.response.result.availability !== 'AVAILABLE') {
        events.push(`failure:${data.challengeId}`);
        await route.fulfill({ status: 409, json: { error: 'برداشت اثر انگشت ناموفق بود.' } });
        return;
      }
      events.push(`stage:${data.challengeId}`);
      await route.fulfill({ json: { data: { challengeId: data.challengeId, finger: data.challengeId, expiresAt: new Date(Date.now() + 300_000).toISOString(), qualityState: 'ACCEPTED', qualityScore: 80, livenessState: 'LIVE' } } });
    } else {
      events.push('final');
      expect(data.captures).toEqual([{ challengeId: 'RIGHT_INDEX' }, { challengeId: 'LEFT_INDEX' }]);
      expect(data.enrollmentSessionId).toBeTruthy();
      await route.fulfill({ status: finalFails ? 503 : 200, json: finalFails ? { error: 'ذخیره نهایی موقتاً ممکن نیست.' } : { data: {} } });
    }
  });
  await page.route('http://127.0.0.1:47631/**', async route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (route.request().url().endsWith('/status')) { await route.fulfill({ headers, json: { workstationId: 'station', availability: 'AVAILABLE' } }); return; }
    const finger = route.request().postDataJSON().command.commandId;
    await route.fulfill({ headers, json: { response: { result: finger === failedFinger
      ? { availability: 'UNAVAILABLE', errorCategory: 'CONNECTOR_ERROR', captureQuality: { state: 'NOT_EVALUATED' }, liveness: { state: 'NOT_EVALUATED' } }
      : { availability: 'AVAILABLE', errorCategory: 'NONE', captureQuality: { state: 'ACCEPTED', score: 80 }, liveness: { state: 'LIVE' } } }, signature: 'signature', transportEnvelope: {} } });
  });
  await page.goto('/dashboard/hr/external-drivers/biometric-fixture');
  await page.getByRole('button', { name: 'بیومتریک', exact: true }).click();
  await page.getByRole('textbox', { name: 'شماره تأیید راننده' }).fill('09123456789');
  return { events, fail: (finger: string | null) => { failedFinger = finger; }, failFinal: (value: boolean) => { finalFails = value; } };
}

test('external failed right capture stops before left and shows failure evidence', async ({ page }) => {
  const h = await setup(page); h.fail('RIGHT_INDEX');
  await page.getByRole('button', { name: 'شروع ثبت بیومتریک' }).click();
  await page.getByRole('button', { name: 'اسکن انگشت راست', exact: true }).click();
  await expect(page.getByText('برداشت ناموفق', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'اسکن انگشت چپ', exact: true })).toHaveCount(0);
  await expect.poll(() => [...h.events]).toEqual(['command:RIGHT_INDEX', 'failure:RIGHT_INDEX']);
  await expect(page.getByText(/کیفیت/).last()).not.toHaveClass(/success/);
});

test('external accepted right is staged before left and survives left and final retry failures', async ({ page }) => {
  const h = await setup(page); h.fail('LEFT_INDEX');
  await page.getByRole('button', { name: 'شروع ثبت بیومتریک' }).click();
  await page.getByRole('button', { name: 'اسکن انگشت راست', exact: true }).click();
  await expect(page.getByRole('button', { name: 'اسکن انگشت چپ', exact: true })).toBeVisible();
  expect(h.events).toEqual(['command:RIGHT_INDEX', 'stage:RIGHT_INDEX']);
  await expect(page.getByText('پذیرفته‌شده موقت؛ در انتظار ثبت نهایی', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'اسکن انگشت چپ', exact: true }).click();
  await expect(page.getByText('برداشت ناموفق', { exact: true })).toBeVisible();
  h.fail(null); h.failFinal(true);
  await page.getByRole('button', { name: 'شروع ثبت بیومتریک' }).click();
  await expect(page.getByRole('button', { name: 'اسکن انگشت راست', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'اسکن انگشت چپ', exact: true }).click();
  await expect(page.getByText('ذخیره نهایی موقتاً ممکن نیست.', { exact: false })).toBeVisible();
  const beforeRetry = [...h.events]; h.failFinal(false);
  await page.getByRole('button', { name: 'شروع ثبت بیومتریک' }).click();
  await expect(page.getByText('ثبت بیومتریک ذخیره شد.', { exact: true })).toBeVisible();
  expect(h.events).toEqual([...beforeRetry, 'final']);
});
