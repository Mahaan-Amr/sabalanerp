import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import securityRouter from '../../routes/security';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';

if (!process.env.DATABASE_URL?.includes('@127.0.0.1:55432/sabalanerp?')) throw new Error('Existing local Compose database only.');

test('manual attendance HTTP rejects future times, including overnight rollover and corrections, without changing history', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-21T07:59:30+03:30') });
  const key = randomUUID();
  const people: string[] = [];
  let actorId: string | undefined;
  const app = express(); app.use(express.json()); app.use('/api/security', securityRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local listener');
  try {
    const actor = await prisma.user.create({ data: { username: key, email: `${key}@example.invalid`, firstName: 'آزمون', lastName: 'زمان تردد', password: 'unused', role: 'ADMIN' } });
    actorId = actor.id;
    const session = await createAuthoritativeSession(prisma, actor.id, { userAgent: 'Local manual attendance time regression' });
    const call = (path: string, body: object, method = 'POST') => fetch(`http://127.0.0.1:${address.port}/api/security/attendance/${path}`, {
      method, headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${session.token}` }, body: JSON.stringify(body),
    });
    const person = async () => {
      const p = await prisma.personnel.create({ data: { firstName: 'آزمون زمان', lastName: key } }); people.push(p.id);
      await prisma.securityAttendanceRosterMembership.create({ data: { personnelId: p.id, effectiveFrom: new Date('2026-10-01T00:00:00Z'), createdBy: actor.id } });
      return p.id;
    };
    const rejected = async (response: Response, message: RegExp) => {
      assert.equal(response.status, 400);
      assert.match((await response.json() as { error: string }).error, message);
    };
    const first = await person();
    for (const body of [
      { date: '2026-10-21', entryTime: '08:00' },
      { date: '2026-10-22', entryTime: '00:00' },
    ]) await rejected(await call('checkin', { personnelId: first, ...body }), /آینده/);
    assert.equal(await prisma.attendanceRecord.count({ where: { personnelId: first } }), 0, 'rejected entries create no daily record');
    assert.equal((await call('checkin', { personnelId: first, date: '2026-10-21', entryTime: '07:59' })).status, 201, 'current minute is allowed');

    const second = await person();
    assert.equal((await call('checkin', { personnelId: second, date: '2026-10-21', entryTime: '07:58' })).status, 201, 'past entry is allowed');
    const open = await prisma.attendanceInterval.findFirstOrThrow({ where: { attendanceRecord: { personnelId: second } } });
    for (const body of [
      { date: '2026-10-21', exitTime: '08:00' },
      { date: '2026-10-22', exitTime: '00:00' },
    ]) await rejected(await call('checkout', { personnelId: second, attendanceId: open.attendanceRecordId, ...body }), /آینده/);
    assert.deepEqual(await prisma.attendanceInterval.findUniqueOrThrow({ where: { id: open.id } }), open, 'rejected exits do not update the interval');
    assert.equal((await call('checkout', { personnelId: second, date: '2026-10-21', exitTime: '07:59' })).status, 200, 'current minute exit is allowed');

    const third = await person();
    assert.equal((await call('checkin', { personnelId: third, date: '2026-10-20', entryTime: '17:06', reason: 'تردد واقعی روز قبل' })).status, 201);
    const overnight = await prisma.attendanceInterval.findFirstOrThrow({ where: { attendanceRecord: { personnelId: third } } });
    await rejected(await call('checkout', { personnelId: third, attendanceId: overnight.attendanceRecordId, date: '2026-10-20', exitTime: '17:00', reason: 'آزمون انتقال خودکار روز' }), /آینده/);
    assert.deepEqual(await prisma.attendanceInterval.findUniqueOrThrow({ where: { id: overnight.id } }), overnight, 'the original 17:06 / 17:00 regression must leave the interval open');
    assert.equal((await call('checkout', { personnelId: third, attendanceId: overnight.attendanceRecordId, date: '2026-10-20', exitTime: '07:58', reason: 'خروج واقعی صبح روز بعد' })).status, 200, 'past overnight exit is still allowed');
    assert.equal((await prisma.attendanceInterval.findUniqueOrThrow({ where: { id: overnight.id } })).exitedAt!.toISOString(), '2026-10-21T04:28:00.000Z');

    const saved = await prisma.attendanceInterval.findUniqueOrThrow({ where: { id: open.id } });
    for (const times of [
      { enteredAt: '2026-10-21T08:00:00+03:30', exitedAt: null },
      { enteredAt: '2026-10-21T07:58:00+03:30', exitedAt: '2026-10-21T08:00:00+03:30' },
    ]) await rejected(await call(`intervals/${open.id}`, { ...times, reason: 'آزمون اصلاح آینده' }, 'PUT'), /آینده/);
    assert.deepEqual(await prisma.attendanceInterval.findUniqueOrThrow({ where: { id: open.id } }), saved);
    assert.equal(await prisma.attendanceIntervalAudit.count({ where: { intervalId: open.id } }), 0, 'rejected corrections produce no audit or saved changes');
    assert.equal((await call(`intervals/${open.id}`, { enteredAt: '2026-10-21T07:57:00+03:30', exitedAt: '2026-10-21T07:58:00+03:30', reason: 'زمان واقعی گذشته' }, 'PUT')).status, 200, 'past correction is still allowed');

    const unknown = await person();
    await rejected(await call('checkin', { personnelId: unknown, date: '2026-10-22', entryUnknown: true, reason: 'مشاهده نامعتبر فردا' }), /فقط برای امروز/);
    assert.equal((await call('checkin', { personnelId: unknown, date: '2026-10-21', entryUnknown: true, reason: 'حضور فعلی با ساعت ورود نامعلوم' })).status, 201, 'current observation remains supported');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    try {
      await prisma.attendanceRecord.deleteMany({ where: { personnelId: { in: people } } });
      await prisma.securityAttendanceRosterMembership.deleteMany({ where: { personnelId: { in: people } } });
      await prisma.personnel.deleteMany({ where: { id: { in: people } } });
      if (actorId) {
        await prisma.authSession.deleteMany({ where: { userId: actorId } });
        await prisma.recognizedBrowserProfile.deleteMany({ where: { userId: actorId } });
        await prisma.user.delete({ where: { id: actorId } });
      }
    } finally { await prisma.$disconnect(); }
  }
});
