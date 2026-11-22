import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../backend/node_modules/@prisma/client';
import { createAuthoritativeSession, SESSION_COOKIE } from '../../backend/src/services/identitySessionService';
import { securityDateKeyFromInstant } from '../../backend/src/utils/securityBusinessDate';
import { assertNoHorizontalOverflow, setViewportAndZoom } from './support/design-system';

const db = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10' } } });
const key = randomUUID();
const name = `نمونه بررسی ${key.slice(0, 6)}`;
let actorId: string, personId: string, terminalId: string, token: string;
test.beforeAll(async () => {
  const actor = await db.user.create({ data: { username: `qa-day-review-${key}`, email: `${key}@example.invalid`, password: 'unused', firstName: 'آزمون', lastName: 'مرور تردد', role: 'ADMIN' } }); actorId = actor.id;
  const person = await db.personnel.create({ data: { firstName: 'نمونه بررسی', lastName: key.slice(0, 6) } }); personId = person.id;
  const today = securityDateKeyFromInstant(new Date());
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  await db.securityAttendanceRosterMembership.create({ data: { personnelId: personId, effectiveFrom: new Date(`${yesterday}T00:00:00Z`), createdBy: actorId } });
  const terminal = await db.attendanceTerminal.create({ data: { name: `دستگاه مقایسه‌ای آزمون ${key.slice(0, 6)}`, tokenHash: 'not-a-machine-secret', mode: 'SHADOW', createdBy: actorId } }); terminalId = terminal.id;
  await db.attendanceTerminalMapping.create({ data: { terminalId, deviceCode: 'QA', personnelId: personId, nameSnapshot: name, initialState: 'OUTSIDE', effectiveFrom: new Date(`${yesterday}T00:00:00Z`), createdBy: actorId } });
  const record = await db.attendanceRecord.create({ data: { personnelId: personId, date: new Date(`${yesterday}T00:00:00Z`), personnelFirstName: person.firstName, personnelLastName: person.lastName, status: 'PRESENT' } });
  for (let n = 0; n < 101; n++) {
    const start = new Date(Date.parse(`${yesterday}T00:00:00+03:30`) + n * 120000);
    await db.attendanceInterval.create({ data: { attendanceRecordId: record.id, enteredAt: start, exitedAt: new Date(start.getTime() + 60000), entryRecordedBy: actorId } });
  }
  await db.attendanceInterval.create({ data: { attendanceRecordId: record.id, enteredAt: new Date(`${yesterday}T08:00:00+03:30`), exitUnknown: true, exitSource: 'DAY_ROLLOVER', entrySource: 'DEVICE', confirmedRevision: 0 } });
  await db.attendancePunch.create({ data: { terminalId, eventKey: key, deviceCode: 'QA', personnelId: personId, nameSnapshot: name, occurredAt: new Date(Date.now() - 60000), correctedOccurredAt: new Date(Date.now() - 60000), receivedAt: new Date(), verifyMode: 1, inOutRaw: 255, status: 'REVIEW', reason: 'زمان این اسکن نیازمند بررسی است' } });
  token = (await createAuthoritativeSession(db, actorId, { userAgent: 'Local attendance review UI test' })).token;
});
test.afterAll(async () => {
  try {
    if (terminalId) {
      await db.attendancePunch.deleteMany({ where: { terminalId } }); await db.attendanceDeviceAudit.deleteMany({ where: { terminalId } });
      await db.attendanceTerminalMapping.deleteMany({ where: { terminalId } }); await db.attendanceTerminalPeriod.deleteMany({ where: { terminalId } }); await db.attendanceTerminal.delete({ where: { id: terminalId } });
    }
    if (personId) { await db.attendanceRecord.deleteMany({ where: { personnelId: personId } }); await db.securityAttendanceRosterMembership.deleteMany({ where: { personnelId: personId } }); await db.personnel.delete({ where: { id: personId } }); }
    if (actorId) { await db.authSession.deleteMany({ where: { userId: actorId } }); await db.recognizedBrowserProfile.deleteMany({ where: { userId: actorId } }); await db.user.delete({ where: { id: actorId } }); }
  } finally { await db.$disconnect(); }
});
test('actionable review stays clear despite 101 normal intervals; correction reuses the manual workflow', async ({ page }) => {
  await page.context().addCookies([{ name: SESSION_COOKIE, value: token, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  await page.goto('/dashboard/security/attendance');
  const card = page.locator(`[data-personnel-id="${personId}"]`);
  await card.getByRole('button', { name: 'بررسی تردد', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `بررسی تردد ${name}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'نیازمند رسیدگی', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('بازه ثبت‌شده', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('ساعت خروج ثبت نشده است', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/مانع ورود روز جدید یا تحویل شیفت نیست/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'تأیید این بازه', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('دلیل رسیدگی به این اسکن', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'رسیدگی به این اسکن', exact: true }).click();
  await expect(dialog.getByLabel('دلیل رسیدگی به این اسکن', { exact: true })).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'ثبت به‌عنوان ورود', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'بستن رسیدگی', exact: true }).click();
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ animations: 'disabled', path: '.codex-tmp/attendance/day-reset-2026-10-26/review-desktop.png' });
  await dialog.getByRole('button', { name: 'سوابق و شواهد', exact: true }).click();
  await expect(dialog.getByText('بازه ثبت‌شده', { exact: true }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'نیازمند رسیدگی', exact: true }).click();
  await expect(dialog.getByText('بازه ثبت‌شده', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'اصلاح ورود/خروج', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'اصلاح بازه تردد', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ثبت اصلاح', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'بررسی تردد', exact: true }).click();
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.setViewportSize({ width: 390, height: 844 }); await assertNoHorizontalOverflow(page);
  await expect(dialog.getByText(/مانع ورود روز جدید یا تحویل شیفت نیست/)).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ animations: 'disabled', path: '.codex-tmp/attendance/day-reset-2026-10-26/review-mobile.png' });
  await setViewportAndZoom(page, { width: 1440, height: 1000 }, 2); await assertNoHorizontalOverflow(page);
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ animations: 'disabled', path: '.codex-tmp/attendance/day-reset-2026-10-26/review-zoom.png' });
  expect((await db.attendanceTerminal.findUniqueOrThrow({ where: { id: terminalId } })).mode).toBe('SHADOW');
  expect(await db.attendanceInterval.count({ where: { attendanceRecord: { personnelId: personId } } })).toBe(102);
});
