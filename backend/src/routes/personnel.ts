import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { savePersonnelWorkSchedule } from '../utils/personnelWorkSchedule';

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
  user: { select: { id: true, firstName: true, lastName: true, username: true, email: true, isActive: true } },
  workSchedules: {
    include: { days: { orderBy: { weekday: 'asc' as const } } },
    orderBy: { effectiveFrom: 'desc' as const },
    take: 1
  },
  _count: { select: { attendanceRecords: true } }
};

const personnelResponse = (person: any) => ({
  ...person,
  workSchedule: person.workSchedules?.[0] || null,
  workSchedules: undefined,
  canDelete: person._count.attendanceRecords === 0 && !person.user
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
  body('workSchedule').optional().isObject()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات پرسنل کامل نیست.', details: errors.array() });

    const existing = await prisma.personnel.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'پرسنل پیدا نشد.' });

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
      include: { user: true, _count: { select: { attendanceRecords: true } } }
    });
    if (!person) return res.status(404).json({ success: false, error: 'پرسنل پیدا نشد.' });
    if (person.user || person._count.attendanceRecords > 0) {
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
