import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { ExceptionStatus, ExceptionType, PrismaClient, SecurityShiftCoverageStatus, SecurityShiftPlanStatus } from '@prisma/client';
import { protect, AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

const PERSONAL_LEAVE_TYPES = ['استحقاقی', 'استعلاجی', 'استعلاجی سازمانی', 'بدون حقوق'] as const;

const isManager = (req: AuthRequest) => req.user?.role === 'ADMIN' || req.user?.role === 'MANAGER';

const includeLeaveRelations = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      department: { select: { namePersian: true } }
    }
  },
  creator: { select: { id: true, firstName: true, lastName: true, username: true } },
  approver: { select: { id: true, firstName: true, lastName: true, username: true } },
  rejecter: { select: { id: true, firstName: true, lastName: true, username: true } },
  canceller: { select: { id: true, firstName: true, lastName: true, username: true } }
};

const parseDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const markSecuritySlotsForLeave = async (employeeId: string, leaveId: string, startDate: Date, endDate?: Date | null) => {
  const personnel = await prisma.securityPersonnel.findUnique({ where: { userId: employeeId } });
  if (!personnel) return;
  const leaveEnd = endDate || new Date(startDate.getTime() + 24 * 60 * 60_000);
  const now = new Date();
  await prisma.securityShiftPlanSlot.updateMany({
    where: {
      plan: { status: SecurityShiftPlanStatus.PUBLISHED },
      plannedPersonnelId: personnel.id,
      startsAt: { gte: now, lt: leaveEnd },
      endsAt: { gt: startDate },
      session: null
    },
    data: { coverageStatus: SecurityShiftCoverageStatus.NEEDS_REPLACEMENT, leaveRequestId: leaveId }
  });
};

router.get('/leave-requests', protect, async (req: AuthRequest, res: Response) => {
  try {
    const where: any = isManager(req) ? {} : { employeeId: req.user!.id };
    if (req.query.status) where.status = String(req.query.status);
    const requests = await prisma.exceptionRequest.findMany({
      where: { ...where, exceptionType: ExceptionType.VACATION },
      include: includeLeaveRelations,
      orderBy: [{ createdAt: 'desc' }]
    });
    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('List personal leave requests error:', error);
    res.status(500).json({ success: false, error: 'دریافت درخواست‌های مرخصی ناموفق بود.' });
  }
});

router.get('/leave-users', protect, async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return res.status(403).json({ success: false, error: 'دسترسی مدیر لازم است.' });
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, username: true, department: { select: { namePersian: true } } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
  });
  res.json({ success: true, data: users });
});

router.post('/leave-requests', protect, [
  body('leaveType').isIn(PERSONAL_LEAVE_TYPES as unknown as string[]),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('reason').isString().trim().notEmpty(),
  body('description').optional({ values: 'falsy' }).isString(),
  body('employeeId').optional({ values: 'falsy' }).isString()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات درخواست مرخصی کامل نیست.', details: errors.array() });

    const employeeId = isManager(req) && req.body.employeeId ? String(req.body.employeeId) : req.user!.id;
    const target = await prisma.user.findFirst({ where: { id: employeeId, isActive: true } });
    if (!target) return res.status(404).json({ success: false, error: 'کاربر انتخاب‌شده پیدا نشد.' });

    const startDate = parseDate(req.body.startDate);
    const endDate = parseDate(req.body.endDate);
    if (!startDate || !endDate || endDate < startDate) return res.status(400).json({ success: false, error: 'بازه مرخصی معتبر نیست.' });

    const managerCreatedForOtherUser = isManager(req) && employeeId !== req.user!.id;
    const request = await prisma.exceptionRequest.create({
      data: {
        employeeId,
        requestedBy: req.user!.id,
        leaveType: req.body.leaveType,
        exceptionType: ExceptionType.VACATION,
        status: managerCreatedForOtherUser ? ExceptionStatus.APPROVED : ExceptionStatus.PENDING,
        startDate,
        endDate,
        reason: String(req.body.reason).trim(),
        description: String(req.body.description || '').trim() || null,
        approvedBy: managerCreatedForOtherUser ? req.user!.id : null,
        approvedAt: managerCreatedForOtherUser ? new Date() : null
      },
      include: includeLeaveRelations
    });

    if (request.status === ExceptionStatus.APPROVED) {
      await markSecuritySlotsForLeave(request.employeeId, request.id, request.startDate, request.endDate);
    }

    res.status(201).json({ success: true, data: request });
  } catch (error) {
    console.error('Create personal leave request error:', error);
    res.status(500).json({ success: false, error: 'ثبت درخواست مرخصی ناموفق بود.' });
  }
});

