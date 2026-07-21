import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { savePersonnelWorkSchedule } from '../utils/personnelWorkSchedule';
import { buildPersonnelBulkPreview, PERSONNEL_BULK_OPERATIONS, selectionVersionHash } from '../services/personnelBulkPolicy';
import { newOpaqueToken, revokeSessions } from '../services/identitySessionService';

const router = express.Router();
const prisma = new PrismaClient();
const CUID_REGEX = /^c[a-z0-9]{24}$/;

const normalizeName = (value: unknown) => String(value || '').trim();
const normalizedDepartmentId = (value: unknown) => String(value || '').trim() || null;
const isScheduleValidationError = (error: unknown) => error instanceof Error
  && ['ساعت کاری', 'روز کاری', 'تاریخ اجرای'].some((part) => error.message.includes(part));

const sameNameDepartmentWhere = (firstName: string, lastName: string, departmentId: string | null, excludeId?: string) => ({
  firstName,
  lastName,
  departmentId,
  ...(excludeId ? { id: { not: excludeId } } : {})
});

const includePersonnel = {
  department: { select: { id: true, name: true, namePersian: true } },
  user: { select: { id: true, firstName: true, lastName: true, username: true, email: true, isActive: true, role: true } },
  workSchedules: {
    include: { days: { orderBy: { weekday: 'asc' as const } } },
    orderBy: { effectiveFrom: 'desc' as const },
    take: 1
  },
  _count: { select: {
    attendanceRecords: true, securityAttendanceRosterMemberships: true, instantReportParticipants: true,
    exceptionRequests: true, missionAssignments: true, hrEmploymentRelationships: true, workSchedules: true,
  } }
};

const personnelResponse = (person: any) => ({
  ...person,
  workSchedule: person.workSchedules?.[0] || null,
  workSchedules: undefined,
  canDelete: !person.user && Object.values(person._count || {}).every((count) => count === 0)
});

router.post('/bulk/preview', protect, authorize('ADMIN', 'MANAGER'), [
  body('ids').isArray({ min: 1, max: 500 }), body('operation').isIn(PERSONNEL_BULK_OPERATIONS),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Bulk selection or operation is invalid', details: errors.array() });
    const ids = Array.from(new Set(req.body.ids.map(String))) as string[];
    const records = await prisma.personnel.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true, user: { select: { id: true, role: true, isActive: true, updatedAt: true } }, workSchedules: { select: { id: true, updatedAt: true } } } });
    const preview: any = buildPersonnelBulkPreview(records, req.body.operation, req.user!.role);
    preview.skipped.push(...ids.filter((id) => !records.some((record) => record.id === id)).map((id) => ({ id, reason: 'NOT_FOUND' } as any)));
    if (req.body.operation === 'DEACTIVATE' && req.body.deactivateLinkedUsers !== false) {
      const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
      const selectedActiveAdmins = records.filter((record) => record.user?.role === 'ADMIN' && record.user.isActive).length;
      for (const record of records) {
        const reason = record.user?.id === req.user!.id ? 'CANNOT_DEACTIVATE_SELF'
          : record.user?.role === 'ADMIN' && record.user.isActive && activeAdmins <= selectedActiveAdmins ? 'CANNOT_DEACTIVATE_LAST_ADMIN' : null;
        if (reason && preview.eligible.some((item) => item.id === record.id)) {
          preview.eligible = preview.eligible.filter((item) => item.id !== record.id);
          preview.conflicting.push({ id: record.id, reason });
        }
      }
    }
    const previewToken = newOpaqueToken();
    await prisma.personnelBulkOperation.create({ data: {
      actorId: req.user!.id, operation: req.body.operation, previewToken, selectionHash: preview.selectionHash,
      status: 'PREVIEWED', requestedData: req.body, previewData: preview,
    } });
    res.json({ success: true, data: { ...preview, previewToken } });
  } catch (error) {
    console.error('Personnel bulk preview error:', error);
    res.status(500).json({ success: false, error: 'Bulk preview failed' });
  }
});

