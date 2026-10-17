import { createHash, randomBytes } from 'node:crypto';
import { AttendanceIntervalStatus, AttendanceWorkScheduleStatus, Prisma } from '@prisma/client';
import { calculateDelayMinutes, calculateScheduledOvertime, loadApplicableWorkSchedules, resolveWorkScheduleDay } from '../utils/personnelWorkSchedule';
import { parseSecurityBusinessDate, securityDateKeyFromInstant, securityNowTime } from '../utils/securityBusinessDate';

type DB = Prisma.TransactionClient;
export class AttendanceDeviceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newTerminalToken = () => randomBytes(32).toString('hex');
export const lockAttendance = (db: DB) => db.$executeRaw`SELECT pg_advisory_xact_lock(164000145)`;
export const deviceAudit = (db: DB, terminalId: string, actorId: string, action: string, reason: string, evidence: object) =>
  db.attendanceDeviceAudit.create({ data: { terminalId, actorId, action, reason, evidence: JSON.parse(JSON.stringify(evidence)) } });
export const requireReason = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new AttendanceDeviceError('دلیل معتبر الزامی است.');
  return value.trim();
};

export async function todayMappingScans(db: DB, now = new Date()) {
  const dateKey = securityDateKeyFromInstant(now);
  const rows = await db.$queryRaw<{ mappingId: string; latestScanAt: Date | null; latestCorrectedScanAt: Date | null; scanCount: number }[]>`
    SELECT m.id AS "mappingId", max(p."occurredAt") AS "latestScanAt", (array_agg(p."correctedOccurredAt" ORDER BY p."occurredAt" DESC) FILTER (WHERE p.id IS NOT NULL))[1] AS "latestCorrectedScanAt", count(p.id)::int AS "scanCount"
    FROM attendance_terminal_mappings m
    LEFT JOIN attendance_punches p ON p."terminalId" = m."terminalId"
      AND p."deviceCode" = m."deviceCode" AND p."personnelId" = m."personnelId"
      AND p."occurredAt" >= ((${dateKey}::date::timestamp AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC')
      AND p."occurredAt" < (((${dateKey}::date + 1)::timestamp AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC')
    WHERE m."effectiveTo" IS NULL AND NOT m.ignored AND m."personnelId" IS NOT NULL
    GROUP BY m.id`;
  return { dateKey, rows };
}

export async function setMappingInitialState(db: DB, mappingId: string, input: { initialState: string; expectedInitialState: string; reason: string }, actorId: string) {
  const reason = requireReason(input.reason);
  if (!['UNKNOWN', 'INSIDE', 'OUTSIDE'].includes(input.initialState)) throw new AttendanceDeviceError('وضعیت اولیه معتبر نیست.');
  const before = await db.attendanceTerminalMapping.findUniqueOrThrow({ where: { id: mappingId }, include: { terminal: true } });
  if (before.effectiveTo || before.ignored || !before.personnelId) throw new AttendanceDeviceError('اتصال فعال پرسنل را انتخاب کنید.');
  if (before.terminal.mode !== 'SHADOW' || before.terminal.activatedAt) throw new AttendanceDeviceError('بررسی وضعیت اولیه فقط پیش از اولین فعال‌سازی و در حالت مقایسه‌ای مجاز است.');
  if (before.initialState !== input.expectedInitialState) throw new AttendanceDeviceError('وضعیت هم‌زمان تغییر کرده است؛ دوباره بررسی کنید.', 409);
  const updated = await db.attendanceTerminalMapping.update({ where: { id: mappingId }, data: { initialState: input.initialState } });
  // This is a reviewed setup baseline, not a movement or an identity reassignment.
  await deviceAudit(db, before.terminalId, actorId, 'INITIAL_STATE_REVIEWED', reason, { mappingId, personnelId: before.personnelId, before: before.initialState, after: updated.initialState, reviewedAt: new Date().toISOString() });
  return updated;
}