router.put('/leave-requests/:id', protect, [
  body('leaveType').isIn(PERSONAL_LEAVE_TYPES as unknown as string[]),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('reason').isString().trim().notEmpty(),
  body('description').optional({ values: 'falsy' }).isString()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات درخواست مرخصی کامل نیست.', details: errors.array() });

    const existing = await prisma.exceptionRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.exceptionType !== ExceptionType.VACATION) return res.status(404).json({ success: false, error: 'درخواست مرخصی پیدا نشد.' });
    const canEdit = existing.status === ExceptionStatus.PENDING && (existing.employeeId === req.user!.id || isManager(req));
    if (!canEdit) return res.status(403).json({ success: false, error: 'فقط درخواست در انتظار بررسی قابل ویرایش است.' });

    const startDate = parseDate(req.body.startDate);
    const endDate = parseDate(req.body.endDate);
    if (!startDate || !endDate || endDate < startDate) return res.status(400).json({ success: false, error: 'بازه مرخصی معتبر نیست.' });

    const updated = await prisma.exceptionRequest.update({
      where: { id: existing.id },
      data: {
        leaveType: req.body.leaveType,
        startDate,
        endDate,
        reason: String(req.body.reason).trim(),
        description: String(req.body.description || '').trim() || null
      },
      include: includeLeaveRelations
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Update personal leave request error:', error);
    res.status(500).json({ success: false, error: 'ویرایش درخواست مرخصی ناموفق بود.' });
  }
});

router.put('/leave-requests/:id/approve', protect, async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return res.status(403).json({ success: false, error: 'دسترسی مدیر لازم است.' });
  try {
    const existing = await prisma.exceptionRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.exceptionType !== ExceptionType.VACATION) return res.status(404).json({ success: false, error: 'درخواست مرخصی پیدا نشد.' });
    if (existing.status !== ExceptionStatus.PENDING) return res.status(409).json({ success: false, error: 'فقط درخواست در انتظار بررسی قابل تایید است.' });
    const updated = await prisma.exceptionRequest.update({
      where: { id: existing.id },
      data: { status: ExceptionStatus.APPROVED, approvedBy: req.user!.id, approvedAt: new Date() },
      include: includeLeaveRelations
    });
    await markSecuritySlotsForLeave(updated.employeeId, updated.id, updated.startDate, updated.endDate);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Approve personal leave request error:', error);
    res.status(500).json({ success: false, error: 'تایید درخواست مرخصی ناموفق بود.' });
  }
});

router.put('/leave-requests/:id/reject', protect, [body('rejectionReason').isString().trim().notEmpty()], async (req: AuthRequest, res: Response) => {
  if (!isManager(req)) return res.status(403).json({ success: false, error: 'دسترسی مدیر لازم است.' });
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل رد الزامی است.', details: errors.array() });
    const existing = await prisma.exceptionRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.exceptionType !== ExceptionType.VACATION) return res.status(404).json({ success: false, error: 'درخواست مرخصی پیدا نشد.' });
    if (existing.status !== ExceptionStatus.PENDING) return res.status(409).json({ success: false, error: 'فقط درخواست در انتظار بررسی قابل رد است.' });
    const updated = await prisma.exceptionRequest.update({
      where: { id: existing.id },
      data: { status: ExceptionStatus.REJECTED, rejectedBy: req.user!.id, rejectedAt: new Date(), rejectionReason: req.body.rejectionReason.trim() },
      include: includeLeaveRelations
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Reject personal leave request error:', error);
    res.status(500).json({ success: false, error: 'رد درخواست مرخصی ناموفق بود.' });
  }
});

router.put('/leave-requests/:id/cancel', protect, [body('reason').optional({ values: 'falsy' }).isString()], async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.exceptionRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.exceptionType !== ExceptionType.VACATION) return res.status(404).json({ success: false, error: 'درخواست مرخصی پیدا نشد.' });
    const manager = isManager(req);
    const requesterCancelsPending = existing.employeeId === req.user!.id && existing.status === ExceptionStatus.PENDING;
    const cancellableByManager: ExceptionStatus[] = [ExceptionStatus.PENDING, ExceptionStatus.APPROVED];
    const managerCancelsApproved = manager && cancellableByManager.includes(existing.status);
    if (!requesterCancelsPending && !managerCancelsApproved) return res.status(403).json({ success: false, error: 'امکان لغو این درخواست وجود ندارد.' });
    const reason = String(req.body.reason || '').trim();
    if (manager && existing.status === ExceptionStatus.APPROVED && !reason) return res.status(400).json({ success: false, error: 'دلیل لغو درخواست تاییدشده الزامی است.' });
    const updated = await prisma.exceptionRequest.update({
      where: { id: existing.id },
      data: { status: ExceptionStatus.CANCELLED, cancelledBy: req.user!.id, cancelledAt: new Date(), cancellationReason: reason || 'لغو توسط کاربر' },
      include: includeLeaveRelations
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Cancel personal leave request error:', error);
    res.status(500).json({ success: false, error: 'لغو درخواست مرخصی ناموفق بود.' });
  }
});

export default router;
