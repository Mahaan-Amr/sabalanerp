import { createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AttendanceDeviceError, lockAttendance, refreshDeviceAttendance, requireReason } from './attendanceDevice';

type DB = Prisma.TransactionClient;
type Action = 'UNKNOWN_EXIT' | 'VOID';
const previewKey = randomBytes(32);
const lifetimeMs = 5 * 60_000;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

function command(value: any) {
  if (!value || !['UNKNOWN_EXIT', 'VOID'].includes(value.action)) throw new AttendanceDeviceError('نوع اصلاح معتبر انتخاب کنید.');
  return { action: value.action as Action, reason: requireReason(value.reason) };
}

async function inspect(db: DB, id: string, value: any) {
  const request = command(value);
  const before = await db.attendanceInterval.findUnique({ where: { id }, include: { attendanceRecord: true } });
  if (!before || before.status !== 'ACTIVE' || !before.attendanceRecord.personnelId) throw new AttendanceDeviceError('بازه فعال پرسنل پیدا نشد.', 404);
  if (request.action === 'UNKNOWN_EXIT' && before.exitUnknown) throw new AttendanceDeviceError('خروج این بازه از قبل نامعلوم است.', 409);
  const personnelId = before.attendanceRecord.personnelId;
  const records = await db.attendanceRecord.findMany({ where: { personnelId }, orderBy: { id: 'asc' }, include: { intervals: { orderBy: { id: 'asc' } } } });
  const punches = await db.attendancePunch.findMany({ where: { intervalId: id }, orderBy: { id: 'asc' } });
  const { attendanceRecord: _record, ...interval } = before;
  const reset = { revision: interval.revision + 1, confirmedRevision: 0, confirmedAt: null, confirmedBy: null };
  const proposed = request.action === 'UNKNOWN_EXIT'
    ? { ...interval, ...reset, exitedAt: null, exitUnknown: true, exitReason: request.reason }
    : { ...interval, ...reset, status: 'VOIDED', voidReason: request.reason };
  return { request, interval, proposed, records, punches, personnelId };
}

function fingerprint(scope: Awaited<ReturnType<typeof inspect>>, actorId: string, expiresAt: string) {
  return createHmac('sha256', previewKey).update(JSON.stringify({ actorId, expiresAt, ...scope })).digest('hex');
}

export async function previewAttendanceCorrection(db: DB, id: string, value: unknown, actorId: string, now = new Date()) {
  await lockAttendance(db);
  const scope = await inspect(db, id, value);
  const expiresAt = new Date(now.getTime() + lifetimeMs).toISOString();
  return { before: scope.interval, after: scope.proposed, personnelId: scope.personnelId,
    fingerprint: fingerprint(scope, actorId, expiresAt), expiresAt,
    factsRequired: scope.request.action === 'UNKNOWN_EXIT' ? ['entryReviewed', 'departureConfirmed'] : ['incorrectIntervalConfirmed'] };
}

export async function applyAttendanceCorrection(db: DB, id: string, value: any, actorId: string, now = new Date()) {
  await lockAttendance(db);
  const scope = await inspect(db, id, value);
  const expiry = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime() || expiry > now.getTime() + lifetimeMs ||
    typeof value.fingerprint !== 'string' || value.fingerprint !== fingerprint(scope, actorId, value.expiresAt)) {
    throw new AttendanceDeviceError('پیش‌نمایش منقضی شده یا اطلاعات تغییر کرده؛ دوباره بررسی کنید.', 409);
  }
  const facts = scope.request.action === 'UNKNOWN_EXIT'
    ? { entryReviewed: value.facts?.entryReviewed === true, departureConfirmed: value.facts?.departureConfirmed === true }
    : { incorrectIntervalConfirmed: value.facts?.incorrectIntervalConfirmed === true };
  if (Object.values(facts).some(v => !v) || value.confirmApply !== true) throw new AttendanceDeviceError('تا تأیید واقعیت‌ها و تأیید نهایی، اصلاح ثبت نمی‌شود.');
  const after = await db.attendanceInterval.update({ where: { id }, data: {
    ...(scope.request.action === 'UNKNOWN_EXIT'
      ? { exitedAt: null, exitUnknown: true, exitReason: scope.request.reason, exitRecordedBy: actorId, exitSource: 'MANUAL' }
      : { status: 'VOIDED', voidReason: scope.request.reason, voidedAt: now, voidedBy: actorId }),
    revision: { increment: 1 }, confirmedRevision: 0, confirmedAt: null, confirmedBy: null,
  } });
  await db.attendanceIntervalAudit.create({ data: { intervalId: id, actorId, action: scope.request.action,
    reason: scope.request.reason, beforeData: json(scope.interval), afterData: json({ ...after, correction: { facts, expiresAt: value.expiresAt, fingerprint: value.fingerprint } }) } });
  // Raw event identity, source timestamps and links remain historical evidence.
  await db.attendancePunch.updateMany({ where: { intervalId: id }, data: { status: scope.request.action === 'VOID' ? 'DISMISSED' : 'REVIEW', reason: scope.request.reason, reviewedBy: actorId, reviewedAt: now } });
  await refreshDeviceAttendance(db, scope.interval.attendanceRecordId);
  return { interval: after, status: 'CORRECTED_REQUIRES_REVIEW' };
}