router.post('/bulk/execute', protect, authorize('ADMIN', 'MANAGER'), [body('previewToken').isString().notEmpty()], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Preview token is required' });
    const stored = await prisma.personnelBulkOperation.findFirst({ where: { previewToken: req.body.previewToken, actorId: req.user!.id, status: 'PREVIEWED' } });
    if (!stored) return res.status(404).json({ success: false, error: 'Bulk preview not found or already used' });
    const preview: any = stored.previewData;
    const requested: any = stored.requestedData || {};
    const selectedIds = preview.selected.map((item: any) => item.id);
    const eligibleIds = preview.eligible.map((item: any) => item.id);
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.personnelBulkOperation.updateMany({ where: { id: stored.id, status: 'PREVIEWED' }, data: { status: 'EXECUTING' } });
      if (claimed.count !== 1) throw new Error('Bulk preview has already been used');
      const current = await tx.personnel.findMany({ where: { id: { in: selectedIds } }, select: { id: true, updatedAt: true, user: { select: { id: true, role: true, isActive: true, updatedAt: true } }, workSchedules: { select: { id: true, updatedAt: true } } } });
      if (current.length !== selectedIds.length || selectionVersionHash(current) !== stored.selectionHash) throw new Error('Bulk preview is stale; refresh and confirm again');
      const personnelAuditSelect = { id: true, isActive: true, departmentId: true, updatedAt: true, user: { select: { id: true, role: true, isActive: true, updatedAt: true } }, workSchedules: { include: { days: { orderBy: { weekday: 'asc' as const } } }, orderBy: { effectiveFrom: 'asc' as const } } };
      const before = await tx.personnel.findMany({ where: { id: { in: eligibleIds } }, select: personnelAuditSelect });
      if (stored.operation === 'DEACTIVATE' && requested.deactivateLinkedUsers !== false) {
        if (before.some((entry) => entry.user?.id === req.user!.id)) throw new Error('Bulk preview is stale; refresh and confirm again');
        if (req.user!.role === 'MANAGER' && before.some((entry) => entry.user?.role === 'ADMIN')) throw new Error('Bulk preview is stale; refresh and confirm again');
        const selectedActiveAdmins = before.filter((entry) => entry.user?.role === 'ADMIN' && entry.user.isActive).length;
        if (selectedActiveAdmins) {
          const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
          if (activeAdmins <= selectedActiveAdmins) throw new Error('Bulk preview is stale; refresh and confirm again');
        }
      }
      if (stored.operation === 'ACTIVATE') await tx.personnel.updateMany({ where: { id: { in: eligibleIds } }, data: { isActive: true } });
      if (stored.operation === 'DEACTIVATE') {
        await tx.personnel.updateMany({ where: { id: { in: eligibleIds } }, data: { isActive: false } });
        if (requested.deactivateLinkedUsers !== false) {
          for (const item of before.filter((entry) => entry.user)) {
            await tx.user.update({ where: { id: item.user!.id }, data: { isActive: false } });
            await revokeSessions(tx, { userId: item.user!.id, actorId: req.user!.id, reason: 'PERSONNEL_BULK_DEACTIVATION' });
          }
        }
      }
      if (stored.operation === 'CHANGE_DEPARTMENT') {
        const department = requested.departmentId ? await tx.department.findFirst({ where: { id: requested.departmentId, isActive: true } }) : null;
        if (requested.departmentId && !department) throw new Error('Selected department is unavailable');
        await tx.personnel.updateMany({ where: { id: { in: eligibleIds } }, data: { departmentId: requested.departmentId || null } });
      }
      if (stored.operation === 'APPLY_WORK_SCHEDULE') for (const id of eligibleIds) await savePersonnelWorkSchedule(tx, id, requested.workSchedule);
      const after = await tx.personnel.findMany({ where: { id: { in: eligibleIds } }, select: personnelAuditSelect });
      const resultData = { operation: stored.operation, applied: after.map((item) => ({ id: item.id, before: before.find((old) => old.id === item.id), after: item })), skipped: preview.skipped, conflicting: preview.conflicting };
      await tx.personnelBulkOperation.update({ where: { id: stored.id }, data: { status: 'COMPLETED', confirmedAt: new Date(), resultData } });
      return resultData;
    }, { isolationLevel: 'Serializable' });
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Personnel bulk execute error:', error);
    if (error.message?.includes('Bulk preview is stale') || error.message?.includes('already been used') || error.code === 'P2034') {
      await prisma.personnelBulkOperation.updateMany({ where: { previewToken: req.body.previewToken, actorId: req.user!.id, status: 'PREVIEWED' }, data: { status: 'STALE' } });
      return res.status(409).json({ success: false, error: 'Bulk preview is stale; refresh and confirm again' });
    }
    res.status(error.message?.includes('department') || isScheduleValidationError(error) ? 400 : 500).json({ success: false, error: error.message || 'Bulk execution failed' });
  }
});

