import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../backend/node_modules/@prisma/client';
import { createAuthoritativeSession } from '../../backend/src/services/identitySessionService';
import { tokenHash } from '../../backend/src/services/attendanceDevice';
import AxeBuilder from '@axe-core/playwright';

const db = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10' } } });
const key = randomUUID();
const personName = `آزمون تردد ${key.slice(0, 6)}`;
let actorId: string;
let personId: string;
let terminalId: string;
let sessionToken: string;
const terminalSecret = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

test.beforeAll(async () => {
  const fixture = await db.$transaction(async tx => {
    const actor = await tx.user.create({ data: { username: `qa-attendance-${key}`, email: `qa-attendance-${key}@example.invalid`, password: 'not-a-login', firstName: 'آزمون', lastName: 'مدیر تردد', role: 'ADMIN' } });
    actorId = actor.id;
    const person = await tx.personnel.create({ data: { firstName: 'آزمون تردد', lastName: key.slice(0, 6) } }); personId = person.id;
    const before = new Date(Date.now() - 3600000);
    const terminal = await tx.attendanceTerminal.create({ data: { name: `دستگاه آزمون ${key.slice(0,6)}`, tokenHash: tokenHash(terminalSecret), mode: 'ACTIVE', activatedAt: before, createdBy: actor.id } }); terminalId = terminal.id;
    await tx.attendanceTerminalPeriod.create({ data: { terminalId, mode: 'ACTIVE', startsAt: before } });
    await tx.attendanceTerminalMapping.create({ data: { terminalId, deviceCode: '1', personnelId: personId, nameSnapshot: personName, initialState: 'OUTSIDE', effectiveFrom: before, createdBy: actor.id } });
    await tx.securityAttendanceRosterMembership.create({ data: { personnelId: personId, effectiveFrom: new Date('2026-01-01T00:00:00Z'), createdBy: actor.id } });
    return createAuthoritativeSession(tx, actor.id, { userAgent: 'Local attendance browser acceptance' });
  });
  sessionToken = fixture.token;
});
test.afterAll(async () => {
  try {
    if (terminalId) {
      await db.attendancePunch.deleteMany({ where: { terminalId } });
      await db.attendanceDeviceAudit.deleteMany({ where: { terminalId } });
      await db.attendanceTerminalMapping.deleteMany({ where: { terminalId } });
      await db.attendanceTerminalPeriod.deleteMany({ where: { terminalId } });
      await db.attendanceTerminal.deleteMany({ where: { id: terminalId } });
    }
    if (personId) {
      await db.attendanceRecord.deleteMany({ where: { personnelId: personId } });
      await db.securityAttendanceRosterMembership.deleteMany({ where: { personnelId: personId } });
      await db.personnel.deleteMany({ where: { id: personId } });
    }
    if (actorId) {
      await db.authSession.deleteMany({ where: { userId: actorId } });
      await db.recognizedBrowserProfile.deleteMany({ where: { userId: actorId } });
      await db.user.deleteMany({ where: { id: actorId } });
    }
  } finally { await db.$disconnect(); }
});

test('shadow initial review shows latest scan and saves inside or unknown without operational attendance', async ({ page }, testInfo) => {
  await db.attendanceTerminal.update({ where: { id: terminalId }, data: { mode: 'SHADOW', activatedAt: null } });
  await db.attendanceTerminalMapping.updateMany({ where: { terminalId }, data: { initialState: 'UNKNOWN' } });
  await page.context().addCookies([{ name: 'sabalan_session', value: sessionToken, url: 'http://localhost:3000', httpOnly: true, sameSite: 'Lax' }]);
  const response = await page.request.post(`http://127.0.0.1:5000/api/attendance-device/connector/${terminalId}/punches`, { headers: { Authorization: `Bearer ${terminalSecret}` }, data: { punches: [{ deviceCode: '1', occurredAt: new Date(Date.now() - 35000).toISOString(), verifyMode: 1, inOutRaw: 255 }], readOk: true, clockSample: { offsetMs: 35000, uncertaintyMs: 1050, measuredAt: new Date().toISOString() } } });
  expect(response.ok()).toBeTruthy();
  await page.goto('/dashboard/security/attendance');
  const card = page.locator(`[data-personnel-id="${personId}"]`);
  await expect(card.getByText(personName, { exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: /مرور وضعیت اولیه/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'قطع اتصال', exact: true })).toHaveCount(0);
  await expect(card.getByText(/آخرین اسکن امروز/)).toContainText('با جبران ساعت');
  await card.getByRole('button', { name: 'تعیین وضعیت اولیه', exact: true }).click();
  const initialDialog = page.getByRole('dialog', { name: `وضعیت اولیه ${personName}` });
  await expect(initialDialog).toBeVisible();
  const viewport = page.viewportSize()!;
  await expect.poll(async () => { const box = await initialDialog.boundingBox(); return Math.abs(box!.x + box!.width / 2 - viewport.width / 2); }).toBeLessThan(5);
  await expect.poll(async () => { const box = await initialDialog.boundingBox(); return Math.abs(box!.y + box!.height / 2 - viewport.height / 2); }).toBeLessThan(5);
  await initialDialog.getByLabel('وضعیت بررسی‌شده اولیه', { exact: true }).selectOption('INSIDE');
  await expect(initialDialog.getByLabel('زمان و مبنای بررسی', { exact: true })).toHaveCount(0);
  await initialDialog.getByRole('button', { name: 'ثبت وضعیت اولیه', exact: true }).click();
  await expect(card.getByText('داخل · وضعیت اولیه', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'تعیین وضعیت اولیه', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'بررسی تردد', exact: true }).click();
  const review = page.getByRole('dialog', { name: `بررسی تردد ${personName}` });
  await expect(review.getByText('دریافت مقایسه‌ای', { exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: 'ثبت به‌عنوان ورود', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await db.attendanceRecord.count({ where: { personnelId: personId } })).toBe(0);
  expect((await db.attendanceTerminal.findUniqueOrThrow({ where: { id: terminalId } })).mode).toBe('SHADOW');
  expect(await db.attendanceDeviceAudit.count({ where: { terminalId, action: 'INITIAL_STATE_REVIEWED' } })).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('shadow-initial-review-mobile.png') });
});

