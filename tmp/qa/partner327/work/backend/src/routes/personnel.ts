import { prisma } from '../lib/prisma';
import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { LEGACY_PERSONNEL_WRITE_DISABLED } from '../services/hrPersonnelBoundary';

const router = express.Router();

const normalizedDepartmentId = (value: unknown) => String(value || '').trim() || null;

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
  canDelete: false,
  canonicalPath: '/dashboard/hr/personnel'
});

router.use(protect);

// Compatibility reads remain available while consumers migrate. HR is the only ordinary writer.
router.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return res.status(410).json(LEGACY_PERSONNEL_WRITE_DISABLED);
});

router.get('/', authorize('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
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
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
            { employeeNumber: { contains: search, mode: 'insensitive' as const } },
            { nationalCode: { contains: search } },
            { user: { is: { username: { contains: search, mode: 'insensitive' as const } } } }
          ]
        } : {})
      },
      include: includePersonnel,
      orderBy: [{ isActive: 'desc' as const }, { lastName: 'asc' as const }, { firstName: 'asc' as const }]
    });

    res.json({ success: true, data: personnel.map(personnelResponse), canonicalPath: '/dashboard/hr/personnel' });
  } catch (error) {
    console.error('Get legacy personnel compatibility list error:', error);
    res.status(500).json({ success: false, error: 'دریافت پرسنل ناموفق بود.' });
  }
});

router.get('/:id', authorize('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response) => {
  try {
    const person = await prisma.personnel.findUnique({ where: { id: req.params.id }, include: includePersonnel });
    if (!person) return res.status(404).json({ success: false, error: 'پرسنل پیدا نشد.' });
    res.json({ success: true, data: personnelResponse(person), canonicalPath: '/dashboard/hr/personnel' });
  } catch (error) {
    console.error('Get legacy personnel compatibility detail error:', error);
    res.status(500).json({ success: false, error: 'دریافت پرسنل ناموفق بود.' });
  }
});

export default router;
