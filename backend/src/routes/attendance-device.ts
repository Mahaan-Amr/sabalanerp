import express, { Response } from 'express';
import { Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { parseSecurityBusinessDate } from '../utils/securityBusinessDate';
import { prisma } from '../lib/prisma';
import { AuthRequest, protect } from '../middleware/auth';
import { attendanceCapabilities, attendanceDeviceManage, attendanceDeviceReview, attendanceDeviceView } from '../middleware/attendanceDeviceAccess';
import { AttendanceDeviceError, confirmIntervals, deviceAudit, ingestPunch, lockAttendance, markUnknownExit, newTerminalToken, requireReason, resolvePunch, tokenHash, validatePunch, reviewFingerprint, todayMappingScans, setMappingInitialState, recordDeviceClockSample } from '../services/attendanceDevice';

const router = express.Router();
const run = (handler: (req: AuthRequest, db: Prisma.TransactionClient) => Promise<unknown>) => async (req: AuthRequest, res: Response) => {
  try {
    const data = await prisma.$transaction(async db => { await lockAttendance(db); return handler(req, db); }, { isolationLevel: 'Serializable', timeout: 30000 });
    res.json({ success: true, data });
  } catch (e) {
    const status = e instanceof AttendanceDeviceError ? e.status : e instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(e.code) ? 409 : 400;
    res.status(status).json({ success: false, error: e instanceof AttendanceDeviceError ? e.message : status === 409 ? 'اطلاعات هم‌زمان تغییر کرد؛ دوباره تلاش کنید.' : 'عملیات حضور و غیاب انجام نشد.' });
  }
};
const safeTerminal = <T extends { tokenHash: string }>(terminal: T) => { const { tokenHash: _secret, ...safe } = terminal; return safe; };

// No browser session is accepted as a machine credential. Scope is one terminal.
router.post('/connector/:terminalId/punches', run(async (req, db) => {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
  const terminal = await db.attendanceTerminal.findUnique({ where: { id: req.params.terminalId } });
  if (!token || !terminal || !timingSafeEqual(Buffer.from(tokenHash(token)), Buffer.from(terminal.tokenHash))) throw new AttendanceDeviceError('اعتبار دریافت‌کننده معتبر نیست.', 401);
  if (!Array.isArray(req.body.punches) || req.body.punches.length > 100) throw new AttendanceDeviceError('حداکثر ۱۰۰ رویداد در هر درخواست مجاز است.');
  const now = new Date();
  req.body.punches.forEach((p: any) => validatePunch(p, now, 300000));
  let clockAllowed = true;
  try { await recordDeviceClockSample(db, terminal.id, terminal.createdBy, req.body.clockSample, now); }
  catch (error) { if (!(error instanceof AttendanceDeviceError)) throw error; clockAllowed = false; }

  const result: Awaited<ReturnType<typeof ingestPunch>>[] = [];
  for (const punch of [...req.body.punches].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())) result.push(await ingestPunch(db, terminal.id, punch, now, clockAllowed));
  await db.attendanceTerminal.update({ where: { id: terminal.id }, data: { lastSeenAt: now, ...(req.body.readOk === true ? { lastReadAt: now } : {}), ...(result.length ? { lastReceivedAt: now } : {}), lastError: req.body.readOk === true ? null : 'خواندن دستگاه تأیید نشده است' } });
  return { accepted: result.map(p => ({ eventKey: p.eventKey, status: p.status })), mode: terminal.mode };
}));
router.get('/summary', protect, attendanceDeviceView, async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const [terminals, review, pending] = await Promise.all([
      prisma.attendanceTerminal.findMany({ select: { lastSeenAt: true, lastReadAt: true } }),
      prisma.attendancePunch.count({ where: { status: { in: ['REVIEW', 'DUPLICATE'] } } }),
      prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM attendance_intervals WHERE status = 'ACTIVE' AND (revision <> "confirmedRevision" OR "enteredAt" IS NULL OR "exitUnknown")`,
    ]);
    res.json({ success: true, data: { pending: review + Number(pending[0].count), disconnected: terminals.some(t => !t.lastSeenAt || !t.lastReadAt || Date.now() - Math.min(t.lastSeenAt.getTime(), t.lastReadAt.getTime()) >= 10000) } });
  } catch { res.status(500).json({ success: false, error: 'دریافت خلاصه ناموفق بود.' }); }
});
router.get('/state', protect, attendanceDeviceView, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const capabilities = await attendanceCapabilities(req.user!.id);
    const personFilter = req.query.personnelId ? { personnelId: String(req.query.personnelId) } : {};
    const [terminals, punches, pending, reviewCount, personnel, assignees, handovers, initialReview, clockSamples] = await Promise.all([
      prisma.attendanceTerminal.findMany({ include: { mappings: { where: { effectiveTo: null } } }, orderBy: { createdAt: 'asc' } }),
      prisma.attendancePunch.findMany({ where: { ...personFilter, ...(req.query.status === 'all' ? {} : { status: { in: ['REVIEW', 'UNMATCHED', 'DUPLICATE', 'APPLIED', 'LINKED', 'SHADOW'] } }) }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 100, ...(req.query.cursor ? { skip: 1, cursor: { id: String(req.query.cursor) } } : {}) }),
      prisma.attendanceInterval.findMany({ where: { attendanceRecord: personFilter, status: 'ACTIVE', OR: [{ confirmedRevision: 0 }, { exitUnknown: true }, { enteredAt: null }] }, include: { attendanceRecord: { select: { personnelFirstName: true, personnelLastName: true, personnelId: true } } }, orderBy: [{ enteredAt: 'desc' }, { id: 'desc' }], take: 100, ...(req.query.intervalCursor ? { skip: 1, cursor: { id: String(req.query.intervalCursor) } } : {}) }),
      prisma.attendancePunch.count({ where: { status: { in: ['REVIEW', 'DUPLICATE'] } } }),
      capabilities.manage ? prisma.personnel.findMany({ where: { isActive: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }) : [],
      prisma.securityPersonnel.findMany({ where: { isActive: true, user: { isActive: true } }, select: { userId: true, user: { select: { firstName: true, lastName: true } } } }),
      prisma.attendanceReviewHandover.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      todayMappingScans(prisma),
      prisma.attendanceDeviceAudit.findMany({ where: { action: 'CLOCK_MEASURED', createdAt: { gte: new Date(Date.now() - 120000) } }, distinct: ['terminalId'], orderBy: { createdAt: 'desc' }, select: { terminalId: true, evidence: true } }),
    ]);
    const personPending = await prisma.$queryRaw<{ personnelId: string; count: number }[]>`SELECT "personnelId", sum(n)::int AS count FROM (SELECT p."personnelId", count(*) AS n FROM attendance_punches p WHERE p.status IN ('REVIEW','DUPLICATE') GROUP BY p."personnelId" UNION ALL SELECT r."personnelId", count(*) AS n FROM attendance_intervals i JOIN attendance_records r ON r.id = i."attendanceRecordId" WHERE i.status = 'ACTIVE' AND (i.revision <> i."confirmedRevision" OR i."exitUnknown" OR i."enteredAt" IS NULL) GROUP BY r."personnelId") pending WHERE "personnelId" IS NOT NULL GROUP BY "personnelId"`;
    const pendingIntervalsCount = await prisma.attendanceInterval.count({ where: { status: 'ACTIVE', confirmedRevision: 0 } });
    const rosterDate = parseSecurityBusinessDate();
    const roster = capabilities.manage ? await prisma.securityAttendanceRosterMembership.findMany({ where: { effectiveFrom: { lte: rosterDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: rosterDate } }] }, select: { personnelId: true } }) : [];
    res.json({ success: true, data: { personPending, clockSamples, initialReview, pendingIntervalsCount, rosterIds: roster.map(r => r.personnelId), capabilities, terminals: terminals.map(safeTerminal), punches, intervals: pending, reviewCount, personnel, assignees, handovers } });
  } catch { res.status(500).json({ success: false, error: 'دریافت وضعیت دستگاه ناموفق بود.' }); }
});
router.post('/terminals', protect, attendanceDeviceManage, run(async (req, db) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 100) throw new AttendanceDeviceError('نام دستگاه الزامی است.');
  const token = newTerminalToken();
  const terminal = await db.attendanceTerminal.create({ data: { name, tokenHash: tokenHash(token), createdBy: req.user!.id } });
  await db.attendanceTerminalPeriod.create({ data: { terminalId: terminal.id, mode: 'SHADOW', startsAt: new Date() } });
  await deviceAudit(db, terminal.id, req.user!.id, 'CREATED', 'ایجاد دریافت‌کننده در حالت مقایسه‌ای', { name });
  return { ...safeTerminal(terminal), token };
}));
router.post('/terminals/:id/mode', protect, attendanceDeviceManage, run(async (req, db) => {
  const reason = requireReason(req.body.reason);
  const mode = req.body.mode;
  if (!['SHADOW', 'ACTIVE', 'PAUSED'].includes(mode)) throw new AttendanceDeviceError('وضعیت معتبر نیست.');
  const terminal = await db.attendanceTerminal.findUniqueOrThrow({ where: { id: req.params.id } });
  const at = new Date();
  if (mode === 'ACTIVE' && !terminal.activatedAt) {
    const mappings = await db.attendanceTerminalMapping.findMany({ where: { terminalId: terminal.id, effectiveTo: null, ignored: false } });
    if (!mappings.length || mappings.some(m => m.initialState === 'UNKNOWN')) throw new AttendanceDeviceError('وضعیت اولیه همه اتصال‌ها را تعیین تکلیف کنید.');
  }
  await db.attendanceTerminalPeriod.updateMany({ where: { terminalId: terminal.id, endsAt: null }, data: { endsAt: at } });
  await db.attendanceTerminalPeriod.create({ data: { terminalId: terminal.id, mode, startsAt: at } });
  const updated = await db.attendanceTerminal.update({ where: { id: terminal.id }, data: { mode, ...(mode === 'ACTIVE' && !terminal.activatedAt ? { activatedAt: at } : {}) } });
  await deviceAudit(db, terminal.id, req.user!.id, 'MODE_CHANGED', reason, { before: terminal.mode, after: mode });
  return safeTerminal(updated);
}));
router.post('/terminals/:id/mappings', protect, attendanceDeviceManage, run(async (req, db) => {
  const reason = requireReason(req.body.reason);
  const code = String(req.body.deviceCode || '');
  if (!/^[\w-]{1,64}$/.test(code) || !['UNKNOWN', 'INSIDE', 'OUTSIDE'].includes(req.body.initialState)) throw new AttendanceDeviceError('کد یا وضعیت اولیه معتبر نیست.');
  const terminalId = req.params.id;
  const at = new Date();
  const person = req.body.personnelId ? await db.personnel.findUnique({ where: { id: String(req.body.personnelId) } }) : null;
  if (!req.body.ignored && !person?.isActive) throw new AttendanceDeviceError('پرسنل فعال انتخاب کنید.');
  const before = await db.attendanceTerminalMapping.findMany({ where: { terminalId, deviceCode: code, effectiveTo: null } });
  await db.attendanceTerminalMapping.updateMany({ where: { terminalId, deviceCode: code, effectiveTo: null }, data: { effectiveTo: at } });
  const mapping = await db.attendanceTerminalMapping.create({ data: { terminalId, deviceCode: code, personnelId: req.body.ignored ? null : person!.id, nameSnapshot: req.body.ignored ? null : `${person!.firstName} ${person!.lastName}`, ignored: Boolean(req.body.ignored), initialState: req.body.initialState, effectiveFrom: at, createdBy: req.user!.id } });
  await deviceAudit(db, terminalId, req.user!.id, 'MAPPING_CHANGED', reason, { before, after: mapping });
  return mapping;
}));
router.post('/mappings/:id/initial-state', protect, attendanceDeviceManage, run((req, db) => setMappingInitialState(db, req.params.id, req.body, req.user!.id)));
router.post('/mappings/:id/end', protect, attendanceDeviceManage, run(async (req, db) => {
  const reason = requireReason(req.body.reason);
  const before = await db.attendanceTerminalMapping.findUniqueOrThrow({ where: { id: req.params.id } });
  if (before.effectiveTo) throw new AttendanceDeviceError('اتصال قبلاً متوقف شده است.', 409);
  const after = await db.attendanceTerminalMapping.update({ where: { id: before.id }, data: { effectiveTo: new Date() } });
  await deviceAudit(db, before.terminalId, req.user!.id, 'MAPPING_ENDED', reason, { before, after });
  return after;
}));
router.post('/punches/:id/resolve', protect, attendanceDeviceReview, run((req, db) => resolvePunch(db, req.params.id, req.body, req.user!.id)));
router.post('/confirm', protect, attendanceDeviceReview, run((req, db) => confirmIntervals(db, req.body.intervals, req.user!.id)));
router.post('/intervals/:id/unknown-exit', protect, attendanceDeviceReview, run((req, db) => markUnknownExit(db, req.params.id, req.body.reason, req.user!.id)));
router.post('/handover', protect, attendanceDeviceReview, run(async (req, db) => {
  const reason = requireReason(req.body.reason);
  const assigneeId = String(req.body.assigneeId || '');
  if (assigneeId === req.user!.id || !(await attendanceCapabilities(assigneeId)).review) throw new AttendanceDeviceError('مسئول پیگیری دیگری با اختیار رسیدگی انتخاب کنید.');
  const pending = await reviewFingerprint(db);
  return db.attendanceReviewHandover.create({ data: { actorId: req.user!.id, assigneeId, reason, pendingCount: pending.count, evidenceHash: pending.hash } });
}));
export default router;