export async function recordDeviceClockSample(db: DB, terminalId: string, actorId: string, value: unknown, now = new Date()) {
  if (value == null) return;
  const sample = value as { offsetMs: number; uncertaintyMs: number; measuredAt: string };
  const measuredAt = new Date(sample.measuredAt);
  if (!Number.isFinite(sample.offsetMs) || Math.abs(sample.offsetMs) > 300000 || !Number.isFinite(sample.uncertaintyMs) || sample.uncertaintyMs < 0 || sample.uncertaintyMs > 15000 || !Number.isFinite(measuredAt.getTime()) || Math.abs(now.getTime() - measuredAt.getTime()) > 120000) {
    throw new AttendanceDeviceError('نمونه اختلاف ساعت معتبر یا تازه نیست.');
  }
  const latest = await db.attendanceDeviceAudit.findFirst({ where: { terminalId, action: 'CLOCK_MEASURED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  if ((latest?.evidence as { measuredAt?: string } | null)?.measuredAt === measuredAt.toISOString()) return;
  await deviceAudit(db, terminalId, actorId, 'CLOCK_MEASURED', 'اندازه‌گیری فقط‌خواندنی اختلاف ساعت؛ حفظ زمان خام دستگاه', { offsetMs: sample.offsetMs, uncertaintyMs: sample.uncertaintyMs, measuredAt: measuredAt.toISOString() });
}
const time = (d: Date) => securityNowTime(d);
export async function refreshDeviceAttendance(db: DB, recordId: string) {
  const record = await db.attendanceRecord.findUniqueOrThrow({ where: { id: recordId }, include: { intervals: { where: { status: 'ACTIVE' }, orderBy: { enteredAt: 'asc' } } } });
  const rows = record.intervals.sort((a, b) => (a.enteredAt || a.observedInsideAt!).getTime() - (b.enteredAt || b.observedInsideAt!).getTime());
  const pending = rows.some(i => !i.enteredAt || !i.exitedAt || i.exitUnknown);
  const first = rows[0];
  const last = rows.at(-1);
  const delay = first?.enteredAt && record.scheduledStartTime && record.workScheduleStatus === 'WORKDAY' ? calculateDelayMinutes(time(first.enteredAt), record.scheduledStartTime) : record.workScheduleStatus === 'NON_WORKING_DAY' ? 0 : null;
  const duration = rows.reduce((n, i) => n + (i.enteredAt && i.exitedAt ? Math.floor((i.exitedAt.getTime() - i.enteredAt.getTime()) / 60000) : 0), 0);
  const overtime = pending ? null : record.workScheduleStatus === 'NON_WORKING_DAY' ? duration : last?.exitedAt && record.scheduledStartTime && record.scheduledEndTime ? calculateScheduledOvertime(time(last.exitedAt), record.scheduledStartTime, record.scheduledEndTime) : null;
  const provisional = rows.some(i => i.confirmedRevision !== i.revision);
  const marker = pending ? 'زمان حضور در انتظار تکمیل' : provisional ? 'تردد دستگاه تأییدنشده / موقت' : 'تردد بررسی‌شده';
  await db.attendanceRecord.update({ where: { id: recordId }, data: {
    entryTime: first?.enteredAt ? time(first.enteredAt) : null, exitTime: last?.exitedAt ? time(last.exitedAt) : null,
    delayMinutes: delay, overtimeMinutes: overtime, overtimePending: pending,
    status: first ? delay && delay > 0 ? 'LATE' : 'PRESENT' : 'ABSENT',
    notes: [record.notes?.split('\n').filter(s => !s.startsWith('[دستگاه]')).join('\n'), rows.some(i => i.entrySource === 'DEVICE' || i.exitSource === 'DEVICE' || i.exitUnknown) ? `[دستگاه] ${marker}` : null].filter(Boolean).join('\n') || null,
  } });
}

export type PunchInput = { deviceCode: string; occurredAt: string; verifyMode: number; inOutRaw: number };
export function validatePunch(input: PunchInput, now = new Date(), maxFutureMs = 5000) {
  if (!input || typeof input.deviceCode !== 'string' || !/^[\w-]{1,64}$/.test(input.deviceCode) || typeof input.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.occurredAt) || !Number.isInteger(input.verifyMode) || !Number.isInteger(input.inOutRaw)) throw new AttendanceDeviceError('رویداد دستگاه معتبر نیست؛ زمان باید منطقه زمانی داشته باشد.');
  const at = new Date(input.occurredAt);
  if (!Number.isFinite(at.getTime()) || at.getTime() > now.getTime() + maxFutureMs) throw new AttendanceDeviceError('ساعت دستگاه در آینده یا نامعتبر است.');
  return { at, key: tokenHash(JSON.stringify([input.deviceCode, at.toISOString(), input.verifyMode, input.inOutRaw])) };
}

async function rostered(db: DB, personnelId: string, at: Date) {
  return db.securityAttendanceRosterMembership.findFirst({ where: { personnelId, effectiveFrom: { lte: parseSecurityBusinessDate(at.toISOString()) }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: parseSecurityBusinessDate(at.toISOString()) } }] } });
}
async function recordForEntry(db: DB, personnelId: string, at: Date) {
  const person = await db.personnel.findUniqueOrThrow({ where: { id: personnelId }, include: { department: true, user: { select: { id: true } } } });
  const date = parseSecurityBusinessDate(at.toISOString());
  const record = await db.attendanceRecord.findFirst({ where: { personnelId, date } });
  if (record) return record;
  const schedules = await loadApplicableWorkSchedules(db, [personnelId], date);
  const schedule = resolveWorkScheduleDay(schedules.get(personnelId), date);
  return db.attendanceRecord.create({ data: {
    personnelId, employeeId: person.user?.id, date, status: 'PRESENT',
    personnelFirstName: person.firstName, personnelLastName: person.lastName,
    departmentId: person.department?.id, departmentName: person.department?.name, departmentNamePersian: person.department?.namePersian,
    workScheduleStatus: schedule.status, scheduledStartTime: schedule.day?.startTime, scheduledEndTime: schedule.day?.endTime,
  } });
}
async function applyMovement(db: DB, punchId: string, personnelId: string, direction: 'ENTRY' | 'EXIT', at: Date, actorId?: string) {
  const rows = await db.attendanceInterval.findMany({ where: { attendanceRecord: { personnelId }, status: 'ACTIVE' }, orderBy: { enteredAt: 'desc' } });
  const open = rows.find(i => !i.exitedAt && !i.exitUnknown);
  let interval;
  if (direction === 'ENTRY') {
    if (open || rows.some(i => (i.exitedAt && i.exitedAt > at) || (i.enteredAt || i.observedInsideAt!) >= at)) throw new AttendanceDeviceError('ترتیب ترددها یا حضور باز نیازمند بررسی است.', 409);
    const record = await recordForEntry(db, personnelId, at);
    interval = await db.attendanceInterval.create({ data: { attendanceRecordId: record.id, enteredAt: at, entryRecordedBy: actorId || null, entrySource: 'DEVICE', revision: 1, confirmedRevision: actorId ? 1 : 0, confirmedBy: actorId, confirmedAt: actorId ? new Date() : null } });
  } else {
    if (!open || at <= (open.enteredAt || open.observedInsideAt!) || rows.some(i => (i.enteredAt || i.observedInsideAt!) > at)) throw new AttendanceDeviceError('ورود باز معتبر برای این خروج پیدا نشد.', 409);
    interval = await db.attendanceInterval.update({ where: { id: open.id }, data: { exitedAt: at, exitSource: 'DEVICE', exitRecordedBy: actorId || null, revision: { increment: 1 }, confirmedRevision: actorId ? open.revision + 1 : 0, confirmedBy: actorId || null, confirmedAt: actorId ? new Date() : null } });
  }
  await db.attendancePunch.update({ where: { id: punchId }, data: { status: actorId ? 'CONFIRMED' : 'APPLIED', direction, intervalId: interval.id, reviewedBy: actorId, reviewedAt: actorId ? new Date() : null, reason: null } });
  await refreshDeviceAttendance(db, interval.attendanceRecordId);
  return interval;
}