test('local machine delivery appears automatically, is confirmed by Guard and stays idempotent; mobile review is accessible', async ({ page }, testInfo) => {
  // The preceding shadow-review case uses this same isolated synthetic terminal.
  await db.attendancePunch.deleteMany({ where: { terminalId } });
  await db.attendanceDeviceAudit.deleteMany({ where: { terminalId, action: 'CLOCK_MEASURED' } });
  await db.attendanceTerminal.update({ where: { id: terminalId }, data: { mode: 'ACTIVE', activatedAt: new Date(Date.now() - 3600000) } });
  await db.attendanceTerminalMapping.updateMany({ where: { terminalId }, data: { initialState: 'OUTSIDE' } });
  await page.context().addCookies([{ name: 'sabalan_session', value: sessionToken, url: 'http://localhost:3000', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto('/dashboard/security/attendance');
  const panel = page.locator('#device-attendance');
  const card = page.locator(`[data-personnel-id="${personId}"]`);
  await expect(card).toBeVisible();
  const at = new Date(Date.now() - 1000).toISOString();
  const payload = { punches: [{ deviceCode: '1', occurredAt: at, verifyMode: 1, inOutRaw: 255 }], readOk: true, clockSample: { offsetMs: 0, uncertaintyMs: 1000, measuredAt: new Date().toISOString() } };
  const response = await page.request.post(`http://127.0.0.1:5000/api/attendance-device/connector/${terminalId}/punches`, { headers: { Authorization: `Bearer ${terminalSecret}` }, data: payload });
  expect(response.ok()).toBeTruthy();
  const checkbox = card.getByRole('checkbox', { name: /انتخاب بازه/ });
  await expect(checkbox).toBeVisible({ timeout: 5000 });
  const latencyMs = Date.now() - new Date(at).getTime();
  expect(latencyMs).toBeLessThan(5000);
  await testInfo.attach('local-simulated-punch-latency', { body: JSON.stringify({ latencyMs, source: 'simulated local HTTP punch; no physical SDK', limitMs: 5000 }), contentType: 'application/json' });
  await checkbox.check();
  await panel.getByRole('button', { name: /تأیید ۱ بازه انتخاب‌شده/ }).click();
  await expect(checkbox).toHaveCount(0);
  const interval = await db.attendanceInterval.findFirstOrThrow({ where: { attendanceRecord: { personnelId: personId } } });
  expect(interval.confirmedRevision).toBe(interval.revision);
  expect(interval.entryRecordedBy).toBeNull();
  const replay = await page.request.post(`http://127.0.0.1:5000/api/attendance-device/connector/${terminalId}/punches`, { headers: { Authorization: `Bearer ${terminalSecret}` }, data: payload });
  expect(replay.ok()).toBeTruthy();
  expect(await db.attendancePunch.count({ where: { terminalId } })).toBe(1);
  await card.getByRole('button', { name: 'بررسی تردد', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `بررسی تردد ${personName}` });
  await expect(dialog.getByText('تأییدشده', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  const axeDialog = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(axeDialog.violations.filter(v => ['critical', 'serious'].includes(v.impact || ''))).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'قطع اتصال', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  const axe = await new AxeBuilder({ page }).include('#device-attendance').analyze();
  expect(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact || ''))).toEqual([]);
  await card.screenshot({ path: testInfo.outputPath('attendance-device-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});


test('forgotten entry can have an unknown time, stays incomplete and opens correction in a centered modal', async ({ page }) => {
  await db.attendancePunch.deleteMany({ where: { terminalId } });
  await db.attendanceRecord.deleteMany({ where: { personnelId: personId } });
  await db.attendanceTerminal.update({ where: { id: terminalId }, data: { mode: 'SHADOW', activatedAt: null } });
  await page.context().addCookies([{ name: 'sabalan_session', value: sessionToken, url: 'http://localhost:3000', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto('/dashboard/security/attendance');
  const card = page.locator(`[data-personnel-id="${personId}"]`);
  await card.getByRole('button', { name: 'اصلاح ورود/خروج', exact: true }).click();
  const entry = page.getByRole('dialog', { name: 'ثبت ورود', exact: true });
  await entry.getByRole('checkbox', { name: 'داخل است؛ ساعت ورود نامعلوم', exact: true }).check();
  await expect(entry.getByRole('button', { name: 'ثبت', exact: true })).toBeDisabled();
  await entry.getByPlaceholder('مثلاً فراموشی ثبت در زمان واقعی').fill('ورود بدون اسکن؛ ساعت واقعی معلوم نیست');
  await entry.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(entry).not.toBeVisible();
  await expect(card.getByText('داخل مجموعه', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'جزئیات', exact: true }).click();
  await expect(card.getByText(/ورود با ساعت نامعلوم/)).toBeVisible();
  await expect(card.getByText('۰ دقیقه معلوم · ناقص', { exact: true })).toBeVisible();
  const interval = await db.attendanceInterval.findFirstOrThrow({ where: { attendanceRecord: { personnelId: personId } } });
  expect(interval.enteredAt).toBeNull(); expect(interval.observedInsideAt).not.toBeNull();
  await card.getByRole('button', { name: 'اصلاح ورود/خروج', exact: true }).click();
  const correction = page.getByRole('dialog', { name: 'اصلاح بازه تردد', exact: true });
  await expect(correction).toBeVisible();
  const viewport = page.viewportSize()!;
  await expect.poll(async () => { const box = await correction.boundingBox(); return Math.abs(box!.x + box!.width / 2 - viewport.width / 2); }).toBeLessThan(5);
  await expect(correction.getByRole('button', { name: 'ثبت اصلاح', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  expect((await db.attendanceTerminal.findUniqueOrThrow({ where: { id: terminalId } })).mode).toBe('SHADOW');
});


test('device mapping and review handover dialogs are centered and preserve comparison mode', async ({ page }, testInfo) => {
  await db.attendanceTerminal.update({ where: { id: terminalId }, data: { mode: 'SHADOW', activatedAt: null } });
  // Earlier cases deliberately create attendance for this isolated person.
  // Opening these dialogs must preserve it rather than assume an empty fixture.
  const beforeRecords = await db.attendanceRecord.count({ where: { personnelId: personId } });
  const beforeIntervals = await db.attendanceInterval.count({ where: { attendanceRecord: { personnelId: personId } } });
  await page.context().addCookies([{ name: 'sabalan_session', value: sessionToken, url: 'http://localhost:3000', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto('/dashboard/hr/attendance-devices');
  const terminal = page.getByText(`دستگاه آزمون ${key.slice(0,6)}`, { exact: true }).locator('../..');
  await terminal.getByRole('button', { name: 'افزودن یا تغییر اتصال فرد', exact: true }).click();
  const mapping = page.getByRole('dialog', { name: 'اتصال فرد به دستگاه', exact: true });
  const centered = async (dialog: typeof mapping) => {
    const viewport = page.viewportSize()!;
    await expect.poll(async () => { const box = await dialog.boundingBox(); return Math.abs(box!.x + box!.width / 2 - viewport.width / 2); }).toBeLessThan(5);
    await expect.poll(async () => { const box = await dialog.boundingBox(); return Math.abs(box!.y + box!.height / 2 - viewport.height / 2); }).toBeLessThan(5);
  };
  await expect(mapping).toBeVisible(); await centered(mapping);
  await page.screenshot({ path: testInfo.outputPath('mapping-centered-desktop.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'تحویل موارد به شیفت بعد', exact: true }).click();
  const handover = page.getByRole('dialog', { name: 'تحویل با مسئول پیگیری', exact: true });
  await expect(handover).toBeVisible(); await centered(handover);
  await page.screenshot({ path: testInfo.outputPath('handover-centered-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await centered(handover);
  await expect(handover.getByLabel('مسئول پیگیری', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.keyboard.press('Escape');
  await terminal.getByRole('button', { name: 'افزودن یا تغییر اتصال فرد', exact: true }).click();
  await centered(mapping);
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact || ''))).toEqual([]);
  await page.keyboard.press('Escape');
  const afterTerminal = await db.attendanceTerminal.findUniqueOrThrow({ where: { id: terminalId } });
  expect(afterTerminal.mode).toBe('SHADOW');
  expect(afterTerminal.activatedAt).toBeNull();
  expect(await db.attendanceRecord.count({ where: { personnelId: personId } })).toBe(beforeRecords);
  expect(await db.attendanceInterval.count({ where: { attendanceRecord: { personnelId: personId } } })).toBe(beforeIntervals);
});