router.get('/', protect, authorize('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const search = String(req.query.search || '').trim();
    const departmentId = normalizedDepartmentId(req.query.departmentId);
    const personnel = await prisma.personnel.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(departmentId ? { departmentId } : {}),
        ...(search ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { user: { is: { username: { contains: search, mode: 'insensitive' } } } }
          ]
        } : {})
      },
      include: includePersonnel,
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }]
    });

    res.json({
      success: true,
      data: personnel.map(personnelResponse)
    });
  } catch (error) {
    console.error('Get personnel error:', error);
    res.status(500).json({ success: false, error: 'دریافت پرسنل ناموفق بود.' });
  }
});

router.get('/:id', protect, authorize('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const person = await prisma.personnel.findUnique({
      where: { id: req.params.id },
      include: includePersonnel
    });
    if (!person) return res.status(404).json({ success: false, error: 'پرسنل پیدا نشد.' });
    res.json({ success: true, data: personnelResponse(person) });
  } catch (error) {
    console.error('Get personnel by id error:', error);
    res.status(500).json({ success: false, error: 'دریافت پرسنل ناموفق بود.' });
  }
});

router.post('/', protect, authorize('ADMIN', 'MANAGER'), [
  body('firstName').trim().notEmpty().withMessage('نام الزامی است.'),
  body('lastName').trim().notEmpty().withMessage('نام خانوادگی الزامی است.'),
  body('departmentId').optional({ values: 'falsy' }).isString().custom((value) => CUID_REGEX.test(value)).withMessage('بخش معتبر نیست.'),
  body('isActive').optional().isBoolean(),
  body('confirmDuplicate').optional().isBoolean(),
  body('workSchedule').optional().isObject()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات پرسنل کامل نیست.', details: errors.array() });

    const firstName = normalizeName(req.body.firstName);
    const lastName = normalizeName(req.body.lastName);
    const departmentId = normalizedDepartmentId(req.body.departmentId);
    const isActive = req.body.isActive !== undefined ? Boolean(req.body.isActive) : true;

    if (departmentId) {
      const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { isActive: true } });
      if (!department?.isActive) return res.status(400).json({ success: false, error: 'بخش پیدا نشد یا غیرفعال است.' });
    }

    const duplicate = await prisma.personnel.findFirst({ where: sameNameDepartmentWhere(firstName, lastName, departmentId) });
    if (duplicate && !req.body.confirmDuplicate) {
      return res.status(409).json({ success: false, error: 'پرسنل با همین نام در همین بخش وجود دارد.', duplicate });
    }

    const person = await prisma.$transaction(async (tx) => {
      const created = await tx.personnel.create({ data: { firstName, lastName, departmentId, isActive } });
      await savePersonnelWorkSchedule(tx, created.id, req.body.workSchedule);
      return tx.personnel.findUniqueOrThrow({ where: { id: created.id }, include: includePersonnel });
    });
    res.status(201).json({ success: true, data: personnelResponse(person) });
  } catch (error) {
    console.error('Create personnel error:', error);
    res.status(isScheduleValidationError(error) ? 400 : 500).json({ success: false, error: isScheduleValidationError(error) ? (error as Error).message : 'ثبت پرسنل ناموفق بود.' });
  }
});

