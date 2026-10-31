import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import router from '../../routes/attendance-device';
import securityRouter from '../../routes/security';
import hrRouter from '../../routes/hr';
import { securityDateKeyFromInstant, securityNowTime } from '../../utils/securityBusinessDate';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';

if (!process.env.DATABASE_URL?.includes('@127.0.0.1:55432/sabalanerp?')) throw new Error('Local Compose database only.');

test('real HTTP: browser authority, terminal-scoped machine credential, replay and safe credential disclosure', async () => {
  const key = randomUUID();
  const users: string[] = [];
  const terminals: string[] = [];
  let shiftId: string | undefined;
  let personnelId: string | undefined;
  const app = express(); app.use(express.json()); app.use('/api/attendance-device', router); app.use('/api/security', securityRouter); app.use('/api/hr', hrRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local listener');
  const base = `http://127.0.0.1:${address.port}/api/attendance-device`;
  try {
    const admin = await prisma.user.create({ data: { username: `attendance-admin-${key}`, email: `attendance-admin-${key}@example.invalid`, firstName: 'آزمون', lastName: 'مدیر', password: 'unused', role: 'ADMIN' } }); users.push(admin.id);
    const viewer = await prisma.user.create({ data: { username: `attendance-viewer-${key}`, email: `attendance-viewer-${key}@example.invalid`, firstName: 'آزمون', lastName: 'بدون اختیار', password: 'unused', role: 'USER' } }); users.push(viewer.id);
    const session = await createAuthoritativeSession(prisma, admin.id, { userAgent: 'Local attendance acceptance' });
    const viewerSession = await createAuthoritativeSession(prisma, viewer.id, { userAgent: 'Local attendance acceptance' });
    const cookie = `${SESSION_COOKIE}=${session.token}`;
    const call = (path: string, body?: object, credential?: string, browserCookie?: string) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(browserCookie ? { Cookie: browserCookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await call('/state')).status, 401);
    assert.equal((await call('/terminals', { name: key }, undefined, `${SESSION_COOKIE}=${viewerSession.token}`)).status, 403);
    assert.equal((await call('/intervals/not-found/correction-preview', { action: 'VOID', reason: 'بدون اختیار' }, undefined, `${SESSION_COOKIE}=${viewerSession.token}`)).status, 403);
    const created = await call('/terminals', { name: key }, undefined, cookie); assert.equal(created.status, 200);
    const terminal = (await created.json() as { data: any }).data; terminals.push(terminal.id);
    assert.match(terminal.token, /^[a-f0-9]{64}$/); assert.equal(terminal.mode, 'SHADOW'); assert.equal(terminal.tokenHash, undefined);
    const second = (await (await call('/terminals', { name: `${key}-other` }, undefined, cookie)).json() as { data: any }).data; terminals.push(second.id);
    assert.equal((await call(`/connector/${second.id}/punches`, { punches: [] }, terminal.token)).status, 401);
    assert.equal((await call(`/connector/${terminal.id}/punches`, { punches: [] }, undefined, cookie)).status, 401);
    const payload = { punches: [{ deviceCode: 'QA1', occurredAt: new Date(Date.now() - 5000).toISOString(), verifyMode: 1, inOutRaw: 255 }], readOk: true };
    const first = await call(`/connector/${terminal.id}/punches`, payload, terminal.token); assert.equal(first.status, 200);
    const replay = await call(`/connector/${terminal.id}/punches`, payload, terminal.token); assert.equal(replay.status, 200);
    assert.equal(await prisma.attendancePunch.count({ where: { terminalId: terminal.id } }), 1);
    const listed = (await (await call('/state', undefined, undefined, cookie)).json() as { data: any }).data;
    assert.equal(listed.terminals.find((t: any) => t.id === terminal.id).tokenHash, undefined);
    assert.equal(listed.terminals.find((t: any) => t.id === terminal.id).token, undefined);
    assert.ok(listed.terminals.find((t: any) => t.id === terminal.id).lastReadAt);
    assert.equal((await call(`/terminals/${terminal.id}/mode`, { mode: 'ACTIVE', reason: 'بدون وضعیت اولیه' }, undefined, cookie)).status, 400);
    const concurrentPayload = { punches: [{ ...payload.punches[0], deviceCode: 'CONCURRENT' }], readOk: true };
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => call(`/connector/${terminal.id}/punches`, concurrentPayload, terminal.token)));
    assert.ok(concurrent.every(r => [200, 409].includes(r.status)));
    assert.equal((await call(`/connector/${terminal.id}/punches`, concurrentPayload, terminal.token)).status, 200);
    assert.equal(await prisma.attendancePunch.count({ where: { terminalId: terminal.id, deviceCode: 'CONCURRENT' } }), 1);
    const shift = await prisma.shift.create({ data: { name: key, namePersian: key, startTime: '19:00', endTime: '07:00', duration: 720 } }); shiftId = shift.id;
    await prisma.securityPersonnel.create({ data: { userId: viewer.id, shiftId, position: 'آزمون گارد' } });
    await prisma.workspacePermission.create({ data: { userId: viewer.id, workspace: 'security', permissionLevel: 'view' } });
    const viewerCookie = `${SESSION_COOKIE}=${viewerSession.token}`;
    assert.equal((await call('/confirm', { intervals: [] }, undefined, viewerCookie)).status, 400, 'every active guard can review; malformed selection still rejected');
    assert.equal((await call('/terminals', { name: key }, undefined, viewerCookie)).status, 403, 'guard cannot manage mappings or credentials');
    assert.equal((await call('/mappings/nonexistent/initial-state', { initialState: 'INSIDE', expectedInitialState: 'UNKNOWN', reason: 'بدون مجوز مدیریت' }, undefined, viewerCookie)).status, 403, 'ordinary guard cannot change the management-owned initial baseline');
    const securityCall = (path: string, body: object, authCookie = cookie, method = 'POST') => fetch(base.replace('/attendance-device', '/security') + path, { method, headers: { 'Content-Type': 'application/json', Cookie: authCookie }, body: JSON.stringify(body) });
    assert.equal((await securityCall('/reports/personnel-attendance-preview', {}, viewerCookie)).status, 403, 'guard report authority unchanged');
    const restCall = (path: string, body: object, authCookie = viewerCookie) => fetch(base.replace('/attendance-device', '/hr/personnel-attendance-rest') + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: authCookie }, body: JSON.stringify(body) });
    assert.equal((await restCall('/policies', { effectiveDate: '2098-01-01', startTime: '13:00', endTime: '14:00', reason: 'آزمون بدون مجوز' })).status, 403, 'guard attendance authority grants no rest-policy management');
    assert.equal((await restCall('/assignments', { effectiveDate: '2098-01-01', personnelIds: [], hasRest: true, reason: 'آزمون بدون مجوز' })).status, 403);
    const restState = await fetch(base.replace('/attendance-device', '/hr/personnel-attendance-rest'), { headers: { Cookie: cookie } });
    assert.equal(restState.status, 200); assert.equal((await restState.json() as { data: { canEdit: boolean } }).data.canEdit, true, 'configuration UI and actual admin action authority agree');
    assert.equal((await restCall('/policies', { effectiveDate: '2026-02-30', startTime: '13:00', endTime: '14:00', reason: 'آزمون تاریخ نامعتبر' }, cookie)).status, 400, 'admin validation rejects invalid/backdated cutover without changing policy');
    assert.equal((await call('/absence-decisions', { confirmedAbsent: true }, undefined, viewerCookie)).status, 400, 'guard factual review requires exact source evidence and reason');

    const person = await prisma.personnel.create({ data: { firstName: 'ورود نامعلوم', lastName: key } }); personnelId = person.id;
    const date = securityDateKeyFromInstant(new Date());
    await prisma.securityAttendanceRosterMembership.create({ data: { personnelId, effectiveFrom: new Date(`${date}T00:00:00Z`), createdBy: admin.id } });
    assert.equal((await securityCall('/attendance/checkin', { personnelId, date, entryUnknown: true })).status, 400, 'unknown entry requires a reason');
    const unknown = await securityCall('/attendance/checkin', { personnelId, date, entryUnknown: true, reason: 'ورود فراموش‌شده؛ ساعت معلوم نیست' });
    assert.equal(unknown.status, 201);
    const interval = await prisma.attendanceInterval.findFirstOrThrow({ where: { attendanceRecord: { personnelId } } });
    assert.equal(interval.enteredAt, null); assert.ok(interval.observedInsideAt);
    // Move only the isolated test observation back two minutes to exercise a real manual exit.
    await prisma.attendanceInterval.update({ where: { id: interval.id }, data: { observedInsideAt: new Date(Date.now() - 120000) } });
    assert.equal((await securityCall('/attendance/checkout', { personnelId, date, exitTime: securityNowTime(), reason: 'خروج واقعی' })).status, 200);
    const closed = await prisma.attendanceInterval.findUniqueOrThrow({ where: { id: interval.id } });
    assert.equal(closed.enteredAt, null); assert.ok(closed.exitedAt);
    const report = await securityCall('/reports/personnel-attendance-preview', { startDate: date, endDate: date, personnelIds: [personnelId] });
    assert.equal(report.status, 200);
    const reported = (await report.json() as { data: any }).data.people[0];
    assert.equal(reported.durationUnknown, true); assert.equal(reported.grossMinutes, 0);
    assert.equal((await securityCall(`/attendance/intervals/${interval.id}`, { enteredAt: new Date(Date.now() - 3600000).toISOString(), exitedAt: closed.exitedAt!.toISOString(), reason: 'ساعت واقعی پس از بررسی مشخص شد' }, cookie, 'PUT')).status, 200);
    assert.equal((await prisma.attendanceInterval.findUniqueOrThrow({ where: { id: interval.id } })).confirmedRevision, 0);

    const cmd = { action: 'UNKNOWN_EXIT', reason: 'خروج تأیید شد؛ زمان قبلی مورد اعتماد نیست' };
    const previewPath = `/intervals/${interval.id}/correction-preview`;
    assert.equal((await call(previewPath, cmd)).status, 401);
    assert.equal((await call(previewPath, cmd, terminal.token)).status, 401, 'reader cannot correct attendance');
    const savedForReview = await prisma.attendanceInterval.findUniqueOrThrow({ where: { id: interval.id } });
    await prisma.attendanceInterval.update({ where: { id: interval.id }, data: { confirmedRevision: savedForReview.revision } });
    const history = await call(`/state?personnelId=${personnelId}&status=all`, undefined, undefined, viewerCookie);
    assert.ok((await history.json() as { data: any }).data.intervals.some((i: any) => i.id === interval.id), 'person history includes existing intervals for correction');
    const auditsBefore = await prisma.attendanceIntervalAudit.count({ where: { intervalId: interval.id } });
    const previewResponse = await call(previewPath, cmd, undefined, viewerCookie);
    assert.equal(previewResponse.status, 200, 'all active guards may review corrections');
    const preview = (await previewResponse.json() as { data: any }).data;
    assert.equal(await prisma.attendanceIntervalAudit.count({ where: { intervalId: interval.id } }), auditsBefore, 'preview remains read-only');
    assert.equal((await call(`/intervals/${interval.id}/correction`, { ...cmd, ...preview, confirmApply: true }, undefined, viewerCookie)).status, 400);
    assert.equal((await call(`/intervals/${interval.id}/unknown-exit`, { reason: cmd.reason }, undefined, viewerCookie)).status, 409, 'legacy path cannot bypass preview');
    assert.equal((await securityCall(`/attendance/intervals/${interval.id}/void`, { reason: cmd.reason }, viewerCookie)).status, 409, 'legacy void cannot bypass preview');
    const apply = { ...cmd, ...preview, facts: { entryReviewed: true, departureConfirmed: true }, confirmApply: true };
    const race = await Promise.all([call(`/intervals/${interval.id}/correction`, apply, undefined, viewerCookie), call(`/intervals/${interval.id}/correction`, apply, undefined, viewerCookie)]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409], 'only one concurrent correction commits');
    assert.equal(await prisma.attendanceIntervalAudit.count({ where: { intervalId: interval.id, action: 'UNKNOWN_EXIT' } }), 1);
    const unknownAgain = await prisma.attendanceInterval.findUniqueOrThrow({ where: { id: interval.id } });
    assert.equal(unknownAgain.exitedAt, null); assert.equal(unknownAgain.exitUnknown, true);
    const incomplete = await securityCall('/reports/personnel-attendance-preview', { startDate: date, endDate: date, personnelIds: [personnelId] });
    assert.equal((await incomplete.json() as { data: any }).data.people[0].durationUnknown, true);

    const pendingState = await call(`/state?personnelId=${personnelId}&status=pending`, undefined, undefined, cookie);
    assert.equal(pendingState.status, 200);
    const pendingData = (await pendingState.json() as { data: any }).data;
    assert(pendingData.intervals.some((i: any) => i.id === interval.id), 'Unknown exits remain in the actionable list');
    // Filter before pagination: many recent ordinary intervals must not hide an older unresolved one.
    const ordinaryRecord = await prisma.attendanceRecord.create({ data: { personnelId, date: new Date('2097-01-01T00:00:00Z'), status: 'PRESENT' } });
    for (let n = 0; n < 101; n++) {
      await prisma.attendanceInterval.create({ data: { attendanceRecordId: ordinaryRecord.id, enteredAt: new Date(Date.parse('2097-01-01T00:00:00Z') + n * 120000), exitedAt: new Date(Date.parse('2097-01-01T00:01:00Z') + n * 120000), entryRecordedBy: admin.id } });
    }
    const filtered = (await (await call(`/state?personnelId=${personnelId}&status=pending`, undefined, undefined, cookie)).json() as { data: any }).data;
    assert(filtered.intervals.some((i: any) => i.id === interval.id));
    assert(filtered.intervals.every((i: any) => i.exitUnknown || !i.enteredAt || !i.exitedAt));
    const pagedHistory = (await (await call(`/state?personnelId=${personnelId}&status=all`, undefined, undefined, cookie)).json() as { data: any }).data;
    assert.equal(pagedHistory.intervals.length, 100);
    await prisma.attendanceRecord.delete({ where: { id: ordinaryRecord.id } });

    const before = new Date(Date.now() - 3600000);
    await prisma.attendanceTerminal.update({ where: { id: terminal.id }, data: { mode: 'ACTIVE', activatedAt: before } });
    await prisma.attendanceTerminalPeriod.updateMany({ where: { terminalId: terminal.id }, data: { mode: 'ACTIVE', startsAt: before } });
    await prisma.attendanceTerminalMapping.create({ data: { terminalId: terminal.id, deviceCode: 'CLOCK_INVALID', personnelId, nameSnapshot: 'آزمون ساعت', initialState: 'OUTSIDE', effectiveFrom: before, createdBy: admin.id } });
    const invalidClock = await call(`/connector/${terminal.id}/punches`, { readOk: true, punches: [{ deviceCode: 'CLOCK_INVALID', occurredAt: new Date(Date.now() - 5000).toISOString(), verifyMode: 1, inOutRaw: 255 }], clockSample: { offsetMs: 35000, uncertaintyMs: 15001, measuredAt: new Date().toISOString() } }, terminal.token);
    assert.equal(invalidClock.status, 200, 'bad clock sample must not discard device evidence');
    assert.equal((await invalidClock.json() as { data: any }).data.accepted[0].status, 'REVIEW');
    assert.equal(await prisma.attendanceInterval.count({ where: { attendanceRecord: { personnelId } } }), 1, 'bad clock sample creates no operational interval');
    await prisma.securityPersonnel.update({ where: { userId: viewer.id }, data: { isActive: false } });
    assert.equal((await call('/confirm', { intervals: [] }, undefined, viewerCookie)).status, 403);

  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    try {
      await prisma.attendancePunch.deleteMany({ where: { terminalId: { in: terminals } } });
      await prisma.attendanceDeviceAudit.deleteMany({ where: { terminalId: { in: terminals } } });
      await prisma.attendanceTerminalMapping.deleteMany({ where: { terminalId: { in: terminals } } });
      await prisma.attendanceTerminalPeriod.deleteMany({ where: { terminalId: { in: terminals } } });
      await prisma.attendanceTerminal.deleteMany({ where: { id: { in: terminals } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: users } } });
      await prisma.recognizedBrowserProfile.deleteMany({ where: { userId: { in: users } } });
      await prisma.securityPersonnel.deleteMany({ where: { userId: { in: users } } });
      if (personnelId) {
        await prisma.attendanceRecord.deleteMany({ where: { personnelId } });
        await prisma.securityAttendanceRosterMembership.deleteMany({ where: { personnelId } });
        await prisma.personnel.delete({ where: { id: personnelId } });
      }
      if (shiftId) await prisma.shift.delete({ where: { id: shiftId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    } finally { await prisma.$disconnect(); }
  }
});
