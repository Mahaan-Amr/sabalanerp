import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { confirmIntervals, ingestPunch as ingestRaw, lockAttendance, markUnknownExit, resolvePunch, tokenHash, validatePunch, todayMappingScans, setMappingInitialState, recordDeviceClockSample } from '../attendanceDevice';

if (!process.env.DATABASE_URL?.includes('@127.0.0.1:55432/sabalanerp?')) throw new Error('Only sabalanerp-local is allowed.');
const client = new PrismaClient();
test.after(async () => { await client.$disconnect(); });
const rollback = new Error('isolated attendance fixture rollback');
const day = new Date('2026-10-15T00:00:00.000Z');
const at = (clock: string) => new Date(`2026-10-15T${clock}:00+03:30`);
const now = new Date('2026-10-17T12:00:00.000Z');
// Simulated live receipt: each operational-rule test supplies a contemporaneous zero-offset sample.
// Missing/stale clock behavior is exercised separately against ingestRaw.
const ingestPunch: typeof ingestRaw = async (db, terminalId, input) => {
  const received = new Date(Date.parse(input.occurredAt) + 2000);
  await db.attendanceDeviceAudit.create({ data: { terminalId, actorId: 'isolated-clock-fixture', action: 'CLOCK_MEASURED', reason: 'simulated contemporaneous measurement', evidence: { offsetMs: 0, uncertaintyMs: 1000, measuredAt: received.toISOString() } } });
  return ingestRaw(db, terminalId, input, received);
};
const fixture = async (work: (db: Prisma.TransactionClient, f: any) => Promise<void>, attempt = 0): Promise<void> => {
  try {
    await client.$transaction(async db => {
      await lockAttendance(db);
      const key = randomUUID();
      const actor = await db.user.create({ data: { email: `${key}@example.invalid`, username: key, password: 'unused-test-password', firstName: 'نگهبان', lastName: 'آزمون', role: 'ADMIN' } });
      const person = await db.personnel.create({ data: { firstName: 'پرسنل', lastName: key } });
      const terminal = await db.attendanceTerminal.create({ data: { name: key, tokenHash: tokenHash(key), mode: 'ACTIVE', activatedAt: at('06:00'), createdBy: actor.id } });
      await db.attendanceTerminalPeriod.create({ data: { terminalId: terminal.id, mode: 'ACTIVE', startsAt: at('06:00') } });
      const mapping = await db.attendanceTerminalMapping.create({ data: { terminalId: terminal.id, deviceCode: '1', personnelId: person.id, nameSnapshot: 'پرسنل آزمون', initialState: 'OUTSIDE', effectiveFrom: at('06:00'), createdBy: actor.id } });
      await db.securityAttendanceRosterMembership.create({ data: { personnelId: person.id, effectiveFrom: day, createdBy: actor.id } });
      const punch = (clock: string, code = '1') => ingestPunch(db, terminal.id, { deviceCode: code, occurredAt: at(clock).toISOString(), verifyMode: 1, inOutRaw: 255 }, now);
      await work(db, { actor, person, terminal, mapping, punch });
      throw rollback;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034' && attempt < 4) return fixture(work, attempt + 1); if (e !== rollback) throw e; }
};

test('named shadow history survives replay and later activation without becoming operational attendance', () => fixture(async (db, f) => {
  await db.attendanceTerminal.update({ where: { id: f.terminal.id }, data: { mode: 'SHADOW', activatedAt: null } });
  await db.attendanceTerminalPeriod.updateMany({ where: { terminalId: f.terminal.id }, data: { mode: 'SHADOW' } });
  const original = await f.punch('08:00');
  assert.equal(original.status, 'SHADOW');
  assert.equal(original.personnelId, f.person.id);
  assert.equal(original.nameSnapshot, 'پرسنل آزمون');
  assert.equal(original.direction, null);
  assert.equal(original.intervalId, null);
  assert.equal((await f.punch('08:00')).id, original.id);
  assert.equal(await db.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
  assert.equal(await db.attendancePunch.count({ where: { terminalId: f.terminal.id } }), 1);

  // Replaying already received comparison evidence after a future cutover must not
  // convert it into an entry/exit or revise its original timestamps or identity.
  await db.attendanceTerminal.update({ where: { id: f.terminal.id }, data: { mode: 'ACTIVE', activatedAt: at('09:00') } });
  await db.attendanceTerminalPeriod.updateMany({ where: { terminalId: f.terminal.id }, data: { endsAt: at('09:00') } });
  await db.attendanceTerminalPeriod.create({ data: { terminalId: f.terminal.id, mode: 'ACTIVE', startsAt: at('09:00') } });
  const replayed = await f.punch('08:00');
  assert.deepEqual(replayed, original);
  assert.equal(await db.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
}));

test('machine entry/exit has no fabricated human recorder; confirmation is revision-bound and audited', () => fixture(async (db, f) => {
  const first = await f.punch('08:00');
  const entered = await db.attendanceInterval.findUniqueOrThrow({ where: { id: first.intervalId } });
  assert.equal(entered.entryRecordedBy, null); assert.equal(entered.entrySource, 'DEVICE'); assert.equal(entered.confirmedRevision, 0);
  assert.equal(first.nameSnapshot, 'پرسنل آزمون');
  await confirmIntervals(db, [{ id: entered.id, revision: 1 }], f.actor.id);
  const last = await f.punch('17:00');
  assert.equal(last.direction, 'EXIT');
  const closed = await db.attendanceInterval.findUniqueOrThrow({ where: { id: entered.id } });
  assert.equal(closed.revision, 2); assert.equal(closed.confirmedRevision, 0);
  await assert.rejects(confirmIntervals(db, [{ id: entered.id, revision: 1 }], f.actor.id), /تغییر کرده/);
  await confirmIntervals(db, [{ id: entered.id, revision: 2 }], f.actor.id);
  assert.equal(await db.attendanceIntervalAudit.count({ where: { intervalId: entered.id, action: 'CONFIRMED' } }), 2);
}));
test('replayed source is idempotent and 10-second repeated scan does not change direction', () => fixture(async (db, f) => {
  const first = await f.punch('08:00');
  const replay = await f.punch('08:00'); assert.equal(first.id, replay.id);
  const second = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: new Date(at('08:00').getTime() + 10000).toISOString(), verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(second.status, 'DUPLICATE'); assert.equal(second.direction, null);
  const next = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: new Date(at('08:00').getTime() + 11000).toISOString(), verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(next.direction, 'EXIT');
}));
test('yesterday 09 -> today 07 enters the new day and leaves an audited unknown exit, with no fabricated human signature', () => fixture(async (db, f) => {
  const first = await f.punch('09:00');
  const next = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T07:00:00+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(next.status, 'APPLIED'); assert.equal(next.direction, 'ENTRY');
  const old = await db.attendanceInterval.findUniqueOrThrow({ where: { id: first.intervalId } });
  assert.equal(old.exitUnknown, true); assert.equal(old.exitedAt, null); assert.equal(old.exitSource, 'DAY_ROLLOVER'); assert.equal(old.exitRecordedBy, null);
  assert.equal(old.confirmedBy, null); assert.equal(old.confirmedRevision, 0);
  const current = await db.attendanceInterval.findUniqueOrThrow({ where: { id: next.intervalId! }, include: { attendanceRecord: true } });
  assert.equal(current.attendanceRecord.date.toISOString().slice(0, 10), '2026-10-16');
  const audit = await db.attendanceIntervalAudit.findFirstOrThrow({ where: { intervalId: old.id, action: 'SYSTEM_DAY_ROLLOVER' } });
  assert.equal((audit.afterData as any).automation.actorType, 'SYSTEM');
  const third = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T17:00:00+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(third.direction, 'EXIT');
  assert.equal(await db.attendanceIntervalAudit.count({ where: { intervalId: old.id, action: 'SYSTEM_DAY_ROLLOVER' } }), 1);
  assert.equal((await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T07:00:00+03:30', verifyMode: 1, inOutRaw: 255 }, now)).id, next.id);
}));
test('unknown departure permits a later entry and keeps previous duration unknown without inventing an exit', () => fixture(async (db, f) => {
  const first = await f.punch('08:00');
  await markUnknownExit(db, first.intervalId, 'خروج رخ داده ولی ساعت معلوم نیست', f.actor.id);
  const old = await db.attendanceInterval.findUniqueOrThrow({ where: { id: first.intervalId } });
  assert.equal(old.exitedAt, null); assert.equal(old.exitUnknown, true);
  const next = await f.punch('13:00'); assert.equal(next.direction, 'ENTRY');
  const record = await db.attendanceRecord.findUniqueOrThrow({ where: { id: old.attendanceRecordId } });
  assert.equal(record.overtimeMinutes, null); assert.equal(record.overtimePending, true);
}));
test('late device evidence links manual entry within two minutes without changing manual time', () => fixture(async (db, f) => {
  const record = await db.attendanceRecord.create({ data: { personnelId: f.person.id, date: day, status: 'PRESENT' } });
  const manual = await db.attendanceInterval.create({ data: { attendanceRecordId: record.id, enteredAt: at('08:00'), entryRecordedBy: f.actor.id } });
  const p = await f.punch('08:02'); assert.equal(p.status, 'LINKED'); assert.equal(p.intervalId, manual.id);
  assert.equal((await db.attendanceInterval.findUniqueOrThrow({ where: { id: manual.id } })).enteredAt!.toISOString(), at('08:00').toISOString());
  assert.equal(await db.attendanceInterval.count({ where: { attendanceRecordId: record.id } }), 1);
}));
test('out-of-order evidence beyond manual match window remains reviewable', () => fixture(async (db, f) => {
  await f.punch('08:00'); await f.punch('17:00');
  const late = await f.punch('13:00'); assert.equal(late.status, 'REVIEW'); assert.match(late.reason || '', /دیررس/);
}));
test('ignored and unmatched codes never create attendance', () => fixture(async (db, f) => {
  await db.attendanceTerminalMapping.create({ data: { terminalId: f.terminal.id, deviceCode: '7', ignored: true, effectiveFrom: at('06:00'), createdBy: f.actor.id } });
  assert.equal((await f.punch('08:00', '7')).status, 'IGNORED');
  assert.equal((await f.punch('08:00', '99')).status, 'UNMATCHED');
  assert.equal(await db.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
}));
test('historical mapping keeps original identity after reassignment and rename', () => fixture(async (db, f) => {
  await db.attendanceTerminalMapping.update({ where: { id: f.mapping.id }, data: { effectiveTo: at('12:00') } });
  const other = await db.personnel.create({ data: { firstName: 'دیگر', lastName: randomUUID() } });
  await db.attendanceTerminalMapping.create({ data: { terminalId: f.terminal.id, deviceCode: '1', personnelId: other.id, nameSnapshot: 'فرد دوم', initialState: 'OUTSIDE', effectiveFrom: at('12:00'), createdBy: f.actor.id } });
  await db.personnel.update({ where: { id: f.person.id }, data: { firstName: 'نام جدید' } });
  const old = await f.punch('08:00'); assert.equal(old.personnelId, f.person.id); assert.equal(old.nameSnapshot, 'پرسنل آزمون');
  const recent = await f.punch('14:00'); assert.equal(recent.personnelId, other.id); assert.equal(recent.nameSnapshot, 'فرد دوم');
}));
test('paused period backlog is held even after resuming; spontaneous outage active-period backlog is processed', () => fixture(async (db, f) => {
  await db.attendanceTerminalPeriod.updateMany({ where: { terminalId: f.terminal.id }, data: { endsAt: at('09:00') } });
  await db.attendanceTerminalPeriod.create({ data: { terminalId: f.terminal.id, mode: 'PAUSED', startsAt: at('09:00'), endsAt: at('10:00') } });
  await db.attendanceTerminalPeriod.create({ data: { terminalId: f.terminal.id, mode: 'ACTIVE', startsAt: at('10:00') } });
  assert.equal((await f.punch('08:00')).status, 'APPLIED');
  assert.equal((await f.punch('09:30')).status, 'REVIEW');
  assert.equal((await f.punch('12:00')).status, 'REVIEW');
}));
test('first unknown/inside state and pre-start history do not fabricate entry', () => fixture(async (db, f) => {
  await db.attendanceTerminalMapping.update({ where: { id: f.mapping.id }, data: { initialState: 'INSIDE', effectiveFrom: at('05:00') } });
  assert.equal((await f.punch('05:30')).status, 'BEFORE_START');
  assert.equal((await f.punch('08:00')).status, 'REVIEW');
  assert.equal(await db.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
}));
test('device data requires explicit timezone and rejects future instants', () => {
  assert.throws(() => validatePunch({ deviceCode: '1', occurredAt: '2026-10-15T08:00:00', verifyMode: 1, inOutRaw: 255 }, now), /معتبر/);
  assert.throws(() => validatePunch({ deviceCode: '1', occurredAt: '2099-01-01T00:00:00Z', verifyMode: 1, inOutRaw: 255 }, now), /آینده/);
});

test('no roster membership never becomes automatic attendance', () => fixture(async (db, f) => {
  await db.securityAttendanceRosterMembership.deleteMany({ where: { personnelId: f.person.id } });
  const p = await f.punch('08:00'); assert.equal(p.status, 'REVIEW'); assert.match(p.reason || '', /فهرست گارد/);
  assert.equal(await db.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
}));

test('guard handover records a specific pending snapshot; new evidence requires renewed handover', () => fixture(async (db, f) => {
  const { requireReviewHandover, reviewFingerprint } = await import('../attendanceDevice');
  const first = await f.punch('08:00');
  const baseline = await reviewFingerprint(db);
  await db.attendanceReviewHandover.create({ data: { actorId: f.actor.id, assigneeId: 'isolated-next-guard', reason: 'acknowledge existing local cases', pendingCount: baseline.count, evidenceHash: baseline.hash } });
  await requireReviewHandover(db, f.actor.id); // Ordinary system acceptance needs no separate signature.
  await db.attendancePunch.update({ where: { id: first.id }, data: { status: 'REVIEW', reason: 'ابهام آزمایشی' } });
  await assert.rejects(requireReviewHandover(db, f.actor.id), /پیش از تحویل/);
  const pending = await reviewFingerprint(db);
  await db.attendanceReviewHandover.create({ data: { actorId: f.actor.id, assigneeId: 'isolated-next-guard', reason: 'تحویل برای پیگیری', pendingCount: pending.count, evidenceHash: pending.hash } });
  await requireReviewHandover(db, f.actor.id);
  const next = await f.punch('17:00');
  await db.attendancePunch.update({ where: { id: next.id }, data: { status: 'REVIEW', reason: 'ابهام تازه' } });
  await assert.rejects(requireReviewHandover(db, f.actor.id), /پیش از تحویل/);
}));

test('database refuses overlap even if a manual writer bypasses application prechecks', () => fixture(async (db, f) => {
  const first = await f.punch('08:00');
  await db.$executeRawUnsafe('SAVEPOINT overlap_test');
  try {
    await assert.rejects(db.attendanceInterval.create({ data: { attendanceRecordId: (await db.attendanceInterval.findUniqueOrThrow({ where: { id: first.intervalId } })).attendanceRecordId, enteredAt: at('09:00'), entryRecordedBy: f.actor.id } }), /attendance_interval_overlap/);
  } finally { await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT overlap_test'); }
}));

test('an active guard is not automatically clocked by the terminal', () => fixture(async (db, f) => {
  await db.user.update({ where: { id: f.actor.id }, data: { personnelId: f.person.id } });
  const shift = await db.shift.create({ data: { name: randomUUID(), namePersian: randomUUID(), startTime: '19:00', endTime: '07:00', duration: 720 } });
  await db.securityPersonnel.create({ data: { userId: f.actor.id, shiftId: shift.id, position: 'گارد آزمون' } });
  assert.equal((await f.punch('08:00')).status, 'IGNORED');
  assert.equal(await db.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
  assert.equal(await db.securityShiftAttendance.count({ where: { personnel: { userId: f.actor.id } } }), 0);
}));

test('a fresh mapping cannot infer initial direction from stale earlier-day closed records', () => fixture(async (db, f) => {
  const old = await db.attendanceRecord.create({ data: { personnelId: f.person.id, date: new Date('2026-10-14T00:00:00Z'), status: 'PRESENT' } });
  await db.attendanceInterval.create({ data: { attendanceRecordId: old.id, enteredAt: new Date('2026-10-14T08:00:00+03:30'), exitedAt: new Date('2026-10-14T17:00:00+03:30'), entryRecordedBy: f.actor.id } });
  await db.attendanceTerminalMapping.update({ where: { id: f.mapping.id }, data: { initialState: 'INSIDE' } });
  assert.equal((await f.punch('08:00')).status, 'REVIEW');
}));


test('today initial-review summary uses Tehran occurrence date independently of the 100-row evidence page', () => fixture(async (db, f) => {
  await db.attendanceTerminal.update({ where: { id: f.terminal.id }, data: { mode: 'SHADOW', activatedAt: null } });
  await db.attendanceTerminalMapping.update({ where: { id: f.mapping.id }, data: { effectiveFrom: new Date('2026-10-13T20:30:00Z') } });
  for (let i = 0; i < 101; i++) {
    const occurredAt = new Date(at('06:00').getTime() + i * 60000).toISOString();
    await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt, verifyMode: 1, inOutRaw: 255 }, now);
  }
  for (const occurredAt of ['2026-10-14T20:29:59Z', '2026-10-15T20:30:00Z']) {
    await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt, verifyMode: 1, inOutRaw: 255 }, now);
  }
  const summary = await todayMappingScans(db, new Date('2026-10-15T12:00:00Z'));
  assert.equal(summary.dateKey, '2026-10-15');
  const row = summary.rows.find(row => row.mappingId === f.mapping.id)!;
  assert.equal(row.scanCount, 101);
  assert.equal(row.latestScanAt?.toISOString(), at('07:40').toISOString());
  // Updating a baseline (or renewing the same identity link) must not hide
  // today's earlier evidence for that same stable Personnel identity.
  await db.attendanceTerminalMapping.update({ where: { id: f.mapping.id }, data: { effectiveFrom: at('10:00') } });
  const renewed = await todayMappingScans(db, new Date('2026-10-15T12:00:00Z'));
  assert.equal(renewed.rows.find(row => row.mappingId === f.mapping.id)?.latestScanAt?.toISOString(), at('07:40').toISOString());
}));

test('reviewing initial state is audited and preserves identity, evidence and attendance; stale and activated edits fail', () => fixture(async (db, f) => {
  await db.attendanceTerminal.update({ where: { id: f.terminal.id }, data: { mode: 'SHADOW', activatedAt: null } });
  await db.attendanceTerminalMapping.update({ where: { id: f.mapping.id }, data: { initialState: 'UNKNOWN' } });
  const evidence = await f.punch('08:00');
  const original = await db.attendanceTerminalMapping.findUniqueOrThrow({ where: { id: f.mapping.id } });
  await setMappingInitialState(db, f.mapping.id, { initialState: 'INSIDE', expectedInitialState: 'UNKNOWN', reason: 'بررسی واقعی وضعیت' }, f.actor.id);
  const changed = await db.attendanceTerminalMapping.findUniqueOrThrow({ where: { id: f.mapping.id } });
  assert.deepEqual({ ...changed, initialState: 'UNKNOWN' }, original);
  assert.deepEqual(await db.attendancePunch.findUnique({ where: { id: evidence.id } }), evidence);
  assert.equal(await db.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
  assert.equal(await db.attendanceDeviceAudit.count({ where: { terminalId: f.terminal.id, action: 'INITIAL_STATE_REVIEWED' } }), 1);
  await assert.rejects(setMappingInitialState(db, f.mapping.id, { initialState: 'OUTSIDE', expectedInitialState: 'UNKNOWN', reason: 'وضعیت قدیمی' }, f.actor.id), /هم‌زمان/);
  await setMappingInitialState(db, f.mapping.id, { initialState: 'UNKNOWN', expectedInitialState: 'INSIDE', reason: 'وضعیت قابل تأیید نیست' }, f.actor.id);
  assert.equal((await db.attendanceTerminalMapping.findUniqueOrThrow({ where: { id: f.mapping.id } })).initialState, 'UNKNOWN');
  await db.attendanceTerminal.update({ where: { id: f.terminal.id }, data: { activatedAt: at('09:00') } });
  await assert.rejects(setMappingInitialState(db, f.mapping.id, { initialState: 'OUTSIDE', expectedInitialState: 'UNKNOWN', reason: 'پس از فعال‌سازی' }, f.actor.id), /اولین فعال‌سازی/);
}));


test('clock samples are bounded and deduplicated and never rewrite source attendance timestamps', () => fixture(async (db, f) => {
  await db.attendanceTerminal.update({ where: { id: f.terminal.id }, data: { mode: 'SHADOW', activatedAt: null } });
  const punch = await f.punch('08:00');
  const sample = { offsetMs: 34500, uncertaintyMs: 1050, measuredAt: now.toISOString() };
  await recordDeviceClockSample(db, f.terminal.id, f.actor.id, sample, now);
  await recordDeviceClockSample(db, f.terminal.id, f.actor.id, sample, now);
  assert.equal(await db.attendanceDeviceAudit.count({ where: { terminalId: f.terminal.id, action: 'CLOCK_MEASURED', reason: { not: 'simulated contemporaneous measurement' } } }), 1);
  assert.deepEqual(await db.attendancePunch.findUnique({ where: { id: punch.id } }), punch);
  assert.equal(await db.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
  await assert.rejects(recordDeviceClockSample(db, f.terminal.id, f.actor.id, { ...sample, offsetMs: 999999 }, now), /معتبر/);
  await assert.rejects(recordDeviceClockSample(db, f.terminal.id, f.actor.id, { ...sample, measuredAt: '2026-01-01T00:00:00Z' }, now), /تازه/);
}));

test('clock correction is immutable, accepts 15-second uncertainty, and rejects stale or absent measurements', () => fixture(async (db, f) => {
  const received = new Date(at('08:00').getTime() + 35000);
  const input = { deviceCode: '1', occurredAt: at('08:00').toISOString(), verifyMode: 1, inOutRaw: 255 };
  const sample = { offsetMs: 35000, uncertaintyMs: 15000, measuredAt: received.toISOString() };
  await recordDeviceClockSample(db, f.terminal.id, f.actor.id, sample, received);
  const punch = await ingestRaw(db, f.terminal.id, input, received);
  assert.equal(punch.status, 'APPLIED');
  assert.equal(punch.occurredAt.toISOString(), input.occurredAt);
  assert.equal(punch.correctedOccurredAt?.toISOString(), received.toISOString());
  assert.equal((await db.attendanceInterval.findUniqueOrThrow({ where: { id: punch.intervalId! } })).enteredAt?.toISOString(), received.toISOString());
  await recordDeviceClockSample(db, f.terminal.id, f.actor.id, { offsetMs: 10000, uncertaintyMs: 1000, measuredAt: new Date(received.getTime() + 1000).toISOString() }, new Date(received.getTime() + 1000));
  assert.deepEqual(await ingestRaw(db, f.terminal.id, input, received), punch, 'replay cannot rewrite prior correction');
  await assert.rejects(recordDeviceClockSample(db, f.terminal.id, f.actor.id, { ...sample, uncertaintyMs: 15001 }, received), /معتبر/);
  const late = await ingestRaw(db, f.terminal.id, { ...input, occurredAt: at('17:00').toISOString() }, at('17:01'));
  assert.equal(late.status, 'REVIEW'); assert.equal(late.correctedOccurredAt, null);
}));

test('unknown entry retains null time and cannot be bulk confirmed or silently closed by a device', () => fixture(async (db, f) => {
  const record = await db.attendanceRecord.create({ data: { personnelId: f.person.id, date: day, status: 'PRESENT' } });
  const interval = await db.attendanceInterval.create({ data: { attendanceRecordId: record.id, enteredAt: null, observedInsideAt: at('08:00'), entryRecordedBy: f.actor.id, entryReason: 'ورود فراموش‌شده' } });
  assert.equal(interval.enteredAt, null);
  await assert.rejects(confirmIntervals(db, [{ id: interval.id, revision: 1 }], f.actor.id), /تغییر کرده/);
  assert.equal((await f.punch('17:00')).status, 'REVIEW');
  await db.attendanceInterval.update({ where: { id: interval.id }, data: { exitedAt: at('17:00') } });
  const { refreshDeviceAttendance } = await import('../attendanceDevice');
  await refreshDeviceAttendance(db, record.id);
  const refreshed = await db.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal(refreshed.entryTime, null); assert.equal(refreshed.overtimeMinutes, null);
}));


test('a duplicate with corrected time inside an interval blocks bulk confirmation', () => fixture(async (db, f) => {
  const received = new Date(at('08:00').getTime() + 35000);
  await recordDeviceClockSample(db, f.terminal.id, f.actor.id, { offsetMs: 35000, uncertaintyMs: 1000, measuredAt: received.toISOString() }, received);
  const input = { deviceCode: '1', occurredAt: at('08:00').toISOString(), verifyMode: 1, inOutRaw: 255 };
  const first = await ingestRaw(db, f.terminal.id, input, received);
  const duplicate = await ingestRaw(db, f.terminal.id, { ...input, occurredAt: new Date(at('08:00').getTime() + 5000).toISOString() }, new Date(received.getTime() + 5000));
  assert.equal(duplicate.status, 'DUPLICATE');
  await assert.rejects(confirmIntervals(db, [{ id: first.intervalId!, revision: 1 }], f.actor.id), /تردد مبهم/);
}));


test('a device clock ahead of ERP is corrected without changing its raw timestamp', () => fixture(async (db, f) => {
  const raw = at('08:00');
  const received = new Date(raw.getTime() - 35000);
  await recordDeviceClockSample(db, f.terminal.id, f.actor.id, { offsetMs: -35000, uncertaintyMs: 1000, measuredAt: received.toISOString() }, received);
  const punch = await ingestRaw(db, f.terminal.id, { deviceCode: '1', occurredAt: raw.toISOString(), verifyMode: 1, inOutRaw: 255 }, received);
  assert.equal(punch.status, 'APPLIED'); assert.equal(punch.occurredAt.toISOString(), raw.toISOString());
  assert.equal(punch.correctedOccurredAt?.toISOString(), received.toISOString());
}));


test('Tehran midnight overrides the ten-second duplicate window and keeps the prior-day unknown exit out of shift blocking', () => fixture(async (db, f) => {
  const { requireReviewHandover, reviewFingerprint } = await import('../attendanceDevice');
  const first = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-15T23:59:58+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  const baseline = await reviewFingerprint(db);
  await db.attendanceReviewHandover.create({ data: { actorId: f.actor.id, assigneeId: 'next', reason: 'baseline only', pendingCount: baseline.count, evidenceHash: baseline.hash } });
  const next = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T00:00:01+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(next.direction, 'ENTRY'); assert.equal(next.status, 'APPLIED');
  assert.equal((await db.attendanceInterval.findUniqueOrThrow({ where: { id: first.intervalId! } })).exitUnknown, true);
  await requireReviewHandover(db, f.actor.id);
}));

test('a late first scan is entry, while old review evidence does not force the new day to exit or block same-day manual reconciliation', () => fixture(async (db, f) => {
  const old = await f.punch('08:00');
  await db.attendancePunch.update({ where: { id: old.id }, data: { status: 'REVIEW', reason: 'prior day unresolved' } });
  const next = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T16:00:00+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(next.direction, 'ENTRY');
  assert.equal((await db.attendanceInterval.findUniqueOrThrow({ where: { id: next.intervalId! } })).enteredAt?.toISOString(), '2026-10-16T12:30:00.000Z');
  await db.attendancePunch.update({ where: { id: next.id }, data: { status: 'REVIEW' } });
  const sameDay = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T17:00:00+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(sameDay.status, 'REVIEW'); assert.match(sameDay.reason || '', /ابهام قبلی/);
}));

test('comparison-mode next-day scans never roll over operational intervals', () => fixture(async (db, f) => {
  const first = await f.punch('08:00');
  const before = await db.attendanceInterval.findUniqueOrThrow({ where: { id: first.intervalId } });
  await db.attendanceTerminal.update({ where: { id: f.terminal.id }, data: { mode: 'SHADOW', activatedAt: null } });
  const next = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T08:00:00+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(next.status, 'SHADOW'); assert.equal(next.intervalId, null);
  assert.deepEqual(await db.attendanceInterval.findUniqueOrThrow({ where: { id: first.intervalId } }), before);
}));

test('manual entry today is honored and a previous-day manual boundary is not linked across midnight', () => fixture(async (db, f) => {
  const record = await db.attendanceRecord.create({ data: { personnelId: f.person.id, date: day, status: 'PRESENT' } });
  const old = await db.attendanceInterval.create({ data: { attendanceRecordId: record.id, enteredAt: at('23:59'), entryRecordedBy: f.actor.id } });
  const next = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T00:00:20+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(next.direction, 'ENTRY'); assert.notEqual(next.intervalId, old.id);
  await db.attendanceInterval.update({ where: { id: next.intervalId! }, data: { exitedAt: new Date('2026-10-16T01:00:00+03:30'), exitSource: 'MANUAL' } });
  const todayRecord = await db.attendanceRecord.findFirstOrThrow({ where: { personnelId: f.person.id, date: new Date('2026-10-16T00:00:00Z') } });
  await db.attendanceInterval.create({ data: { attendanceRecordId: todayRecord.id, enteredAt: new Date('2026-10-16T08:00:00+03:30'), entryRecordedBy: f.actor.id } });
  const exit = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T16:00:00+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(exit.direction, 'EXIT');
}));


test('a prior-day initial-inside baseline does not misclassify the first new-day scan', () => fixture(async (db, f) => {
  await db.attendanceTerminalMapping.update({ where: { id: f.mapping.id }, data: { initialState: 'INSIDE' } });
  const next = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T16:00:00+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(next.status, 'APPLIED'); assert.equal(next.direction, 'ENTRY');
}));


test('a failed rollover and new-entry transaction restores the old interval and all audit writes', () => fixture(async (db, f) => {
  const first = await f.punch('08:00');
  const before = await db.attendanceInterval.findUniqueOrThrow({ where: { id: first.intervalId } });
  await db.attendanceTerminal.update({ where: { id: f.terminal.id }, data: { createdBy: 'invalid-automation-owner' } });
  const next = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T08:00:00+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(next.status, 'REVIEW'); assert.equal(next.intervalId, null);
  assert.deepEqual(await db.attendanceInterval.findUniqueOrThrow({ where: { id: first.intervalId } }), before);
  assert.equal(await db.attendanceDeviceAudit.count({ where: { terminalId: f.terminal.id, action: 'DAY_ROLLOVER_UNKNOWN_EXIT' } }), 0);
}));


test('pre-activation disputed open history is never retroactively repaired by the new daily rule', () => fixture(async (db, f) => {
  const record = await db.attendanceRecord.create({ data: { personnelId: f.person.id, date: new Date('2026-10-14T00:00:00Z'), status: 'PRESENT' } });
  const old = await db.attendanceInterval.create({ data: { attendanceRecordId: record.id, enteredAt: new Date('2026-10-14T08:00:00+03:30'), entryRecordedBy: f.actor.id } });
  const next = await ingestPunch(db, f.terminal.id, { deviceCode: '1', occurredAt: '2026-10-16T08:00:00+03:30', verifyMode: 1, inOutRaw: 255 }, now);
  assert.equal(next.status, 'REVIEW'); assert.equal(next.intervalId, null);
  assert.deepEqual(await db.attendanceInterval.findUniqueOrThrow({ where: { id: old.id } }), old);
}));