// Always called inside a serializable transaction holding lockAttendance.
export async function ingestPunch(db: DB, terminalId: string, input: PunchInput, now = new Date(), clockAllowed = true) {
  const { at: rawAt, key } = validatePunch(input, now, 300000);
  const clock = await db.attendanceDeviceAudit.findFirst({ where: { terminalId, action: 'CLOCK_MEASURED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const evidence = clock?.evidence as { offsetMs: number; uncertaintyMs: number; measuredAt: string } | null;
  const estimate = evidence ? new Date(rawAt.getTime() + evidence.offsetMs) : null;
  const clockValid = Boolean(clockAllowed && estimate && Number.isFinite(estimate.getTime()) && evidence && Number.isFinite(evidence.offsetMs) && Math.abs(evidence.offsetMs) <= 300000 && Number.isFinite(evidence.uncertaintyMs) && evidence.uncertaintyMs >= 0 && evidence.uncertaintyMs <= 15000 && Math.abs(now.getTime() - Date.parse(evidence.measuredAt)) <= 120000 && Math.abs(estimate.getTime() - Date.parse(evidence.measuredAt)) <= 120000 && estimate.getTime() <= now.getTime() + 15000);
  const at = clockValid ? estimate! : rawAt;
  const existing = await db.attendancePunch.findUnique({ where: { terminalId_eventKey: { terminalId, eventKey: key } } });
  if (existing) return existing;
  const terminal = await db.attendanceTerminal.findUniqueOrThrow({ where: { id: terminalId } });
  const mapping = await db.attendanceTerminalMapping.findFirst({ where: { terminalId, deviceCode: input.deviceCode, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }, orderBy: { effectiveFrom: 'desc' } });
  const punch = await db.attendancePunch.create({ data: { terminalId, eventKey: key, deviceCode: input.deviceCode, occurredAt: rawAt, correctedOccurredAt: clockValid ? at : null, clockEvidence: clockValid ? evidence! : undefined, receivedAt: now, verifyMode: input.verifyMode, inOutRaw: input.inOutRaw, personnelId: mapping?.personnelId, nameSnapshot: mapping?.nameSnapshot, mappingId: mapping?.id, status: 'REVIEW' } });
  const set = (status: string, reason: string, extra: object = {}) => db.attendancePunch.update({ where: { id: punch.id }, data: { status, reason, ...extra } });
  const period = await db.attendanceTerminalPeriod.findFirst({ where: { terminalId, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] }, orderBy: { startsAt: 'desc' } });
  if (mapping?.ignored) return set('IGNORED', 'عمداً کنارگذاشته‌شده');
  if (!mapping?.personnelId) return set('UNMATCHED', 'نیازمند تطبیق هویت در زمان وقوع');
  if (!terminal.activatedAt) return set('SHADOW', 'دریافت مقایسه‌ای؛ حضور عملیاتی تغییر نکرد');
  if (at < terminal.activatedAt) return set('BEFORE_START', 'پیش از شروع ثبت خودکار');
  if (terminal.mode !== 'ACTIVE' || period?.mode !== 'ACTIVE') return set('REVIEW', 'دریافت مقایسه‌ای یا توقف عمدی؛ نیازمند بررسی');
  if (!clockValid) return set('REVIEW', 'اندازه‌گیری معتبر ساعت نزدیک اسکن موجود نیست؛ ساعت واقعی را بررسی کنید');
  const person = await db.personnel.findUnique({ where: { id: mapping.personnelId } });
  if (await db.user.findFirst({ where: { personnelId: mapping.personnelId, securityPersonnel: { isActive: true } } })) return set('IGNORED', 'حضور خود نگهبان طبق روال دستی موجود است');
  if (!person?.isActive || !await rostered(db, person.id, at)) return set('REVIEW', 'پرسنل فعال عضو فهرست گارد نیست');
  const rows = await db.attendanceInterval.findMany({ where: { attendanceRecord: { personnelId: person.id }, status: 'ACTIVE' }, orderBy: { enteredAt: 'asc' } });
  const boundaries = rows.flatMap(i => [...(i.enteredAt ? [{ at: i.enteredAt, direction: 'ENTRY', interval: i, source: i.entrySource }] : []), ...(i.exitedAt ? [{ at: i.exitedAt, direction: 'EXIT', interval: i, source: i.exitSource }] : [])]).sort((a, b) => a.at.getTime() - b.at.getTime());
  const near = boundaries.filter(b => Math.abs(b.at.getTime() - at.getTime()) <= 120000);
  // Linking to a manual boundary must be unambiguous and have no intervening movement.
  const manual = near.filter(b => b.source === 'MANUAL' || (b.direction === 'EXIT' && !b.source));
  const candidate = manual.length === 1 ? manual[0] : null;
  if (candidate && !boundaries.some(b => b !== candidate && b.at.getTime() >= Math.min(at.getTime(), candidate.at.getTime()) && b.at.getTime() <= Math.max(at.getTime(), candidate.at.getTime()))) {
    return set('LINKED', 'شاهد دستگاه برای ثبت دستی؛ زمان دستی حفظ شد', { intervalId: candidate.interval.id, direction: candidate.direction });
  }
  const previousRows = await db.$queryRaw<{ occurredAt: Date; correctedOccurredAt: Date | null }[]>`SELECT "occurredAt", "correctedOccurredAt" FROM attendance_punches WHERE "personnelId" = ${person.id} AND id <> ${punch.id} AND status IN ('APPLIED', 'CONFIRMED', 'LINKED') AND COALESCE("correctedOccurredAt", "occurredAt") <= ${at} ORDER BY COALESCE("correctedOccurredAt", "occurredAt") DESC LIMIT 1`;
  const previous = previousRows[0];
  if (previous && at.getTime() - (previous.correctedOccurredAt || previous.occurredAt).getTime() <= 10000) return set('DUPLICATE', 'اسکن تکراری احتمالی تا ۱۰ ثانیه');
  if (await db.attendancePunch.findFirst({ where: { personnelId: person.id, id: { not: punch.id }, occurredAt: { lte: at }, status: 'REVIEW' } })) return set('REVIEW', 'تردد وابسته به ابهام قبلی');
  if (boundaries.some(b => b.at > at)) return set('REVIEW', 'رویداد دیررس؛ ترتیب یا ثبت دستی نیازمند بررسی');
  const open = rows.find(i => !i.exitedAt && !i.exitUnknown);
  if (open && !open.enteredAt) return set('REVIEW', 'ساعت ورود نامعلوم است؛ بررسی نگهبان لازم است');
  if (open?.enteredAt && securityDateKeyFromInstant(open.enteredAt) !== securityDateKeyFromInstant(at)) return set('REVIEW', 'حضور باز روز قبل؛ خروج شبانه یا ورود تازه؟');
  const evidenceSinceMapping = boundaries.some(b => b.at >= mapping.effectiveFrom);
  if (!evidenceSinceMapping && (mapping.initialState === 'UNKNOWN' || (mapping.initialState === 'INSIDE') !== Boolean(open))) return set('REVIEW', 'وضعیت یا ساعت ورود اولیه نامعلوم یا ناسازگار است');
  const direction = open ? 'EXIT' : 'ENTRY';
  await db.$executeRawUnsafe('SAVEPOINT attendance_apply');
  try {
    await applyMovement(db, punch.id, person.id, direction, at);
    await db.$executeRawUnsafe('RELEASE SAVEPOINT attendance_apply');
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw error;
    await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT attendance_apply');
    if (!(error instanceof AttendanceDeviceError) && !(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    return set('REVIEW', 'تعارض بازه یا ترتیب حضور؛ بررسی نگهبان لازم است');
  }
  return db.attendancePunch.findUniqueOrThrow({ where: { id: punch.id } });
}

export async function resolvePunch(db: DB, id: string, input: { action: string; reason: string; intervalId?: string; occurredAt?: string }, actorId: string) {
  const reason = requireReason(input.reason);
  const punch = await db.attendancePunch.findUniqueOrThrow({ where: { id } });
  if (!['REVIEW', 'DUPLICATE', 'LINKED'].includes(punch.status)) throw new AttendanceDeviceError('این رویداد قابل رسیدگی نیست.', 409);
  if (input.action === 'DISMISS') {
    await db.attendancePunch.update({ where: { id }, data: { status: 'DISMISSED', reviewedAt: new Date(), reviewedBy: actorId, reason } });
  } else if (input.action === 'ENTRY' || input.action === 'EXIT') {
    const at = input.occurredAt ? new Date(input.occurredAt) : punch.correctedOccurredAt;
    if (!at || !Number.isFinite(at.getTime()) || at.getTime() > Date.now() + 15000) throw new AttendanceDeviceError('زمان واقعی تردد را تعیین کنید.');
    if (!punch.personnelId || !await rostered(db, punch.personnelId, at)) throw new AttendanceDeviceError('هویت و عضویت معتبر در زمان وقوع لازم است.');
    const person = await db.personnel.findUnique({ where: { id: punch.personnelId } });
    if (!person?.isActive) throw new AttendanceDeviceError('پرسنل فعال نیست.');
    await applyMovement(db, id, punch.personnelId, input.action, at, actorId);
  } else throw new AttendanceDeviceError('تصمیم معتبر انتخاب کنید.');
  await deviceAudit(db, punch.terminalId, actorId, 'PUNCH_REVIEWED', reason, { before: punch, action: input.action, requestedTime: input.occurredAt || null });
}

export async function confirmIntervals(db: DB, input: { id: string; revision: number }[], actorId: string) {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new AttendanceDeviceError('بازه‌های انتخاب‌شده معتبر نیستند.');
  for (const selection of input) {
    const interval = await db.attendanceInterval.findUniqueOrThrow({ where: { id: selection.id }, include: { attendanceRecord: true } });
    if (interval.revision !== selection.revision || interval.status !== 'ACTIVE' || !interval.enteredAt || interval.exitUnknown) throw new AttendanceDeviceError('اطلاعات تغییر کرده یا زمان خروج نامعلوم است؛ دوباره بررسی کنید.', 409);
    const unresolved = await db.attendancePunch.count({ where: { personnelId: interval.attendanceRecord.personnelId, status: { in: ['REVIEW', 'DUPLICATE'] }, OR: [{ correctedOccurredAt: { gte: interval.enteredAt!, ...(interval.exitedAt ? { lte: interval.exitedAt } : {}) } }, { correctedOccurredAt: null, occurredAt: { gte: interval.enteredAt!, ...(interval.exitedAt ? { lte: interval.exitedAt } : {}) } }] } });
    if (unresolved) throw new AttendanceDeviceError('ابتدا تردد مبهم را تعیین تکلیف کنید.', 409);
    const updated = await db.attendanceInterval.update({ where: { id: interval.id }, data: { confirmedRevision: interval.revision, confirmedBy: actorId, confirmedAt: new Date() } });
    await db.attendanceIntervalAudit.create({ data: { intervalId: interval.id, action: 'CONFIRMED', reason: 'تأیید پس از بازبینی نگهبان', beforeData: JSON.parse(JSON.stringify(interval)), afterData: JSON.parse(JSON.stringify(updated)), actorId } });
    await db.attendancePunch.updateMany({ where: { intervalId: interval.id, status: 'APPLIED' }, data: { status: 'CONFIRMED', reviewedBy: actorId, reviewedAt: new Date() } });
    await refreshDeviceAttendance(db, interval.attendanceRecordId);
  }
}

export async function markUnknownExit(db: DB, intervalId: string, reasonValue: unknown, actorId: string) {
  const reason = requireReason(reasonValue);
  const before = await db.attendanceInterval.findUniqueOrThrow({ where: { id: intervalId } });
  if (before.status !== 'ACTIVE' || before.exitedAt || before.exitUnknown) throw new AttendanceDeviceError('بازه باز معتبر نیست.', 409);
  const after = await db.attendanceInterval.update({ where: { id: intervalId }, data: { exitUnknown: true, exitReason: reason, exitRecordedBy: actorId, revision: { increment: 1 }, confirmedRevision: 0 } });
  await db.attendanceIntervalAudit.create({ data: { intervalId, actorId, action: 'UNKNOWN_EXIT', reason, beforeData: JSON.parse(JSON.stringify(before)), afterData: JSON.parse(JSON.stringify(after)) } });
  await refreshDeviceAttendance(db, before.attendanceRecordId);
}

export async function reviewFingerprint(db: DB) {
  const [punches, intervals] = await Promise.all([
    db.attendancePunch.findMany({ where: { status: { in: ['REVIEW', 'DUPLICATE'] } }, select: { id: true }, orderBy: { id: 'asc' } }),
    db.attendanceInterval.findMany({ where: { status: 'ACTIVE' }, select: { id: true, revision: true, confirmedRevision: true, enteredAt: true, exitUnknown: true }, orderBy: { id: 'asc' } }),
  ]);
  const pending = intervals.filter(i => i.revision !== i.confirmedRevision || !i.enteredAt || i.exitUnknown);
  return { hash: tokenHash(JSON.stringify([punches, pending])), count: punches.length + pending.length };
}
export async function requireReviewHandover(db: DB, actorId: string) {
  const pending = await reviewFingerprint(db);
  if (pending.count && !await db.attendanceReviewHandover.findFirst({ where: { actorId, evidenceHash: pending.hash } })) {
    throw new AttendanceDeviceError('پیش از تحویل شیفت، حضور و غیاب را بررسی کنید یا موارد را با دلیل و مسئول پیگیری تحویل دهید.', 409);
  }
}