router.put('/:id', protect, authorize('ADMIN', 'MANAGER'), [
  body('firstName').optional().trim().notEmpty().withMessage('نام نمی‌تواند خالی باشد.'),
  body('lastName').optional().trim().notEmpty().withMessage('نام خانوادگی نمی‌تواند خالی باشد.'),
  body('departmentId').optional({ values: 'falsy' }).isString().custom((value) => CUID_REGEX.test(value)).withMessage('بخش معتبر نیست.'),
  body('isActive').optional().isBoolean(),
  body('confirmDuplicate').optional().isBoolean(),
  body('deactivateLinkedUser').optional().isBoolean(),
  body('workSchedule').optional().isObject()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات پرسنل کامل نیست.', details: errors.array() });

    const existing = await prisma.personnel.findUnique({ where: { id: req.params.id }, include: { user: { select: { id: true, role: true } } } });
    if (!existing) return res.status(404).json({ success: false, error: 'پرسنل پیدا نشد.' });
    if (req.body.deactivateLinkedUser && req.user!.role === 'MANAGER' && existing.user?.role === 'ADMIN') return res.status(403).json({ success: false, error: 'Managers cannot deactivate administrator accounts' });
    if (req.body.deactivateLinkedUser && existing.user?.id === req.user!.id) return res.status(409).json({ success: false, error: 'You cannot deactivate your own account' });

    const firstName = req.body.firstName !== undefined ? normalizeName(req.body.firstName) : existing.firstName;
    const lastName = req.body.lastName !== undefined ? normalizeName(req.body.lastName) : existing.lastName;
    const departmentId = req.body.departmentId !== undefined ? normalizedDepartmentId(req.body.departmentId) : existing.departmentId;

    if (departmentId) {
      const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { isActive: true } });
      if (!department?.isActive) return res.status(400).json({ success: false, error: 'بخش پیدا نشد یا غیرفعال است.' });
    }

    const duplicate = await prisma.personnel.findFirst({ where: sameNameDepartmentWhere(firstName, lastName, departmentId, existing.id) });
    if (duplicate && !req.body.confirmDuplicate) {
      return res.status(409).json({ success: false, error: 'پرسنل با همین نام در همین بخش وجود دارد.', duplicate });
    }

    const person = await prisma.$transaction(async (tx) => {
      await tx.personnel.update({
        where: { id: existing.id },
        data: {
          firstName,
          lastName,
          departmentId,
          ...(req.body.isActive !== undefined ? { isActive: Boolean(req.body.isActive) } : {})
        }
      });
      await savePersonnelWorkSchedule(tx, existing.id, req.body.workSchedule);
      if (req.body.isActive === false && req.body.deactivateLinkedUser && existing.user) {
        if (existing.user.role === 'ADMIN') {
          const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
          if (activeAdmins <= 1) throw new Error('The last active administrator cannot be deactivated');
        }
        await tx.user.update({ where: { id: existing.user.id }, data: { isActive: false } });
        await revokeSessions(tx, { userId: existing.user.id, actorId: req.user!.id, reason: 'PERSONNEL_DEACTIVATION' });
      }
      return tx.personnel.findUniqueOrThrow({ where: { id: existing.id }, include: includePersonnel });
    });

    res.json({ success: true, data: personnelResponse(person) });
  } catch (error) {
    console.error('Update personnel error:', error);
    res.status(isScheduleValidationError(error) ? 400 : 500).json({ success: false, error: isScheduleValidationError(error) ? (error as Error).message : 'ویرایش پرسنل ناموفق بود.' });
  }
});

router.delete('/:id', protect, authorize('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const person = await prisma.personnel.findUnique({
      where: { id: req.params.id },
      include: { user: true, _count: { select: {
        attendanceRecords: true, securityAttendanceRosterMemberships: true, instantReportParticipants: true,
        exceptionRequests: true, missionAssignments: true, hrEmploymentRelationships: true, workSchedules: true,
      } } }
    });
    if (!person) return res.status(404).json({ success: false, error: 'پرسنل پیدا نشد.' });
    if (person.user || Object.values(person._count).some((count) => count > 0)) {
      return res.status(409).json({ success: false, error: 'پرسنل دارای سابقه عملیاتی یا کاربر متصل است؛ فقط می‌توانید آن را غیرفعال کنید.' });
    }
    await prisma.personnel.delete({ where: { id: person.id } });
    res.json({ success: true, message: 'پرسنل حذف شد.' });
  } catch (error) {
    console.error('Delete personnel error:', error);
    res.status(500).json({ success: false, error: 'حذف پرسنل ناموفق بود.' });
  }
});

export default router;
