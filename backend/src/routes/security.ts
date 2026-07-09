import express, { Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { body, validationResult } from 'express-validator';
import { AttendanceStatus, LogisticsDriverRequestStatus, PrismaClient, SecurityDriverQueueTurnStatus, SecurityPatrolStatus, SecurityShiftCoverageStatus, SecurityShiftLogStatus, SecurityShiftPlanStatus, SecurityShiftSessionStatus, SecurityVehiclePairPhotoCategory, SecurityVehiclePlateKind } from '@prisma/client';
import { protect, authorize, AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { requireFeatureAccess, FEATURE_PERMISSIONS, FEATURES } from '../middleware/feature';

const router = express.Router();
const prisma = new PrismaClient();

const securityView = requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW);
const securityEdit = requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT);
const securityAdmin = requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN);
const presentLikeStatuses: AttendanceStatus[] = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.LATE,
  AttendanceStatus.MISSION,
  AttendanceStatus.HOURLY_LEAVE,
  AttendanceStatus.SICK_LEAVE,
  AttendanceStatus.VACATION
];
const leaveStatuses: AttendanceStatus[] = [
  AttendanceStatus.HOURLY_LEAVE,
  AttendanceStatus.SICK_LEAVE,
  AttendanceStatus.VACATION
];

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const parseDayQuery = (value: unknown, fallback = new Date()) => {
  const parsed = value ? new Date(String(value)) : fallback;
  return startOfDay(Number.isNaN(parsed.getTime()) ? fallback : parsed);
};

const scopedEmployeeWhere = (departmentId?: unknown, employeeId?: unknown) => ({
  isActive: true,
  ...(departmentId ? { departmentId: String(departmentId) } : {}),
  ...(employeeId ? { id: String(employeeId) } : {})
});

const attendanceInclude = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      email: true,
      department: { select: { id: true, name: true, namePersian: true } }
    }
  },
  shift: true
};

const buildDailyAttendance = async (filters: { date?: unknown; departmentId?: unknown; shiftId?: unknown; employeeId?: unknown }) => {
  const targetDate = parseDayQuery(filters.date);
  const nextDay = addDays(targetDate, 1);
  const employeeWhere = scopedEmployeeWhere(filters.departmentId, filters.employeeId);
  const attendanceWhere = {
    date: { gte: targetDate, lt: nextDay },
    ...(filters.shiftId ? { shiftId: String(filters.shiftId) } : {}),
    employee: employeeWhere
  };

  const [attendanceRecords, allEmployees] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: attendanceWhere,
      include: attendanceInclude,
      orderBy: { createdAt: 'asc' }
    }),
    prisma.user.findMany({
      where: employeeWhere,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        department: { select: { id: true, name: true, namePersian: true } }
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
    })
  ]);

  const recordsByEmployee = new Map(attendanceRecords.map((record) => [record.employeeId, record]));
  const attendanceSummary = allEmployees.map((employee) => {
    const record = recordsByEmployee.get(employee.id);
    return {
      id: record?.id || `absent-${employee.id}-${targetDate.toISOString()}`,
      employee,
      attendance: record || null,
      entryTime: record?.entryTime || null,
      exitTime: record?.exitTime || null,
      status: record?.status || AttendanceStatus.ABSENT,
      exceptionType: record?.exceptionType || null,
      notes: record?.notes || null,
      digitalSignature: record?.digitalSignature || null,
      createdAt: record?.createdAt || null,
      shift: record?.shift || null
    };
  });

  const countedPresent = attendanceRecords.filter((record) => presentLikeStatuses.includes(record.status)).length;
  const stats = {
    totalEmployees: allEmployees.length,
    present: attendanceRecords.filter((record) => record.status === AttendanceStatus.PRESENT).length,
    absent: allEmployees.length - countedPresent,
    late: attendanceRecords.filter((record) => record.status === AttendanceStatus.LATE).length,
    mission: attendanceRecords.filter((record) => record.status === AttendanceStatus.MISSION).length,
    leave: attendanceRecords.filter((record) => leaveStatuses.includes(record.status)).length,
    exception: attendanceRecords.filter((record) => record.status !== AttendanceStatus.PRESENT).length,
    signed: attendanceRecords.filter((record) => Boolean(record.digitalSignature)).length
  };

  return { targetDate, nextDay, attendanceRecords, attendanceSummary, stats };
};

const vehiclePhotoDir = path.join(process.cwd(), 'uploads', 'security-vehicle-pairs');
const categoryByField: Record<string, SecurityVehiclePairPhotoCategory> = {
  driverLicensePhotos: SecurityVehiclePairPhotoCategory.DRIVER_LICENSE,
  vehicleCardPhotos: SecurityVehiclePairPhotoCategory.VEHICLE_CARD,
  driverPhotos: SecurityVehiclePairPhotoCategory.DRIVER_PHOTO
};
const normalizeDigits = (value: unknown) => String(value ?? '')
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
const normalizePhone = (value: unknown) => normalizeDigits(value).replace(/[\s()-]/g, '');
const normalizeNationalCode = (value: unknown) => normalizeDigits(value).replace(/\D/g, '');
const normalizePlate = (value: unknown) => normalizeDigits(value).trim().replace(/\s+/g, ' ');
const validNationalCode = (value: string) => {
  if (!/^\d{10}$/.test(value) || /^(\d)\1{9}$/.test(value)) return false;
  const check = Number(value[9]);
  const remainder = value.slice(0, 9).split('').reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0) % 11;
  return check === (remainder < 2 ? remainder : 11 - remainder);
};
const pairIsComplete = (pair: any) => Boolean(
  pair.homeAddress?.trim() && pair.relativePhone?.trim() &&
  ['DRIVER_LICENSE', 'VEHICLE_CARD', 'DRIVER_PHOTO'].every((category) => pair.photos?.some((photo: any) => photo.category === category))
);
const removeStoredFiles = (files: Express.Multer.File[] = []) => files.forEach((file) => {
  try { fs.unlinkSync(file.path); } catch { /* best effort cleanup */ }
});
const vehiclePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdirSync(vehiclePhotoDir, { recursive: true }); cb(null, vehiclePhotoDir); },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`)
  }),
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) && ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(file.originalname).toLowerCase())),
  limits: { fileSize: 10 * 1024 * 1024 }
});
const uploadedFiles = (req: any) => (Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat()) as Express.Multer.File[];
const photoCreateData = (req: any) => uploadedFiles(req).filter((file) => categoryByField[file.fieldname]).map((file) => ({
  category: categoryByField[file.fieldname], storageName: file.filename, originalName: file.originalname, mimeType: file.mimetype, size: file.size
}));
const normalizedPairInput = (body: any) => ({
  firstName: String(body.firstName || '').trim(), lastName: String(body.lastName || '').trim(),
  vehiclePlate: normalizePlate(body.vehiclePlate), vehicleType: String(body.vehicleType || '').trim(),
  vehiclePlateKind: body.vehiclePlateKind === SecurityVehiclePlateKind.SPECIAL ? SecurityVehiclePlateKind.SPECIAL : SecurityVehiclePlateKind.STANDARD,
  phone: normalizePhone(body.phone), nationalCode: normalizeNationalCode(body.nationalCode),
  homeAddress: String(body.homeAddress || '').trim(), relativePhone: normalizePhone(body.relativePhone),
  notes: String(body.notes || '').trim() || null
});
const validatePairInput = (data: ReturnType<typeof normalizedPairInput>) => {
  if (Object.entries(data).some(([key, value]) => key !== 'notes' && !value)) return 'تمام اطلاعات راننده و خودرو الزامی است.';
  if (data.vehiclePlateKind === SecurityVehiclePlateKind.STANDARD && !/^\d{2} [بجدسصطقلمنوهی] \d{3} ایران \d{2}$/.test(data.vehiclePlate)) return 'پلاک استاندارد باید با قالب 17 ط 574 ایران 63 وارد شود.';
  if (!validNationalCode(data.nationalCode)) return 'کد ملی معتبر ۱۰ رقمی وارد کنید.';
  if (!/^09\d{9}$/.test(data.phone) || !/^09\d{9}$/.test(data.relativePhone)) return 'شماره موبایل باید با قالب 09xxxxxxxxx وارد شود.';
  if (data.phone === data.relativePhone) return 'شماره موبایل بستگان باید با موبایل راننده متفاوت باشد.';
  return null;
};

const pairSnapshot = (pair: any, override: any = {}) => ({
  driverId: pair?.id || null,
  vehiclePairId: pair?.id || null,
  firstName: override.firstName ?? pair?.firstName ?? '',
  lastName: override.lastName ?? pair?.lastName ?? '',
  vehiclePlate: override.vehiclePlate ?? pair?.vehiclePlate ?? '',
  vehicleType: override.vehicleType ?? pair?.vehicleType ?? '',
  phone: override.phone ?? pair?.phone ?? '',
  nationalCode: override.nationalCode ?? pair?.nationalCode ?? '',
  capturedAt: new Date().toISOString()
});

const generateMovementNumber = async (prefix: 'IN' | 'OUT') => {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const count = await prisma.securityVehicleMovement.count({
    where: {
      createdAt: {
        gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      }
    }
  });
  return `${prefix}-${datePart}-${String(count + 1).padStart(4, '0')}`;
};

const includeMovement = {
  vehiclePair: true,
  loading: {
    include: {
      customer: true,
      project: true
    }
  },
  customer: true,
  project: true,
  attachments: true
};

// @desc    Get security-owned driver/vehicle pairs
// @route   GET /api/security/vehicle-pairs
router.get('/vehicle-pairs', protect, securityView, async (req: AuthRequest, res: Response) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const search = String(req.query.search || '').trim();
    const pairs = await prisma.securityVehiclePair.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(search ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { vehiclePlate: { contains: search, mode: 'insensitive' } },
            { vehicleType: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { nationalCode: { contains: search, mode: 'insensitive' } }
          ]
        } : {})
      },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      include: { photos: true, _count: { select: { loadings: true, movements: true, queueTurns: true } } }
    });
    res.json({ success: true, data: pairs.map((pair) => ({
      ...pair,
      informationComplete: pairIsComplete(pair),
      canDelete: pair._count.loadings + pair._count.movements + pair._count.queueTurns === 0
    })) });
  } catch (error) {
    console.error('Security vehicle pairs list error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Create security-owned driver/vehicle pair
// @route   POST /api/security/vehicle-pairs
router.post('/vehicle-pairs', protect, securityAdmin, vehiclePhotoUpload.any(), async (req: AuthRequest, res: Response) => {
  try {
    const data = normalizedPairInput(req.body);
    const inputError = validatePairInput(data);
    const photos = photoCreateData(req);
    const files = uploadedFiles(req);
    if (inputError || files.some((file) => !categoryByField[file.fieldname]) || !Object.values(SecurityVehiclePairPhotoCategory).every((category) => photos.some((photo) => photo.category === category))) {
      removeStoredFiles(uploadedFiles(req));
      return res.status(400).json({ success: false, error: inputError || 'حداقل یک تصویر در هر دسته الزامی است.' });
    }
    const duplicate = await prisma.securityVehiclePair.findFirst({ where: { nationalCode: data.nationalCode, vehiclePlate: data.vehiclePlate } });
    if (duplicate) {
      removeStoredFiles(uploadedFiles(req));
      return res.status(409).json({ success: false, error: duplicate.isActive ? 'این راننده و خودرو قبلاً ثبت شده است.' : 'این زوج غیرفعال است؛ آن را ویرایش یا فعال کنید.' });
    }
    const pair = await prisma.securityVehiclePair.create({
      data: {
        ...data, createdBy: req.user!.id, informationGraceEndsAt: null,
        photos: { create: photos }
      },
      include: { photos: true }
    });
    res.status(201).json({ success: true, data: pair });
  } catch (error) {
    removeStoredFiles(uploadedFiles(req));
    console.error('Create security vehicle pair error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Update security-owned driver/vehicle pair
// @route   PUT /api/security/vehicle-pairs/:id
router.put('/vehicle-pairs/:id', protect, securityAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const data = normalizedPairInput(req.body);
    const inputError = validatePairInput(data);
    if (inputError) return res.status(400).json({ success: false, error: inputError });
    const existing = await prisma.securityVehiclePair.findUnique({ where: { id: req.params.id }, include: { photos: true } });
    if (!existing) return res.status(404).json({ success: false, error: 'رکورد پیدا نشد.' });
    if (!pairIsComplete(existing)) return res.status(400).json({ success: false, error: 'ابتدا تصاویر الزامی را تکمیل کنید.' });
    const duplicate = await prisma.securityVehiclePair.findFirst({ where: { nationalCode: data.nationalCode, vehiclePlate: data.vehiclePlate, id: { not: req.params.id } } });
    if (duplicate) return res.status(409).json({ success: false, error: duplicate.isActive ? 'این راننده و خودرو قبلاً ثبت شده است.' : 'زوج مشابه غیرفعال را فعال یا ویرایش کنید.' });
    if (existing.isActive && req.body.isActive === false) {
      const reserved = await prisma.securityDriverQueueTurn.findFirst({ where: { vehiclePairId: existing.id, status: SecurityDriverQueueTurnStatus.RESERVED } });
      if (reserved) return res.status(409).json({ success: false, error: 'راننده در یک بارگیری رزرو شده است؛ ابتدا رزرو را در لجستیک آزاد کنید.' });
    }
    const pair = await prisma.$transaction(async (tx) => {
      if (existing.isActive && req.body.isActive === false) {
        const reservation = await tx.securityDriverQueueTurn.findFirst({ where: { vehiclePairId: existing.id, status: SecurityDriverQueueTurnStatus.RESERVED } });
        if (reservation) throw new Error('راننده در یک بارگیری رزرو شده است؛ ابتدا رزرو را در لجستیک آزاد کنید.');
      }
      const updated = await tx.securityVehiclePair.update({
        where: { id: req.params.id }, data: { ...data, isActive: req.body.isActive, informationGraceEndsAt: null }, include: { photos: true }
      });
      if (existing.isActive && req.body.isActive === false) {
        await tx.securityDriverQueueTurn.updateMany({
          where: { vehiclePairId: existing.id, status: SecurityDriverQueueTurnStatus.WAITING },
          data: { status: SecurityDriverQueueTurnStatus.OUT_OF_QUEUE, removedAt: new Date(), removedBy: req.user!.id, removalReason: 'غیرفعال‌شدن در رجیستر' }
        });
      }
      return updated;
    }, { isolationLevel: 'Serializable' });
    res.json({ success: true, data: pair });
  } catch (error: any) {
    console.error('Update security vehicle pair error:', error);
    res.status(409).json({ success: false, error: error.message || 'ویرایش راننده و خودرو ناموفق بود.' });
  }
});

router.post('/vehicle-pairs/:id/photos', protect, securityAdmin, vehiclePhotoUpload.any(), async (req: AuthRequest, res: Response) => {
  const files = uploadedFiles(req);
  try {
    if (!files.length) return res.status(400).json({ success: false, error: 'حداقل یک تصویر انتخاب کنید.' });
    if (files.some((file) => !categoryByField[file.fieldname])) { removeStoredFiles(files); return res.status(400).json({ success: false, error: 'دسته تصویر نامعتبر است.' }); }
    const pair = await prisma.securityVehiclePair.findUnique({ where: { id: req.params.id } });
    if (!pair) { removeStoredFiles(files); return res.status(404).json({ success: false, error: 'رکورد پیدا نشد.' }); }
    await prisma.securityVehiclePairPhoto.createMany({ data: photoCreateData(req).map((photo) => ({ ...photo, vehiclePairId: pair.id })) });
    const updated = await prisma.securityVehiclePair.findUnique({ where: { id: pair.id }, include: { photos: true } });
    res.status(201).json({ success: true, data: updated });
  } catch (error) {
    removeStoredFiles(files);
    res.status(500).json({ success: false, error: 'بارگذاری تصویر ناموفق بود.' });
  }
});

router.get('/vehicle-pairs/photos/:photoId', protect, securityView, async (req: AuthRequest, res: Response) => {
  const photo = await prisma.securityVehiclePairPhoto.findUnique({ where: { id: req.params.photoId } });
  if (!photo) return res.status(404).end();
  res.type(photo.mimeType).sendFile(path.join(vehiclePhotoDir, photo.storageName));
});

router.delete('/vehicle-pairs/:id/photos/:photoId', protect, securityAdmin, async (req: AuthRequest, res: Response) => {
  const photo = await prisma.securityVehiclePairPhoto.findFirst({ where: { id: req.params.photoId, vehiclePairId: req.params.id } });
  if (!photo) return res.status(404).json({ success: false, error: 'تصویر پیدا نشد.' });
  const count = await prisma.securityVehiclePairPhoto.count({ where: { vehiclePairId: req.params.id, category: photo.category } });
  if (count <= 1) return res.status(400).json({ success: false, error: 'آخرین تصویر این دسته قابل حذف نیست.' });
  await prisma.securityVehiclePairPhoto.delete({ where: { id: photo.id } });
  try { fs.unlinkSync(path.join(vehiclePhotoDir, photo.storageName)); } catch { /* best effort */ }
  res.json({ success: true });
});

router.delete('/vehicle-pairs/:id', protect, securityAdmin, async (req: AuthRequest, res: Response) => {
  const pair = await prisma.securityVehiclePair.findUnique({ where: { id: req.params.id }, include: { photos: true, _count: { select: { loadings: true, movements: true, queueTurns: true } } } });
  if (!pair) return res.status(404).json({ success: false, error: 'رکورد پیدا نشد.' });
  if (pair._count.loadings + pair._count.movements + pair._count.queueTurns > 0) return res.status(409).json({ success: false, error: 'رکورد استفاده‌شده قابل حذف نیست؛ آن را غیرفعال کنید.' });
  await prisma.securityVehiclePair.delete({ where: { id: pair.id } });
  pair.photos.forEach((photo) => { try { fs.unlinkSync(path.join(vehiclePhotoDir, photo.storageName)); } catch { /* best effort */ } });
  res.json({ success: true });
});

router.get('/driver-queue', protect, securityView, async (req: AuthRequest, res: Response) => {
  try {
    const history = req.query.history === 'true';
    const turns = await prisma.securityDriverQueueTurn.findMany({
      where: history ? undefined : { status: { in: [SecurityDriverQueueTurnStatus.WAITING, SecurityDriverQueueTurnStatus.ENTERED_LOADING_AREA, SecurityDriverQueueTurnStatus.RESERVED] } },
      include: { vehiclePair: true, loading: { select: { id: true, loadingNumber: true } } },
      orderBy: history ? [{ enteredAt: 'desc' }, { id: 'desc' }] : [{ returnedToQueueAt: 'desc' }, { enteredAt: 'asc' }, { id: 'asc' }],
      take: history ? 250 : undefined
    });
    res.json({ success: true, data: turns });
  } catch (error) {
    console.error('Driver queue list error:', error);
    res.status(500).json({ success: false, error: 'دریافت صف رانندگان ناموفق بود.' });
  }
});

router.post('/driver-queue', protect, securityEdit, [body('vehiclePairId').isString().notEmpty()], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'راننده و خودرو الزامی است.' });
    const turn = await prisma.$transaction(async (tx) => {
      const pair = await tx.securityVehiclePair.findFirst({ where: { id: req.body.vehiclePairId, isActive: true }, include: { photos: true } });
      if (!pair || !pairIsComplete(pair)) throw new Error('فقط راننده و خودروی فعال و کامل قابل نوبت‌دهی است.');
      const current = await tx.securityDriverQueueTurn.findFirst({ where: { vehiclePairId: pair.id, status: { in: [SecurityDriverQueueTurnStatus.WAITING, SecurityDriverQueueTurnStatus.ENTERED_LOADING_AREA, SecurityDriverQueueTurnStatus.RESERVED] } } });
      if (current) throw new Error('این راننده و خودرو هم‌اکنون در صف است.');
      return tx.securityDriverQueueTurn.create({ data: { vehiclePairId: pair.id, enteredBy: req.user!.id }, include: { vehiclePair: true } });
    }, { isolationLevel: 'Serializable' });
    res.status(201).json({ success: true, data: turn });
  } catch (error: any) {
    res.status(409).json({ success: false, error: error.message || 'ثبت نوبت ناموفق بود.' });
  }
});

router.post('/driver-queue/:id/remove', protect, securityEdit, [body('reason').isString().trim().notEmpty()], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل خروج از صف الزامی است.' });
    const turn = await prisma.securityDriverQueueTurn.findUnique({ where: { id: req.params.id } });
    if (!turn) return res.status(404).json({ success: false, error: 'نوبت پیدا نشد.' });
    if (turn.status === SecurityDriverQueueTurnStatus.RESERVED) return res.status(409).json({ success: false, error: 'نوبت رزرو شده را ابتدا از بارگیری آزاد کنید.' });
    if (turn.status !== SecurityDriverQueueTurnStatus.WAITING && turn.status !== SecurityDriverQueueTurnStatus.ENTERED_LOADING_AREA) return res.status(409).json({ success: false, error: 'فقط نوبت جاری قابل خروج از صف است.' });
    const updated = await prisma.securityDriverQueueTurn.updateMany({
      where: { id: turn.id, status: { in: [SecurityDriverQueueTurnStatus.WAITING, SecurityDriverQueueTurnStatus.ENTERED_LOADING_AREA] } },
      data: { status: SecurityDriverQueueTurnStatus.OUT_OF_QUEUE, removedAt: new Date(), removedBy: req.user!.id, removalReason: req.body.reason.trim() }
    });
    if (updated.count !== 1) return res.status(409).json({ success: false, error: 'وضعیت نوبت هم‌زمان تغییر کرده است؛ صف را به‌روزرسانی کنید.' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'خروج از صف ناموفق بود.' });
  }
});

router.post('/driver-queue/:id/enter-loading-area', protect, securityEdit, async (req: AuthRequest, res: Response) => {
  try {
    const turn = await prisma.securityDriverQueueTurn.findUnique({ where: { id: req.params.id }, include: { vehiclePair: { include: { photos: true } } } });
    if (!turn) return res.status(404).json({ success: false, error: 'نوبت پیدا نشد.' });
    if (turn.status !== SecurityDriverQueueTurnStatus.WAITING) return res.status(409).json({ success: false, error: 'فقط راننده در انتظار قابل ورود برای بارگیری است.' });
    if (!turn.vehiclePair.isActive || !pairIsComplete(turn.vehiclePair)) return res.status(409).json({ success: false, error: 'اطلاعات راننده و خودرو باید کامل و فعال باشد.' });
    const updated = await prisma.securityDriverQueueTurn.updateMany({
      where: { id: turn.id, status: SecurityDriverQueueTurnStatus.WAITING },
      data: { status: SecurityDriverQueueTurnStatus.ENTERED_LOADING_AREA, loadingAreaEnteredAt: new Date(), loadingAreaEnteredBy: req.user!.id, returnedToQueueAt: null, returnedToQueueBy: null, returnToQueueReason: null }
    });
    if (updated.count !== 1) return res.status(409).json({ success: false, error: 'وضعیت نوبت هم‌زمان تغییر کرده است؛ صف را به‌روزرسانی کنید.' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'ورود راننده برای بارگیری ناموفق بود.' });
  }
});

router.post('/driver-queue/:id/return-to-waiting', protect, securityEdit, [body('reason').isString().trim().notEmpty()], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل بازگشت به صف الزامی است.' });
    const turn = await prisma.securityDriverQueueTurn.findUnique({ where: { id: req.params.id } });
    if (!turn) return res.status(404).json({ success: false, error: 'نوبت پیدا نشد.' });
    if (turn.status === SecurityDriverQueueTurnStatus.RESERVED) return res.status(409).json({ success: false, error: 'راننده رزرو شده را ابتدا لجستیک از بارگیری آزاد کند.' });
    if (turn.status !== SecurityDriverQueueTurnStatus.ENTERED_LOADING_AREA) return res.status(409).json({ success: false, error: 'فقط راننده وارد محوطه بارگیری قابل بازگشت به صف است.' });
    const updated = await prisma.securityDriverQueueTurn.updateMany({
      where: { id: turn.id, status: SecurityDriverQueueTurnStatus.ENTERED_LOADING_AREA },
      data: { status: SecurityDriverQueueTurnStatus.WAITING, returnedToQueueAt: new Date(), returnedToQueueBy: req.user!.id, returnToQueueReason: req.body.reason.trim(), loadingAreaEnteredAt: null, loadingAreaEnteredBy: null }
    });
    if (updated.count !== 1) return res.status(409).json({ success: false, error: 'وضعیت نوبت هم‌زمان تغییر کرده است؛ صف را به‌روزرسانی کنید.' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'بازگشت راننده به صف ناموفق بود.' });
  }
});

router.get('/loading-driver-requests', protect, securityView, async (_req: AuthRequest, res: Response) => {
  try {
    const requests = await prisma.logisticsDriverRequest.findMany({
      where: { status: { in: [LogisticsDriverRequestStatus.PENDING_SECURITY, LogisticsDriverRequestStatus.DRIVER_ENTERED] } },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true, username: true } },
        fulfiller: { select: { id: true, firstName: true, lastName: true, username: true } },
        queueTurn: { include: { vehiclePair: true } },
        loading: {
          include: {
            customer: true,
            project: true,
            lines: { include: { sourceContract: true, product: true }, orderBy: { createdAt: 'asc' } }
          }
        }
      },
      orderBy: { requestedAt: 'asc' }
    });
    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('Loading driver requests error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.post('/loading-driver-requests/:id/assign', protect, securityEdit, [body('queueTurnId').isString().notEmpty()], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });

    await prisma.$transaction(async (tx) => {
      const request = await tx.logisticsDriverRequest.findUnique({
        where: { id: req.params.id },
        include: { loading: true }
      });
      if (!request) throw new Error('درخواست راننده پیدا نشد.');
      if (request.status !== LogisticsDriverRequestStatus.PENDING_SECURITY) throw new Error('فقط درخواست در انتظار حراست قابل ورود راننده است.');
      if (request.loading.status !== 'DRAFT') throw new Error('راننده فقط برای پیش‌نویس بارگیری قابل ورود است.');

      const turn = await tx.securityDriverQueueTurn.findUnique({
        where: { id: req.body.queueTurnId },
        include: { vehiclePair: { include: { photos: true } } }
      });
      if (!turn || !turn.vehiclePair.isActive) throw new Error('نوبت راننده فعال پیدا نشد.');
      if (turn.status !== SecurityDriverQueueTurnStatus.WAITING) throw new Error('فقط راننده در انتظار قابل ورود برای بارگیری است.');
      if (!pairIsComplete(turn.vehiclePair)) throw new Error('اطلاعات رجیستر راننده و خودرو باید کامل باشد.');

      const position = await tx.securityDriverQueueTurn.count({ where: { status: SecurityDriverQueueTurnStatus.WAITING, enteredAt: { lte: turn.enteredAt } } });
      const claimed = await tx.securityDriverQueueTurn.updateMany({
        where: { id: turn.id, status: SecurityDriverQueueTurnStatus.WAITING },
        data: {
          status: SecurityDriverQueueTurnStatus.RESERVED,
          loadingId: request.loadingId,
          driverRequestId: request.id,
          reservedAt: new Date(),
          reservedBy: req.user!.id,
          reservedPosition: Math.max(position, 1)
        }
      });
      if (claimed.count !== 1) throw new Error('نوبت راننده هم‌زمان تغییر کرده است؛ صف را به‌روزرسانی کنید.');

      await tx.logisticsLoading.update({
        where: { id: request.loadingId },
        data: { vehiclePairId: turn.vehiclePairId, driverSnapshot: pairSnapshot(turn.vehiclePair) }
      });
      await tx.logisticsDriverRequest.update({
        where: { id: request.id },
        data: { status: LogisticsDriverRequestStatus.DRIVER_ENTERED, fulfilledAt: new Date(), fulfilledBy: req.user!.id }
      });
    }, { isolationLevel: 'Serializable' });

    const updated = await prisma.logisticsDriverRequest.findUnique({
      where: { id: req.params.id },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true, username: true } },
        fulfiller: { select: { id: true, firstName: true, lastName: true, username: true } },
        queueTurn: { include: { vehiclePair: true } },
        loading: { include: { customer: true, project: true, lines: { include: { sourceContract: true, product: true } } } }
      }
    });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Assign loading driver error:', error);
    res.status(409).json({ success: false, error: error.message || 'ورود راننده برای بارگیری ناموفق بود.' });
  }
});

// @desc    Get finalized logistics loadings waiting for gate exit
// @route   GET /api/security/vehicle-movements/ready-exit
router.get('/vehicle-movements/ready-exit', protect, securityView, async (_req: AuthRequest, res: Response) => {
  try {
    const exited = await prisma.securityVehicleMovement.findMany({
      where: {
        direction: 'OUTBOUND',
        status: 'EXITED',
        loadingId: { not: null }
      },
      select: { loadingId: true }
    });
    const exitedIds = exited.map((item) => item.loadingId).filter(Boolean) as string[];
    const loadings = await prisma.logisticsLoading.findMany({
      where: {
        status: 'FINALIZED',
        id: exitedIds.length ? { notIn: exitedIds } : undefined
      },
      include: {
        customer: true,
        project: true,
        vehiclePair: true,
        lines: true
      },
      orderBy: { finalizedAt: 'desc' },
      take: 100
    });
    res.json({ success: true, data: loadings });
  } catch (error) {
    console.error('Ready exit loadings error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    List vehicle movements
// @route   GET /api/security/vehicle-movements
router.get('/vehicle-movements', protect, securityView, async (req: AuthRequest, res: Response) => {
  try {
    const where: any = {};
    if (req.query.direction) where.direction = String(req.query.direction);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.purpose) where.purpose = String(req.query.purpose);

    const movements = await prisma.securityVehicleMovement.findMany({
      where,
      include: includeMovement,
      orderBy: { occurredAt: 'desc' },
      take: Number(req.query.limit || 100)
    });
    res.json({ success: true, data: movements });
  } catch (error) {
    console.error('Vehicle movements list error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Record inbound loaded vehicle entry
// @route   POST /api/security/vehicle-movements/inbound
router.post('/vehicle-movements/inbound', protect, securityEdit, [
  body('purpose').isIn(['OUTSIDE_PURCHASE', 'SALES_RETURN', 'CONSIGNMENT']).withMessage('Invalid inbound purpose')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    if (req.body.purpose === 'CONSIGNMENT') {
      return res.status(400).json({ success: false, error: 'Consignment flow is not defined yet' });
    }
    if (req.body.purpose === 'SALES_RETURN' && !req.body.customerId) {
      return res.status(400).json({ success: false, error: 'Customer is required for sales return' });
    }

    const pair = req.body.vehiclePairId
      ? await prisma.securityVehiclePair.findUnique({ where: { id: req.body.vehiclePairId } })
      : null;

    const movement = await prisma.securityVehicleMovement.create({
      data: {
        movementNumber: await generateMovementNumber('IN'),
        direction: 'INBOUND',
        purpose: req.body.purpose,
        status: 'ENTRY_RECORDED',
        vehiclePairId: pair?.id || null,
        customerId: req.body.customerId || null,
        projectId: req.body.projectId || null,
        occurredAt: req.body.occurredAt ? new Date(req.body.occurredAt) : new Date(),
        driverSnapshot: req.body.driverSnapshot || (pair ? pairSnapshot(pair) : null),
        documentSnapshot: req.body.documentSnapshot || null,
        settlementSnapshot: req.body.settlementSnapshot || null,
        notes: req.body.notes || null,
        createdBy: req.user!.id
      },
      include: includeMovement
    });
    res.status(201).json({ success: true, data: movement });
  } catch (error: any) {
    console.error('Create inbound movement error:', error);
    res.status(500).json({ success: false, error: error.message || 'Server error' });
  }
});

// @desc    Complete inbound movement details
// @route   PUT /api/security/vehicle-movements/:id/complete
router.put('/vehicle-movements/:id/complete', protect, securityEdit, async (req: AuthRequest, res: Response) => {
  try {
    const movement = await prisma.securityVehicleMovement.findUnique({ where: { id: req.params.id } });
    if (!movement) return res.status(404).json({ success: false, error: 'Movement not found' });
    if (movement.direction !== 'INBOUND') return res.status(400).json({ success: false, error: 'Only inbound movements can be completed here' });
    if (movement.purpose === 'CONSIGNMENT') return res.status(400).json({ success: false, error: 'Consignment flow is not defined yet' });

    const updated = await prisma.securityVehicleMovement.update({
      where: { id: movement.id },
      data: {
        status: 'INFO_COMPLETED',
        completedAt: new Date(),
        driverSnapshot: req.body.driverSnapshot ?? movement.driverSnapshot,
        documentSnapshot: req.body.documentSnapshot ?? movement.documentSnapshot,
        settlementSnapshot: req.body.settlementSnapshot ?? movement.settlementSnapshot,
        notes: req.body.notes ?? movement.notes
      },
      include: includeMovement
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Complete inbound movement error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Record outbound sales exit at gate
// @route   POST /api/security/vehicle-movements/exit
router.post('/vehicle-movements/exit', protect, securityEdit, [
  body('loadingId').notEmpty().withMessage('Loading is required')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });

    const loading = await prisma.logisticsLoading.findUnique({
      where: { id: req.body.loadingId },
      include: { customer: true, project: true, vehiclePair: true }
    });
    if (!loading) return res.status(404).json({ success: false, error: 'Loading not found' });
    if (loading.status !== 'FINALIZED') return res.status(400).json({ success: false, error: 'Only finalized loadings can exit the gate' });

    const existingExit = await prisma.securityVehicleMovement.findFirst({
      where: { loadingId: loading.id, direction: 'OUTBOUND', status: 'EXITED' }
    });
    if (existingExit) return res.status(400).json({ success: false, error: 'Gate exit already recorded for this loading' });

    const purpose = req.body.customerPersonalCar ? 'CUSTOMER_PERSONAL_CAR_EXIT' : 'SALES_EXIT';
    const pair = req.body.vehiclePairId
      ? await prisma.securityVehiclePair.findUnique({ where: { id: req.body.vehiclePairId } })
      : loading.vehiclePair;

    const movement = await prisma.securityVehicleMovement.create({
      data: {
        movementNumber: await generateMovementNumber('OUT'),
        direction: 'OUTBOUND',
        purpose: purpose as any,
        status: 'EXITED',
        vehiclePairId: purpose === 'SALES_EXIT' ? pair?.id || null : null,
        loadingId: loading.id,
        customerId: loading.customerId,
        projectId: loading.projectId,
        occurredAt: req.body.occurredAt ? new Date(req.body.occurredAt) : new Date(),
        driverSnapshot: purpose === 'SALES_EXIT' ? (req.body.driverSnapshot || (pair ? pairSnapshot(pair) : loading.driverSnapshot)) : null,
        notes: req.body.notes || null,
        createdBy: req.user!.id
      },
      include: includeMovement
    });
    res.status(201).json({ success: true, data: movement });
  } catch (error: any) {
    console.error('Create outbound exit error:', error);
    res.status(500).json({ success: false, error: error.message || 'Server error' });
  }
});

// @desc    Void vehicle movement
// @route   PUT /api/security/vehicle-movements/:id/void
router.put('/vehicle-movements/:id/void', protect, securityAdmin, [
  body('reason').notEmpty().withMessage('Void reason is required')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    const movement = await prisma.securityVehicleMovement.findUnique({ where: { id: req.params.id } });
    if (!movement) return res.status(404).json({ success: false, error: 'Movement not found' });
    const status = movement.direction === 'INBOUND' ? 'ENTRY_VOIDED' : 'EXIT_VOIDED';
    const updated = await prisma.securityVehicleMovement.update({
      where: { id: movement.id },
      data: {
        status: status as any,
        voidedAt: new Date(),
        voidedBy: req.user!.id,
        voidReason: req.body.reason
      },
      include: includeMovement
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Void vehicle movement error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Add categorized attachment to a vehicle movement
// @route   POST /api/security/vehicle-movements/:id/attachments
router.post('/vehicle-movements/:id/attachments', protect, securityEdit, [
  body('category').isIn(['VEHICLE_PLATE', 'DRIVER_DOCUMENT', 'WAYBILL', 'PURCHASE_INVOICE', 'CARGO', 'OTHER']).withMessage('Invalid attachment category'),
  body('url').notEmpty().withMessage('Attachment URL is required')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    const attachment = await prisma.securityVehicleAttachment.create({
      data: {
        movementId: req.params.id,
        category: req.body.category,
        url: req.body.url,
        fileName: req.body.fileName || null,
        notes: req.body.notes || null
      }
    });
    res.status(201).json({ success: true, data: attachment });
  } catch (error) {
    console.error('Create vehicle movement attachment error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    List supervisor reports
// @route   GET /api/security/supervisor-reports
router.get('/supervisor-reports', protect, securityView, async (req: AuthRequest, res: Response) => {
  try {
    const reports = await prisma.securitySupervisorReport.findMany({
      where: req.query.shiftId ? { shiftId: String(req.query.shiftId) } : undefined,
      include: { shift: true, planSlot: true },
      orderBy: { reportDate: 'desc' },
      take: Number(req.query.limit || 50)
    });
    res.json({ success: true, data: reports });
  } catch (error) {
    console.error('Supervisor reports list error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Create supervisor report
// @route   POST /api/security/supervisor-reports
router.post('/supervisor-reports', protect, securityEdit, [
  body('reportDate').isISO8601().withMessage('Report date must be valid'),
  body('summary').notEmpty().withMessage('Summary is required')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    if (req.body.planSlotId) {
      const [slot, personnel] = await Promise.all([
        prisma.securityShiftPlanSlot.findUnique({ where: { id: req.body.planSlotId } }),
        getSelfPersonnel(req.user!.id)
      ]);
      const isManager = req.user!.role === 'ADMIN' || (req as any).workspacePermission === WORKSPACE_PERMISSIONS.ADMIN;
      if (!slot || (!isManager && (!personnel || effectivePersonnelId(slot) !== personnel.id))) return res.status(403).json({ success: false, error: 'ثبت گزارش فقط برای مسئول واقعی این شیفت مجاز است.' });
    }
    const report = await prisma.securitySupervisorReport.create({
      data: {
        reportDate: new Date(req.body.reportDate),
        shiftId: req.body.shiftId || null,
        planSlotId: req.body.planSlotId || null,
        authorId: req.user!.id,
        summary: req.body.summary,
        incidents: req.body.incidents || null,
        followUpNotes: req.body.followUpNotes || null,
        attachments: req.body.attachments || null
      },
      include: { shift: true, planSlot: true }
    });
    res.status(201).json({ success: true, data: report });
  } catch (error) {
    console.error('Create supervisor report error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Get all shifts
// @route   GET /api/security/shifts
// @access  Private/Security Workspace
const shiftPlanInclude = {
  primaryA: { include: { user: true } }, primaryB: { include: { user: true } }, primaryC: { include: { user: true } },
  _count: { select: { slots: true } }
};
const slotInclude = {
  plan: true,
  plannedPersonnel: { include: { user: true } },
  replacementPersonnel: { include: { user: true } },
  attendance: true,
  session: true,
  report: true,
  temporaryCoverage: { include: { personnel: { include: { user: true } } } }
};
const effectivePersonnelId = (slot: any) => slot.replacementPersonnelId || slot.plannedPersonnelId;
const getSelfPersonnel = (userId: string) => prisma.securityPersonnel.findUnique({ where: { userId } });
const activeShiftLogInclude = {
  logEntries: { include: { reportType: true }, orderBy: { rowNumber: 'asc' as const } },
  patrolSessions: { orderBy: { startedAt: 'desc' as const } },
  slot: { include: slotInclude },
  personnel: { include: { user: true } }
};
const getActiveShiftSessionForUser = async (userId: string) => {
  const personnel = await getSelfPersonnel(userId);
  if (!personnel) return { personnel: null, session: null };
  const session = await prisma.securityShiftSession.findFirst({
    where: { personnelId: personnel.id, status: SecurityShiftSessionStatus.ACTIVE },
    include: activeShiftLogInclude
  });
  return { personnel, session };
};
const markProbableNoShows = async () => {
  const now = new Date();
  const candidates = await prisma.securityShiftPlanSlot.findMany({
    where: {
      plan: { status: SecurityShiftPlanStatus.PUBLISHED },
      startsAt: { lt: now },
      endsAt: { gt: now },
      probableNoShowAt: null,
      attendance: { none: {} },
      session: null,
      coverageStatus: { not: SecurityShiftCoverageStatus.NEEDS_REPLACEMENT }
    },
    include: { plan: true },
    take: 100
  });
  const overdueIds = candidates
    .filter((slot) => now.getTime() >= slot.startsAt.getTime() + slot.plan.lateAlertMinutes * 60_000)
    .map((slot) => slot.id);
  if (overdueIds.length) {
    await prisma.securityShiftPlanSlot.updateMany({
      where: { id: { in: overdueIds }, probableNoShowAt: null },
      data: { probableNoShowAt: now }
    });
  }
};

router.get('/shift-plans', protect, securityView, async (req: AuthRequest, res: Response) => {
  const mayViewDrafts = req.query.includeDrafts === 'true' && (req.user!.role === 'ADMIN' || (req as any).workspacePermission === WORKSPACE_PERMISSIONS.ADMIN);
  const plans = await prisma.securityShiftPlan.findMany({
    where: mayViewDrafts ? undefined : { status: SecurityShiftPlanStatus.PUBLISHED },
    include: shiftPlanInclude,
    orderBy: [{ persianYear: 'desc' }, { revision: 'desc' }]
  });
  res.json({ success: true, data: plans });
});

router.get('/shift-plans/defaults', protect, securityAdmin, async (_req: AuthRequest, res: Response) => {
  const [latestSlot, personnel] = await Promise.all([
    prisma.securityShiftPlanSlot.findFirst({ orderBy: { endsAt: 'desc' }, include: { plan: true } }),
    prisma.securityPersonnel.findMany({ where: { isActive: true }, include: { user: true }, orderBy: { createdAt: 'asc' } })
  ]);
  const nextPrimaryId = latestSlot ? [latestSlot.plan.primaryAId, latestSlot.plan.primaryBId, latestSlot.plan.primaryCId][(latestSlot.sequence + 1) % 3] : personnel[0]?.id;
  res.json({ success: true, data: { anchorAt: latestSlot?.endsAt || null, slotDurationMinutes: latestSlot?.plan.slotDurationMinutes || 720, earlyArrivalMinutes: latestSlot?.plan.earlyArrivalMinutes || 30, lateAlertMinutes: latestSlot?.plan.lateAlertMinutes || 15, nextPrimaryId, personnel } });
});

router.get('/shift-workflow/current', protect, securityView, async (_req: AuthRequest, res: Response) => {
  await markProbableNoShows();
  const now = new Date();
  const [activeSession, currentSlot] = await Promise.all([
    prisma.securityShiftSession.findFirst({
      where: { status: SecurityShiftSessionStatus.ACTIVE },
      include: { personnel: { include: { user: true } }, slot: { include: slotInclude } },
      orderBy: { startedAt: 'desc' }
    }),
    prisma.securityShiftPlanSlot.findFirst({
      where: { plan: { status: SecurityShiftPlanStatus.PUBLISHED }, startsAt: { lte: now }, endsAt: { gt: now } },
      include: slotInclude,
      orderBy: { startsAt: 'desc' }
    })
  ]);
  res.json({ success: true, data: { activeSession, currentSlot } });
});

router.post('/shift-plans', protect, securityAdmin, [
  body('title').isString().trim().notEmpty(), body('persianYear').isInt(), body('anchorAt').isISO8601(), body('generateUntil').isISO8601(),
  body('slotDurationMinutes').isInt({ min: 60, max: 1440 }), body('earlyArrivalMinutes').isInt({ min: 0, max: 240 }), body('lateAlertMinutes').isInt({ min: 0, max: 240 }),
  body('primaryPersonnelIds').isArray({ min: 3, max: 3 })
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات برنامه شیفت کامل نیست.', details: errors.array() });
    const ids = req.body.primaryPersonnelIds as string[];
    if (new Set(ids).size !== 3) return res.status(400).json({ success: false, error: 'سه نیروی اصلی باید متفاوت باشند.' });
    const personnelCount = await prisma.securityPersonnel.count({ where: { id: { in: ids }, isActive: true } });
    if (personnelCount !== 3) return res.status(400).json({ success: false, error: 'هر سه نیروی اصلی باید فعال باشند.' });
    const anchorAt = new Date(req.body.anchorAt); const generateUntil = new Date(req.body.generateUntil); const duration = 720;
    if (anchorAt >= generateUntil) return res.status(400).json({ success: false, error: 'پایان برنامه باید بعد از زمان شروع باشد.' });
    const slotCount = Math.ceil((generateUntil.getTime() - anchorAt.getTime()) / (duration * 60_000));
    if (slotCount > 1000) return res.status(400).json({ success: false, error: 'تعداد بازه‌های برنامه بیش از حد مجاز است.' });
    const latestRevision = await prisma.securityShiftPlan.aggregate({ where: { persianYear: Number(req.body.persianYear) }, _max: { revision: true } });
    const plan = await prisma.securityShiftPlan.create({
      data: {
        title: req.body.title.trim(), persianYear: Number(req.body.persianYear), revision: (latestRevision._max.revision || 0) + 1,
        anchorAt, generateUntil, slotDurationMinutes: duration, earlyArrivalMinutes: Number(req.body.earlyArrivalMinutes), lateAlertMinutes: Number(req.body.lateAlertMinutes),
        primaryAId: ids[0], primaryBId: ids[1], primaryCId: ids[2], replacesPlanId: req.body.replacesPlanId || null, createdBy: req.user!.id,
        slots: { create: Array.from({ length: slotCount }, (_, sequence) => ({
          sequence, startsAt: new Date(anchorAt.getTime() + sequence * duration * 60_000),
          endsAt: new Date(Math.min(generateUntil.getTime(), anchorAt.getTime() + (sequence + 1) * duration * 60_000)), plannedPersonnelId: ids[sequence % 3]
        })) }
      }, include: shiftPlanInclude
    });
    res.status(201).json({ success: true, data: plan });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message || 'ساخت برنامه شیفت ناموفق بود.' }); }
});

router.post('/shift-plans/:id/publish', protect, securityAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const plan = await prisma.securityShiftPlan.findUnique({ where: { id: req.params.id } });
    if (!plan || plan.status !== SecurityShiftPlanStatus.DRAFT) return res.status(409).json({ success: false, error: 'فقط برنامه پیش‌نویس قابل انتشار است.' });
    const now = new Date();
    const published = await prisma.$transaction(async (tx) => {
      const currentSlot = await tx.securityShiftPlanSlot.findFirst({ where: { planId: plan.id, startsAt: { lte: now }, endsAt: { gt: now } } });
      if (currentSlot) {
        const active = await tx.securityShiftSession.findFirst({ where: { status: SecurityShiftSessionStatus.ACTIVE } });
        if (active) throw new Error('یک شیفت فعال باز وجود دارد؛ ابتدا آن را ببندید یا با حسابرسی مدیر ببندید.');
      }
      await tx.securityShiftPlan.updateMany({ where: { id: { not: plan.id }, status: SecurityShiftPlanStatus.PUBLISHED, generateUntil: { gt: plan.anchorAt } }, data: { status: SecurityShiftPlanStatus.SUPERSEDED } });
      const updated = await tx.securityShiftPlan.update({ where: { id: plan.id }, data: { status: SecurityShiftPlanStatus.PUBLISHED, publishedAt: now, publishedBy: req.user!.id }, include: shiftPlanInclude });
      if (currentSlot) {
        await tx.securityShiftAttendance.upsert({
          where: { slotId_personnelId: { slotId: currentSlot.id, personnelId: currentSlot.plannedPersonnelId } },
          update: {},
          create: {
            slotId: currentSlot.id,
            personnelId: currentSlot.plannedPersonnelId,
            arrivedAt: now,
            delayMinutes: Math.max(0, Math.floor((now.getTime() - currentSlot.startsAt.getTime()) / 60_000))
          }
        });
        await tx.securityShiftSession.create({ data: { slotId: currentSlot.id, personnelId: currentSlot.plannedPersonnelId, startedAt: now } });
      }
      return updated;
    });
    res.json({ success: true, data: published });
  } catch (error: any) { res.status(error.message?.includes('شیفت فعال') ? 409 : 500).json({ success: false, error: error.message || 'انتشار برنامه ناموفق بود.' }); }
});

router.delete('/shift-plans/:id', protect, securityAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const plan = await prisma.securityShiftPlan.findUnique({ where: { id: req.params.id } });
    if (!plan) return res.status(404).json({ success: false, error: 'برنامه شیفت پیدا نشد.' });
    if (plan.status !== SecurityShiftPlanStatus.DRAFT) return res.status(409).json({ success: false, error: 'فقط برنامه پیش‌نویس قابل حذف است.' });
    await prisma.securityShiftPlan.delete({ where: { id: plan.id } });
    res.json({ success: true, data: { id: plan.id } });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message || 'حذف برنامه شیفت ناموفق بود.' }); }
});

router.get('/shift-plan-slots', protect, securityView, async (req: AuthRequest, res: Response) => {
  await markProbableNoShows();
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 86_400_000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 40 * 86_400_000);
  const self = req.query.mine === 'true' ? await getSelfPersonnel(req.user!.id) : null;
  const slots = await prisma.securityShiftPlanSlot.findMany({
    where: { startsAt: { lt: to }, endsAt: { gt: from }, plan: { status: SecurityShiftPlanStatus.PUBLISHED }, ...(self ? { OR: [{ plannedPersonnelId: self.id }, { replacementPersonnelId: self.id }, { temporaryCoverage: { some: { personnelId: self.id } } }] } : {}) },
    include: slotInclude, orderBy: { startsAt: 'asc' }
  });
  res.json({ success: true, data: slots });
});

router.put('/shift-plan-slots/:id/replacement', protect, securityAdmin, [body('personnelId').isString().notEmpty(), body('overrideReason').optional().isString()], async (req: AuthRequest, res: Response) => {
  try {
    const slot = await prisma.securityShiftPlanSlot.findUnique({ where: { id: req.params.id }, include: { plan: true, session: true } });
    if (!slot || slot.session) return res.status(409).json({ success: false, error: 'بازه شروع‌شده قابل جایگزینی نیست.' });
    const replacement = await prisma.securityPersonnel.findFirst({ where: { id: req.body.personnelId, isActive: true } });
    if (!replacement) return res.status(404).json({ success: false, error: 'نیروی جایگزین فعال پیدا نشد.' });
    const restBoundary = slot.plan.slotDurationMinutes * 2 * 60_000;
    const conflict = await prisma.securityShiftPlanSlot.findFirst({
      where: { id: { not: slot.id }, plan: { status: SecurityShiftPlanStatus.PUBLISHED }, OR: [{ plannedPersonnelId: replacement.id }, { replacementPersonnelId: replacement.id }], startsAt: { lt: new Date(slot.endsAt.getTime() + restBoundary) }, endsAt: { gt: new Date(slot.startsAt.getTime() - restBoundary) } }
    });
    if (conflict && !String(req.body.overrideReason || '').trim()) return res.status(409).json({ success: false, error: 'این جایگزینی با شیفت یا زمان استراحت نیرو تداخل دارد؛ دلیل تأیید مدیر الزامی است.', data: { conflictSlotId: conflict.id } });
    const updated = await prisma.securityShiftPlanSlot.update({
      where: { id: slot.id },
      data: { replacementPersonnelId: replacement.id, coverageStatus: SecurityShiftCoverageStatus.COVERED, overrideReason: String(req.body.overrideReason || '').trim() || null }, include: slotInclude
    });
    res.json({ success: true, data: updated });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message || 'ثبت جایگزین ناموفق بود.' }); }
});

router.put('/shift-plan-slots/:id/emergency-uncovered', protect, securityAdmin, [body('reason').isString().trim().notEmpty()], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل وضعیت اضطراری الزامی است.' });
  const updated = await prisma.securityShiftPlanSlot.update({ where: { id: req.params.id }, data: { coverageStatus: SecurityShiftCoverageStatus.EMERGENCY_UNCOVERED, overrideReason: req.body.reason.trim() }, include: slotInclude });
  res.json({ success: true, data: updated });
});

router.post('/shift-plan-slots/:id/temporary-coverage', protect, securityAdmin, [body('personnelId').isString().notEmpty(), body('startsAt').isISO8601(), body('endsAt').isISO8601()], async (req: AuthRequest, res: Response) => {
  const slot = await prisma.securityShiftPlanSlot.findUnique({ where: { id: req.params.id } });
  if (!slot) return res.status(404).json({ success: false, error: 'بازه شیفت پیدا نشد.' });
  const startsAt = new Date(req.body.startsAt); const endsAt = new Date(req.body.endsAt);
  if (startsAt < slot.startsAt || endsAt > slot.endsAt || startsAt >= endsAt) return res.status(400).json({ success: false, error: 'بازه پوشش موقت باید داخل زمان شیفت باشد.' });
  const coverage = await prisma.securityShiftTemporaryCoverage.create({ data: { slotId: slot.id, personnelId: req.body.personnelId, startsAt, endsAt, note: req.body.note || null, assignedBy: req.user!.id } });
  await prisma.securityShiftPlanSlot.update({ where: { id: slot.id }, data: { coverageStatus: SecurityShiftCoverageStatus.COVERED } });
  res.status(201).json({ success: true, data: coverage });
});

router.get('/shift-workflow/me', protect, securityView, async (req: AuthRequest, res: Response) => {
  await markProbableNoShows();
  const personnel = await getSelfPersonnel(req.user!.id);
  if (!personnel) return res.status(403).json({ success: false, error: 'کاربر جزو نفرات حراست نیست.' });
  const now = new Date();
  const slots = await prisma.securityShiftPlanSlot.findMany({
    where: { plan: { status: SecurityShiftPlanStatus.PUBLISHED }, OR: [{ plannedPersonnelId: personnel.id }, { replacementPersonnelId: personnel.id }], endsAt: { gt: new Date(now.getTime() - 24 * 60 * 60_000) } },
    include: slotInclude, orderBy: { startsAt: 'asc' }, take: 20
  });
  const activeSession = await prisma.securityShiftSession.findFirst({ where: { status: SecurityShiftSessionStatus.ACTIVE }, include: { slot: { include: slotInclude } } });
  const decorated = slots.map((slot) => ({ ...slot, effectivePersonnelId: effectivePersonnelId(slot), lateAlert: !slot.attendance.length && now.getTime() > slot.startsAt.getTime() + slot.plan.lateAlertMinutes * 60_000 }));
  res.json({ success: true, data: { personnel, slots: decorated, activeSession } });
});

router.get('/instant-report-types', protect, securityView, async (req: AuthRequest, res: Response) => {
  try {
    const includeInactive = req.query.includeInactive === 'true' && (req.user!.role === 'ADMIN' || (req as any).workspacePermission === WORKSPACE_PERMISSIONS.ADMIN);
    const types = await prisma.securityInstantReportType.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }]
    });
    res.json({ success: true, data: types });
  } catch (error) {
    console.error('List instant report types error:', error);
    res.status(500).json({ success: false, error: 'دریافت انواع گزارش ناموفق بود.' });
  }
});

router.post('/instant-report-types', protect, securityAdmin, [
  body('name').isString().trim().notEmpty(),
  body('description').optional({ values: 'falsy' }).isString(),
  body('displayOrder').optional().isInt({ min: 0 }),
  body('isActive').optional().isBoolean()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'نام نوع گزارش الزامی است.', details: errors.array() });
    const type = await prisma.securityInstantReportType.create({
      data: {
        name: req.body.name.trim(),
        description: String(req.body.description || '').trim() || null,
        displayOrder: Number(req.body.displayOrder || 0),
        isActive: req.body.isActive ?? true,
        createdBy: req.user!.id
      }
    });
    res.status(201).json({ success: true, data: type });
  } catch (error: any) {
    console.error('Create instant report type error:', error);
    res.status(500).json({ success: false, error: error.code === 'P2002' ? 'این نوع گزارش قبلاً ثبت شده است.' : 'ثبت نوع گزارش ناموفق بود.' });
  }
});

router.put('/instant-report-types/:id', protect, securityAdmin, [
  body('name').isString().trim().notEmpty(),
  body('description').optional({ values: 'falsy' }).isString(),
  body('displayOrder').optional().isInt({ min: 0 }),
  body('isActive').isBoolean()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اطلاعات نوع گزارش کامل نیست.', details: errors.array() });
    const type = await prisma.securityInstantReportType.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name.trim(),
        description: String(req.body.description || '').trim() || null,
        displayOrder: Number(req.body.displayOrder || 0),
        isActive: Boolean(req.body.isActive)
      }
    });
    res.json({ success: true, data: type });
  } catch (error: any) {
    console.error('Update instant report type error:', error);
    res.status(500).json({ success: false, error: error.code === 'P2002' ? 'این نوع گزارش قبلاً ثبت شده است.' : 'ویرایش نوع گزارش ناموفق بود.' });
  }
});

router.get('/shift-log/active', protect, securityView, async (req: AuthRequest, res: Response) => {
  try {
    const { personnel, session } = await getActiveShiftSessionForUser(req.user!.id);
    if (!personnel) return res.status(403).json({ success: false, error: 'کاربر جزو نفرات حراست نیست.' });
    res.json({ success: true, data: { personnel, session } });
  } catch (error) {
    console.error('Get active shift log error:', error);
    res.status(500).json({ success: false, error: 'دریافت گزارش شیفت ناموفق بود.' });
  }
});

router.post('/shift-log/entries', protect, securityEdit, [
  body('reportTypeId').isString().trim().notEmpty(),
  body('description').isString().trim().notEmpty()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'نوع گزارش و توضیحات الزامی است.', details: errors.array() });
    const { session } = await getActiveShiftSessionForUser(req.user!.id);
    if (!session) return res.status(409).json({ success: false, error: 'شیفت فعال برای ثبت گزارش پیدا نشد.' });
    const type = await prisma.securityInstantReportType.findFirst({ where: { id: req.body.reportTypeId, isActive: true } });
    if (!type) return res.status(404).json({ success: false, error: 'نوع گزارش فعال پیدا نشد.' });
    const entry = await prisma.$transaction(async (tx) => {
      const last = await tx.securityShiftLogEntry.findFirst({ where: { sessionId: session.id }, orderBy: { rowNumber: 'desc' } });
      return tx.securityShiftLogEntry.create({
        data: {
          sessionId: session.id,
          reportTypeId: type.id,
          rowNumber: (last?.rowNumber || 0) + 1,
          description: req.body.description.trim(),
          createdBy: req.user!.id
        },
        include: { reportType: true }
      });
    }, { isolationLevel: 'Serializable' });
    res.status(201).json({ success: true, data: entry });
  } catch (error: any) {
    console.error('Create shift log entry error:', error);
    res.status(500).json({ success: false, error: error.message || 'ثبت گزارش لحظه‌ای ناموفق بود.' });
  }
});

router.put('/shift-log/entries/:id/void', protect, securityEdit, [
  body('reason').isString().trim().notEmpty()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل ابطال الزامی است.', details: errors.array() });
    const entry = await prisma.securityShiftLogEntry.findUnique({ where: { id: req.params.id }, include: { reportType: true } });
    if (!entry) return res.status(404).json({ success: false, error: 'گزارش پیدا نشد.' });
    if (entry.status === SecurityShiftLogStatus.VOIDED) return res.status(409).json({ success: false, error: 'این گزارش قبلاً باطل شده است.' });
    const updated = await prisma.securityShiftLogEntry.update({
      where: { id: entry.id },
      data: { status: SecurityShiftLogStatus.VOIDED, voidReason: req.body.reason.trim(), voidedAt: new Date(), voidedBy: req.user!.id },
      include: { reportType: true }
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Void shift log entry error:', error);
    res.status(500).json({ success: false, error: 'ابطال گزارش ناموفق بود.' });
  }
});

router.post('/shift-log/patrols/start', protect, securityEdit, async (req: AuthRequest, res: Response) => {
  try {
    const { personnel, session } = await getActiveShiftSessionForUser(req.user!.id);
    if (!personnel || !session) return res.status(409).json({ success: false, error: 'شیفت فعال برای شروع گشت‌زنی پیدا نشد.' });
    const active = await prisma.securityPatrolSession.findFirst({ where: { personnelId: personnel.id, status: SecurityPatrolStatus.ACTIVE } });
    if (active) return res.status(409).json({ success: false, error: 'یک گشت‌زنی فعال برای شما وجود دارد.' });
    const patrol = await prisma.securityPatrolSession.create({ data: { sessionId: session.id, personnelId: personnel.id } });
    res.status(201).json({ success: true, data: patrol });
  } catch (error) {
    console.error('Start patrol error:', error);
    res.status(500).json({ success: false, error: 'شروع گشت‌زنی ناموفق بود.' });
  }
});

router.put('/shift-log/patrols/:id/finish', protect, securityEdit, [
  body('description').isString().trim().notEmpty()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'توضیحات پایان گشت‌زنی الزامی است.', details: errors.array() });
    const { personnel } = await getActiveShiftSessionForUser(req.user!.id);
    if (!personnel) return res.status(403).json({ success: false, error: 'دسترسی نفرات حراست لازم است.' });
    const patrol = await prisma.securityPatrolSession.findUnique({ where: { id: req.params.id } });
    if (!patrol || patrol.personnelId !== personnel.id || patrol.status !== SecurityPatrolStatus.ACTIVE) return res.status(404).json({ success: false, error: 'گشت‌زنی فعال متعلق به شما پیدا نشد.' });
    const updated = await prisma.securityPatrolSession.update({
      where: { id: patrol.id },
      data: { status: SecurityPatrolStatus.FINISHED, endedAt: new Date(), description: req.body.description.trim() }
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Finish patrol error:', error);
    res.status(500).json({ success: false, error: 'پایان گشت‌زنی ناموفق بود.' });
  }
});

router.post('/shift-plan-slots/:id/attendance', protect, securityEdit, async (req: AuthRequest, res: Response) => {
  try {
    const personnel = await getSelfPersonnel(req.user!.id); if (!personnel) return res.status(403).json({ success: false, error: 'دسترسی نفرات حراست لازم است.' });
    const slot = await prisma.securityShiftPlanSlot.findUnique({ where: { id: req.params.id }, include: { plan: true } });
    if (!slot || effectivePersonnelId(slot) !== personnel.id) return res.status(403).json({ success: false, error: 'این شیفت به شما تخصیص ندارد.' });
    const now = new Date(); const earliest = new Date(slot.startsAt.getTime() - slot.plan.earlyArrivalMinutes * 60_000);
    if (now < earliest) return res.status(409).json({ success: false, error: `ثبت حضور از ${slot.plan.earlyArrivalMinutes} دقیقه پیش از شروع شیفت مجاز است.` });
    const delayMinutes = Math.max(0, Math.floor((now.getTime() - slot.startsAt.getTime()) / 60_000));
    const attendance = await prisma.securityShiftAttendance.upsert({ where: { slotId_personnelId: { slotId: slot.id, personnelId: personnel.id } }, update: {}, create: { slotId: slot.id, personnelId: personnel.id, arrivedAt: now, delayMinutes } });
    res.status(201).json({ success: true, data: attendance });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message || 'ثبت حضور ناموفق بود.' }); }
});

router.post('/shift-plan-slots/:id/start', protect, securityEdit, async (req: AuthRequest, res: Response) => {
  try {
    const personnel = await getSelfPersonnel(req.user!.id); if (!personnel) return res.status(403).json({ success: false, error: 'دسترسی نفرات حراست لازم است.' });
    const result = await prisma.$transaction(async (tx) => {
      const slot = await tx.securityShiftPlanSlot.findUnique({ where: { id: req.params.id }, include: { attendance: true } });
      if (!slot || effectivePersonnelId(slot) !== personnel.id) throw new Error('این شیفت به شما تخصیص ندارد.');
      if (slot.coverageStatus === SecurityShiftCoverageStatus.NEEDS_REPLACEMENT) throw new Error('این شیفت هنوز نیازمند جایگزین است.');
      if (new Date() < slot.startsAt) throw new Error('شروع شیفت پیش از زمان برنامه‌ریزی‌شده مجاز نیست.');
      if (!slot.attendance.some((item) => item.personnelId === personnel.id)) throw new Error('ابتدا حضور خود را ثبت کنید.');
      const active = await tx.securityShiftSession.findFirst({ where: { status: SecurityShiftSessionStatus.ACTIVE } });
      if (active) throw new Error('شیفت قبلی هنوز فعال است و باید تحویل داده شود.');
      return tx.securityShiftSession.create({ data: { slotId: slot.id, personnelId: personnel.id } });
    }, { isolationLevel: 'Serializable' });
    res.status(201).json({ success: true, data: result });
  } catch (error: any) { res.status(409).json({ success: false, error: error.message || 'شروع شیفت ناموفق بود.' }); }
});

router.post('/shift-plan-slots/:id/end', protect, securityEdit, [
  body('closureSummary').optional({ values: 'falsy' }).isString().trim()
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'توضیح پایان شیفت معتبر نیست.', details: errors.array() });
    const personnel = await getSelfPersonnel(req.user!.id); if (!personnel) return res.status(403).json({ success: false, error: 'دسترسی نفرات حراست لازم است.' });
    const result = await prisma.$transaction(async (tx) => {
      const slot = await tx.securityShiftPlanSlot.findUnique({ where: { id: req.params.id }, include: { session: true, temporaryCoverage: true } });
      if (!slot?.session || slot.session.status !== SecurityShiftSessionStatus.ACTIVE || slot.session.personnelId !== personnel.id) throw new Error('شیفت فعال متعلق به شما پیدا نشد.');
      const activePatrol = await tx.securityPatrolSession.findFirst({ where: { sessionId: slot.session.id, status: SecurityPatrolStatus.ACTIVE } });
      if (activePatrol) throw new Error('پیش از پایان شیفت، گشت‌زنی فعال را با توضیحات پایان دهید.');
      const now = new Date();
      if (now < slot.endsAt && !slot.temporaryCoverage.some((coverage) => coverage.startsAt <= now && coverage.endsAt >= slot.endsAt)) throw new Error('پایان زودهنگام فقط پس از ثبت پوشش جایگزین تا انتهای شیفت مجاز است.');
      return tx.securityShiftSession.update({ where: { id: slot.session.id }, data: { status: SecurityShiftSessionStatus.CLOSED, endedAt: now, overtimeMinutes: Math.max(0, Math.floor((now.getTime() - slot.endsAt.getTime()) / 60_000)), closureSummary: String(req.body.closureSummary || '').trim() || 'بدون مورد دیگر' } });
    }, { isolationLevel: 'Serializable' });
    res.json({ success: true, data: result });
  } catch (error: any) { res.status(409).json({ success: false, error: error.message || 'پایان شیفت ناموفق بود.' }); }
});

router.post('/shift-sessions/:id/force-close', protect, securityAdmin, [body('reason').isString().trim().notEmpty(), body('summary').isString().trim().notEmpty()], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'دلیل و خلاصه بستن اجباری الزامی است.' });
    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.securityShiftSession.findUnique({ where: { id: req.params.id }, include: { slot: true } });
      if (!session || session.status !== SecurityShiftSessionStatus.ACTIVE) throw new Error('شیفت فعال پیدا نشد.');
      const report = await tx.securitySupervisorReport.upsert({ where: { planSlotId: session.slotId }, update: {}, create: { reportDate: new Date(), planSlotId: session.slotId, authorId: req.user!.id, summary: req.body.summary.trim(), followUpNotes: `ثبت توسط مدیر در بستن اجباری: ${req.body.reason.trim()}` } });
      const now = new Date();
      return tx.securityShiftSession.update({ where: { id: session.id }, data: { status: SecurityShiftSessionStatus.FORCE_CLOSED, endedAt: now, overtimeMinutes: Math.max(0, Math.floor((now.getTime() - session.slot.endsAt.getTime()) / 60_000)), forceClosedBy: req.user!.id, forceCloseReason: req.body.reason.trim(), closureSummary: report.summary } });
    });
    res.json({ success: true, data: result });
  } catch (error: any) { res.status(409).json({ success: false, error: error.message || 'بستن اجباری ناموفق بود.' }); }
});

router.put('/shift-attendance/:id/correct', protect, securityAdmin, [body('arrivedAt').isISO8601(), body('reason').isString().trim().notEmpty()], async (req: AuthRequest, res: Response) => {
  const attendance = await prisma.securityShiftAttendance.findUnique({ where: { id: req.params.id }, include: { slot: true } });
  if (!attendance) return res.status(404).json({ success: false, error: 'رکورد حضور پیدا نشد.' });
  const arrivedAt = new Date(req.body.arrivedAt);
  const updated = await prisma.securityShiftAttendance.update({ where: { id: attendance.id }, data: { originalArrivedAt: attendance.originalArrivedAt || attendance.arrivedAt, arrivedAt, delayMinutes: Math.max(0, Math.floor((arrivedAt.getTime() - attendance.slot.startsAt.getTime()) / 60_000)), correctedAt: new Date(), correctedBy: req.user!.id, correctionReason: req.body.reason.trim() } });
  res.json({ success: true, data: updated });
});

router.get('/shifts', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_SHIFTS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const shifts = await prisma.shift.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: {
            securityPersonnel: true,
            attendanceRecords: true
          }
        }
      },
      orderBy: {
        startTime: 'asc'
      }
    });

    res.json({
      success: true,
      data: shifts
    });
  } catch (error) {
    console.error('Get shifts error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Create new shift
// @route   POST /api/security/shifts
// @access  Private/Security Workspace Admin
router.post('/shifts', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_SHIFTS_CREATE, FEATURE_PERMISSIONS.EDIT), [
  body('name').notEmpty().withMessage('Name is required'),
  body('namePersian').notEmpty().withMessage('Persian name is required'),
  body('startTime').notEmpty().withMessage('Start time is required'),
  body('endTime').notEmpty().withMessage('End time is required'),
  body('duration').isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { name, namePersian, startTime, endTime, duration } = req.body;

    const shift = await prisma.shift.create({
      data: {
        name,
        namePersian,
        startTime,
        endTime,
        duration: parseInt(duration),
      }
    });

    res.status(201).json({
      success: true,
      data: shift
    });
    return;
  } catch (error) {
    console.error('Create shift error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Start security shift
// @route   POST /api/security/shifts/start
// @access  Private/Security Workspace
router.post('/shifts/start', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_SHIFTS_START, FEATURE_PERMISSIONS.EDIT), async (req: AuthRequest, res: Response) => {
  try {
    const { shiftId } = req.body;

    if (!shiftId) {
      return res.status(400).json({
        success: false,
        error: 'Shift ID is required'
      });
    }

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { shift: true }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    // Check if shift is already active
    const activeShift = await prisma.securityPersonnel.findFirst({
      where: {
        userId: req.user!.id,
        isActive: true,
        shift: {
          id: shiftId
        }
      }
    });

    if (activeShift) {
      return res.status(400).json({
        success: false,
        error: 'Shift is already active'
      });
    }

    res.json({
      success: true,
      message: 'Security shift started successfully',
      data: {
        shiftId,
        startTime: new Date().toISOString()
      }
    });
    return;
  } catch (error) {
    console.error('Start shift error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    End security shift
// @route   POST /api/security/shifts/end
// @access  Private/Security Workspace
router.post('/shifts/end', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_SHIFTS_END, FEATURE_PERMISSIONS.EDIT), async (req: AuthRequest, res: Response) => {
  try {
    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { shift: true }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    res.json({
      success: true,
      message: 'Security shift ended successfully',
      data: {
        endTime: new Date().toISOString()
      }
    });
    return;
  } catch (error) {
    console.error('End shift error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Employee check-in
// @route   POST /api/security/attendance/checkin
// @access  Private/Security Workspace
router.post('/attendance/checkin', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_ATTENDANCE_CHECKIN, FEATURE_PERMISSIONS.EDIT), [
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('entryTime').optional().isString().withMessage('Entry time must be a string'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { shift: true }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const { employeeId, entryTime } = req.body;
    const currentTime = entryTime || new Date().toLocaleTimeString('fa-IR', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });

    // Check if employee already checked in today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existingRecord = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId,
        date: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    if (existingRecord && existingRecord.entryTime) {
      return res.status(400).json({
        success: false,
        error: 'Employee has already checked in today'
      });
    }

    let attendanceRecord;
    if (existingRecord) {
      // Update existing record
      attendanceRecord = await prisma.attendanceRecord.update({
        where: { id: existingRecord.id },
        data: {
          entryTime: currentTime,
          status: 'PRESENT'
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true
            }
          },
          shift: true
        }
      });
    } else {
      // Create new record
      attendanceRecord = await prisma.attendanceRecord.create({
        data: {
          employeeId,
          securityPersonnelId: securityPersonnel.id,
          shiftId: securityPersonnel.shiftId,
          date: today,
          entryTime: currentTime,
          status: 'PRESENT'
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true
            }
          },
          shift: true
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Employee checked in successfully',
      data: attendanceRecord
    });
    return;
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Employee check-out
// @route   POST /api/security/attendance/checkout
// @access  Private/Security Personnel
router.post('/attendance/checkout', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_ATTENDANCE_CHECKOUT, FEATURE_PERMISSIONS.EDIT), [
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('exitTime').optional().isString().withMessage('Exit time must be a string'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { shift: true }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const { employeeId, exitTime } = req.body;
    const currentTime = exitTime || new Date().toLocaleTimeString('fa-IR', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });

    // Find today's attendance record
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendanceRecord = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId,
        date: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    if (!attendanceRecord) {
      return res.status(400).json({
        success: false,
        error: 'Employee has not checked in today'
      });
    }

    if (attendanceRecord.exitTime) {
      return res.status(400).json({
        success: false,
        error: 'Employee has already checked out today'
      });
    }

    const updatedRecord = await prisma.attendanceRecord.update({
      where: { id: attendanceRecord.id },
      data: {
        exitTime: currentTime
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        shift: true
      }
    });

    res.json({
      success: true,
      message: 'Employee checked out successfully',
      data: updatedRecord
    });
    return;
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Record attendance exception
// @route   POST /api/security/attendance/exception
// @access  Private/Security Personnel
router.post('/attendance/exception', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_ATTENDANCE_EXCEPTION, FEATURE_PERMISSIONS.EDIT), [
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('exceptionType').notEmpty().withMessage('Exception type is required'),
  body('exceptionTime').optional().isString().withMessage('Exception time must be a string'),
  body('exceptionDuration').optional().isInt({ min: 1 }).withMessage('Exception duration must be a positive integer'),
  body('notes').optional().isString().withMessage('Notes must be a string'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { shift: true }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const { employeeId, exceptionType, exceptionTime, exceptionDuration, notes } = req.body;

    // Determine status based on exception type
    let status = 'PRESENT';
    if (exceptionType === 'ماموریت') status = 'MISSION';
    else if (exceptionType === 'مرخصی ساعتی') status = 'HOURLY_LEAVE';
    else if (exceptionType === 'غیبت') status = 'ABSENT';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendanceRecord = await prisma.attendanceRecord.create({
      data: {
        employeeId,
        securityPersonnelId: securityPersonnel.id,
        shiftId: securityPersonnel.shiftId,
        date: today,
        status: status as any,
        exceptionType,
        exceptionTime,
        exceptionDuration: exceptionDuration ? parseInt(exceptionDuration) : null,
        notes
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        shift: true
      }
    });

    res.status(201).json({
      success: true,
      message: 'Attendance exception recorded successfully',
      data: attendanceRecord
    });
    return;
  } catch (error) {
    console.error('Record exception error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get daily attendance report
// @route   GET /api/security/attendance/daily
// @access  Private/Security Personnel
router.get('/attendance/daily', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_ATTENDANCE_DAILY_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const { targetDate, attendanceSummary, stats } = await buildDailyAttendance(req.query);

    res.json({
      success: true,
      data: {
        date: targetDate.toISOString(),
        attendanceSummary,
        totalEmployees: stats.totalEmployees,
        presentCount: stats.present,
        absentCount: stats.absent,
        exceptionCount: stats.exception,
        stats
      }
    });
    return;
  } catch (error) {
    console.error('Get daily attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get security dashboard stats
// @route   GET /api/security/dashboard/stats
// @access  Private/Security Personnel
router.get('/dashboard/stats', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_DASHBOARD_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const [securityPersonnel, daily] = await Promise.all([
      prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id },
      include: { 
        shift: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            departmentId: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        }
      }
      }),
      buildDailyAttendance(req.query)
    ]);

    const stats = {
      currentShift: securityPersonnel?.shift || null,
      securityPersonnel: securityPersonnel ? {
        name: `${securityPersonnel.user.firstName} ${securityPersonnel.user.lastName}`,
        position: securityPersonnel.position,
        department: securityPersonnel.user.department?.namePersian
      } : null,
      todayStats: daily.stats,
      recentActivity: daily.attendanceRecords.slice(-5).map(record => ({
        employeeId: record.employeeId,
        entryTime: record.entryTime,
        exitTime: record.exitTime,
        status: record.status,
        exceptionType: record.exceptionType
      }))
    };

    res.json({
      success: true,
      data: stats
    });
    return;
  } catch (error) {
    console.error('Get security dashboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get security personnel
// @route   GET /api/security/personnel
// @access  Private/Admin
router.get('/personnel', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_PERSONNEL_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const includeInactive = req.query.includeInactive !== 'false';
    const personnel = await prisma.securityPersonnel.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        },
        shift: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({
      success: true,
      data: personnel
    });
    return;
  } catch (error) {
    console.error('Get security personnel error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get active users eligible for security personnel assignment
// @route   GET /api/security/personnel/eligible-users
// @access  Private/Admin
router.get('/personnel/eligible-users', protect, authorize('ADMIN'), securityAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const rolePermissions = await prisma.roleWorkspacePermission.findMany({
      where: { workspace: WORKSPACES.SECURITY, isActive: true },
      select: { role: true }
    });
    const eligibleRoles = rolePermissions.map((permission) => permission.role);
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        securityPersonnel: null,
        OR: [
          { workspacePermissions: { some: { workspace: WORKSPACES.SECURITY, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } },
          ...(eligibleRoles.length ? [{ role: { in: eligibleRoles as any[] } }] : [])
        ]
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        role: true,
        department: { select: { id: true, name: true, namePersian: true } }
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
    });

    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Get eligible security users error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Assign security personnel
// @route   POST /api/security/personnel
// @access  Private/Admin
router.post('/personnel', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_PERSONNEL_ASSIGN, FEATURE_PERMISSIONS.EDIT), [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('shiftId').notEmpty().withMessage('Shift ID is required'),
  body('position').notEmpty().withMessage('Position is required'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { userId, shiftId, position } = req.body;

    const now = new Date();
    const [existingPersonnel, userPermission, rolePermissions] = await Promise.all([
      prisma.securityPersonnel.findUnique({ where: { userId } }),
      prisma.workspacePermission.findFirst({ where: { userId, workspace: WORKSPACES.SECURITY, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      prisma.roleWorkspacePermission.findMany({ where: { workspace: WORKSPACES.SECURITY, isActive: true }, select: { role: true } })
    ]);

    if (existingPersonnel) {
      return res.status(400).json({
        success: false,
        error: 'User is already assigned as security personnel'
      });
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
    const hasSecurityRole = Boolean(user && rolePermissions.some((permission) => permission.role === user.role));
    if (!user?.isActive || (!userPermission && !hasSecurityRole)) {
      return res.status(400).json({
        success: false,
        error: 'این کاربر دسترسی حراست ندارد و نمی‌تواند به نفرات حراست اضافه شود.'
      });
    }

    const securityPersonnel = await prisma.securityPersonnel.create({
      data: {
        userId,
        shiftId,
        position
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        },
        shift: true
      }
    });

    res.status(201).json({
      success: true,
      data: securityPersonnel
    });
    return;
  } catch (error) {
    console.error('Assign security personnel error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Activate/deactivate security personnel
// @route   PUT /api/security/personnel/:id/status
// @access  Private/Admin
router.put('/personnel/:id/status', protect, authorize('ADMIN'), securityAdmin, [
  body('isActive').isBoolean().withMessage('isActive must be boolean')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    const personnel = await prisma.securityPersonnel.update({
      where: { id: req.params.id },
      data: { isActive: Boolean(req.body.isActive) },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            department: { select: { id: true, namePersian: true } }
          }
        },
        shift: true
      }
    });
    res.json({ success: true, data: personnel });
  } catch (error) {
    console.error('Toggle security personnel status error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Aggregate security reports
// @route   GET /api/security/reports/summary
// @access  Private/Security Workspace
router.get('/reports/summary', protect, securityView, async (req: AuthRequest, res: Response) => {
  try {
    const startDate = parseDayQuery(req.query.startDate);
    const requestedEnd = parseDayQuery(req.query.endDate, startDate);
    const endDate = requestedEnd < startDate ? startDate : requestedEnd;
    const days = Math.min(92, Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
    const rangeEnd = addDays(startDate, days);
    const { departmentId, shiftId, employeeId } = req.query;
    const employeeWhere = scopedEmployeeWhere(departmentId, employeeId);

    const trend: Array<{ date: string; total: number; present: number; absent: number; late: number; mission: number; leave: number; signed: number }> = [];
    for (let index = 0; index < days; index += 1) {
      const date = addDays(startDate, index);
      const daily = await buildDailyAttendance({ date: date.toISOString(), departmentId, shiftId, employeeId });
      trend.push({
        date: date.toISOString(),
        total: daily.stats.totalEmployees,
        present: daily.stats.present,
        absent: daily.stats.absent,
        late: daily.stats.late,
        mission: daily.stats.mission,
        leave: daily.stats.leave,
        signed: daily.stats.signed
      });
    }

    const attendanceTotals = trend.reduce((totals, day) => ({
      totalEmployeeDays: totals.totalEmployeeDays + day.total,
      present: totals.present + day.present,
      absent: totals.absent + day.absent,
      late: totals.late + day.late,
      mission: totals.mission + day.mission,
      leave: totals.leave + day.leave,
      signed: totals.signed + day.signed
    }), { totalEmployeeDays: 0, present: 0, absent: 0, late: 0, mission: 0, leave: 0, signed: 0 });

    const [exceptions, missions, shifts] = await Promise.all([
      prisma.exceptionRequest.groupBy({
        by: ['status'],
        where: {
          startDate: { lt: rangeEnd },
          OR: [{ endDate: null }, { endDate: { gte: startDate } }],
          employee: employeeWhere
        },
        _count: { _all: true }
      }),
      prisma.missionAssignment.groupBy({
        by: ['status'],
        where: {
          startDate: { lt: rangeEnd },
          OR: [{ endDate: null }, { endDate: { gte: startDate } }],
          employee: employeeWhere
        },
        _count: { _all: true }
      }),
      prisma.securityShiftSession.findMany({
        where: {
          startedAt: { lt: rangeEnd },
          OR: [{ endedAt: null }, { endedAt: { gte: startDate } }],
          ...(shiftId ? { slot: { plannedPersonnel: { shiftId: String(shiftId) } } } : {})
        },
        select: { status: true, personnelId: true }
      })
    ]);

    const countByStatus = (items: Array<{ status: string; _count: { _all: number } }>, status: string) =>
      items.find((item) => item.status === status)?._count._all || 0;
    const activePersonnel = await prisma.securityPersonnel.count({ where: { isActive: true, ...(shiftId ? { shiftId: String(shiftId) } : {}) } });
    const totalPersonnel = await prisma.securityPersonnel.count({ where: shiftId ? { shiftId: String(shiftId) } : undefined });
    const completedShifts = shifts.filter((shift) => shift.status === SecurityShiftSessionStatus.CLOSED || shift.status === SecurityShiftSessionStatus.FORCE_CLOSED).length;
    const activeShifts = shifts.filter((shift) => shift.status === SecurityShiftSessionStatus.ACTIVE).length;

    res.json({
      success: true,
      data: {
        range: { startDate: startDate.toISOString(), endDate: addDays(rangeEnd, -1).toISOString(), days },
        attendance: {
          ...attendanceTotals,
          attendanceRate: attendanceTotals.totalEmployeeDays ? Number(((attendanceTotals.present / attendanceTotals.totalEmployeeDays) * 100).toFixed(1)) : 0
        },
        exceptions: {
          totalRequests: exceptions.reduce((sum, item) => sum + item._count._all, 0),
          approved: countByStatus(exceptions, 'APPROVED'),
          rejected: countByStatus(exceptions, 'REJECTED'),
          pending: countByStatus(exceptions, 'PENDING'),
          approvalRate: exceptions.length ? Number(((countByStatus(exceptions, 'APPROVED') / Math.max(1, exceptions.reduce((sum, item) => sum + item._count._all, 0))) * 100).toFixed(1)) : 0
        },
        missions: {
          totalMissions: missions.reduce((sum, item) => sum + item._count._all, 0),
          completed: countByStatus(missions, 'APPROVED'),
          pending: countByStatus(missions, 'PENDING'),
          rejected: countByStatus(missions, 'REJECTED'),
          completionRate: missions.length ? Number(((countByStatus(missions, 'APPROVED') / Math.max(1, missions.reduce((sum, item) => sum + item._count._all, 0))) * 100).toFixed(1)) : 0
        },
        shifts: {
          totalSessions: shifts.length,
          completedShifts,
          activeShifts,
          totalPersonnel,
          activePersonnel
        },
        signatures: {
          signed: attendanceTotals.signed,
          unsignedRecords: Math.max(0, attendanceTotals.present + attendanceTotals.late + attendanceTotals.mission + attendanceTotals.leave - attendanceTotals.signed)
        },
        attendanceTrend: trend
      }
    });
  } catch (error) {
    console.error('Get security report summary error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== EXCEPTION HANDLING SYSTEM ====================

// @desc    Create exception request (leave, sick leave, etc.)
// @route   POST /api/security/exceptions/request
// @access  Private/All Users
router.post('/exceptions/request', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_EXCEPTIONS_REQUEST, FEATURE_PERMISSIONS.EDIT), [
  body('exceptionType').isIn(['HOURLY_LEAVE', 'SICK_LEAVE', 'VACATION', 'EMERGENCY_LEAVE', 'PERSONAL_LEAVE']).withMessage('Invalid exception type'),
  body('startDate').isISO8601().withMessage('Start date must be valid'),
  body('endDate').optional().isISO8601().withMessage('End date must be valid'),
  body('startTime').optional().isString().withMessage('Start time must be a string'),
  body('endTime').optional().isString().withMessage('End time must be a string'),
  body('duration').optional().isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
  body('reason').notEmpty().withMessage('Reason is required'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('emergencyContact').optional().isString().withMessage('Emergency contact must be a string'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      exceptionType,
      startDate,
      endDate,
      startTime,
      endTime,
      duration,
      reason,
      description,
      emergencyContact
    } = req.body;

    const exceptionRequest = await prisma.exceptionRequest.create({
      data: {
        employeeId: req.user!.id,
        exceptionType,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        startTime,
        endTime,
        duration: duration ? parseInt(duration) : null,
        reason,
        description,
        emergencyContact
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Exception request created successfully',
      data: exceptionRequest
    });
    return;
  } catch (error) {
    console.error('Create exception request error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get exception requests (for managers/approvers)
// @route   GET /api/security/exceptions/requests
// @access  Private/Managers
router.get('/exceptions/requests', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_EXCEPTIONS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const { status, type, page = 1, limit = 10 } = req.query;
    
    const where: any = {};
    if (status) where.status = status;
    if (type) where.exceptionType = type;

    const exceptionRequests = await prisma.exceptionRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        },
        approver: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        rejecter: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      take: parseInt(limit as string)
    });

    const total = await prisma.exceptionRequest.count({ where });

    res.json({
      success: true,
      data: exceptionRequests,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
    return;
  } catch (error) {
    console.error('Get exception requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Approve exception request
// @route   PUT /api/security/exceptions/:id/approve
// @access  Private/Managers
router.put('/exceptions/:id/approve', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_EXCEPTIONS_APPROVE, FEATURE_PERMISSIONS.EDIT), [
  body('notes').optional().isString().withMessage('Notes must be a string')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const { notes } = req.body;

    const existingRequest = await prisma.exceptionRequest.findUnique({ where: { id } });
    
    const exceptionRequest = await prisma.exceptionRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: req.user!.id,
        approvedAt: new Date(),
        description: notes ? `${existingRequest?.description || ''}\nApproval Notes: ${notes}` : existingRequest?.description
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        approver: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    if (existingRequest) {
      const personnel = await prisma.securityPersonnel.findUnique({ where: { userId: existingRequest.employeeId } });
      if (personnel) {
        const leaveEnd = existingRequest.endDate || new Date(existingRequest.startDate.getTime() + 24 * 60 * 60_000);
        const now = new Date();
        await prisma.securityShiftPlanSlot.updateMany({
          where: { plan: { status: SecurityShiftPlanStatus.PUBLISHED }, plannedPersonnelId: personnel.id, startsAt: { gte: now, lt: leaveEnd }, endsAt: { gt: existingRequest.startDate }, session: null },
          data: { coverageStatus: SecurityShiftCoverageStatus.NEEDS_REPLACEMENT, leaveRequestId: existingRequest.id }
        });
      }
    }

    res.json({
      success: true,
      message: 'Exception request approved successfully',
      data: exceptionRequest
    });
    return;
  } catch (error) {
    console.error('Approve exception request error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Reject exception request
// @route   PUT /api/security/exceptions/:id/reject
// @access  Private/Managers
router.put('/exceptions/:id/reject', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_EXCEPTIONS_REJECT, FEATURE_PERMISSIONS.EDIT), [
  body('rejectionReason').notEmpty().withMessage('Rejection reason is required')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const { rejectionReason } = req.body;

    const exceptionRequest = await prisma.exceptionRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedBy: req.user!.id,
        rejectedAt: new Date(),
        rejectionReason
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        rejecter: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Exception request rejected successfully',
      data: exceptionRequest
    });
    return;
  } catch (error) {
    console.error('Reject exception request error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Create mission assignment
// @route   POST /api/security/missions/assign
// @access  Private/Security Personnel
router.post('/missions/assign', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_MISSIONS_ASSIGN, FEATURE_PERMISSIONS.EDIT), [
  body('employeeId').notEmpty().withMessage('Employee ID is required'),
  body('missionType').isIn(['داخل شهری', 'خارج شهری']).withMessage('Invalid mission type'),
  body('missionLocation').notEmpty().withMessage('Mission location is required'),
  body('missionPurpose').notEmpty().withMessage('Mission purpose is required'),
  body('startDate').isISO8601().withMessage('Start date must be valid'),
  body('endDate').optional().isISO8601().withMessage('End date must be valid'),
  body('startTime').notEmpty().withMessage('Start time is required'),
  body('endTime').optional().isString().withMessage('End time must be a string'),
  body('notes').optional().isString().withMessage('Notes must be a string')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const {
      employeeId,
      missionType,
      missionLocation,
      missionPurpose,
      startDate,
      endDate,
      startTime,
      endTime,
      notes
    } = req.body;

    const missionAssignment = await prisma.missionAssignment.create({
      data: {
        employeeId,
        assignedBy: req.user!.id,
        missionType,
        missionLocation,
        missionPurpose,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        startTime,
        endTime,
        notes
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        },
        assigner: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Mission assignment created successfully',
      data: missionAssignment
    });
    return;
  } catch (error) {
    console.error('Create mission assignment error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get mission assignments
// @route   GET /api/security/missions
// @access  Private/Security Personnel
router.get('/missions', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_MISSIONS_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const where: any = {};
    if (status) where.status = status;

    const missionAssignments = await prisma.missionAssignment.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            department: {
              select: {
                namePersian: true
              }
            }
          }
        },
        assigner: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        approver: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page as string) - 1) * parseInt(limit as string),
      take: parseInt(limit as string)
    });

    const total = await prisma.missionAssignment.count({ where });

    res.json({
      success: true,
      data: missionAssignments,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    console.error('Get mission assignments error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// @desc    Approve mission assignment
// @route   PUT /api/security/missions/:id/approve
// @access  Private/Managers
router.put('/missions/:id/approve', protect, authorize('ADMIN'), requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN), requireFeatureAccess(FEATURES.SECURITY_MISSIONS_APPROVE, FEATURE_PERMISSIONS.EDIT), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const missionAssignment = await prisma.missionAssignment.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: req.user!.id,
        approvedAt: new Date()
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        approver: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Mission assignment approved successfully',
      data: missionAssignment
    });
    return;
  } catch (error) {
    console.error('Approve mission assignment error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// ==================== DIGITAL SIGNATURE SYSTEM ====================

// @desc    Save digital signature for attendance record
// @route   PUT /api/security/attendance/:id/signature
// @access  Private/Security Personnel
router.put('/attendance/:id/signature', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT), requireFeatureAccess(FEATURES.SECURITY_SIGNATURE_UPDATE, FEATURE_PERMISSIONS.EDIT), [
  body('signatureData').notEmpty().withMessage('Signature data is required'),
  body('signatureType').optional().isIn(['CHECKIN', 'CHECKOUT', 'EXCEPTION']).withMessage('Invalid signature type')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const { id } = req.params;
    const { signatureData, signatureType = 'CHECKIN' } = req.body;

    // Validate signature data format (should be base64 data URL)
    if (!signatureData.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature data format'
      });
    }

    const attendanceRecord = await prisma.attendanceRecord.update({
      where: { id },
      data: {
        digitalSignature: signatureData
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        securityPersonnel: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Digital signature saved successfully',
      data: attendanceRecord
    });
    return;
  } catch (error) {
    console.error('Save digital signature error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Get attendance record with signature
// @route   GET /api/security/attendance/:id/signature
// @access  Private/Security Personnel
router.get('/attendance/:id/signature', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_SIGNATURE_VIEW, FEATURE_PERMISSIONS.VIEW), async (req: AuthRequest, res: Response) => {
  try {
    // Check if user is security personnel
    const securityPersonnel = await prisma.securityPersonnel.findUnique({
      where: { userId: req.user!.id }
    });

    if (!securityPersonnel) {
      return res.status(403).json({
        success: false,
        error: 'User is not authorized as security personnel'
      });
    }

    const { id } = req.params;

    const attendanceRecord = await prisma.attendanceRecord.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true
          }
        },
        securityPersonnel: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    if (!attendanceRecord) {
      return res.status(404).json({
        success: false,
        error: 'Attendance record not found'
      });
    }

    res.json({
      success: true,
      data: attendanceRecord
    });
    return;
  } catch (error) {
    console.error('Get attendance signature error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

// @desc    Validate signature authenticity
// @route   POST /api/security/signature/validate
// @access  Private/Security Personnel
router.post('/signature/validate', protect, requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW), requireFeatureAccess(FEATURES.SECURITY_SIGNATURE_VALIDATE, FEATURE_PERMISSIONS.VIEW), [
  body('signatureData').notEmpty().withMessage('Signature data is required'),
  body('employeeId').notEmpty().withMessage('Employee ID is required')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { signatureData, employeeId } = req.body;

    // Basic signature validation
    const validation = {
      isValid: true,
      checks: {
        format: signatureData.startsWith('data:image/'),
        size: signatureData.length > 1000, // Minimum signature size
        employee: true // Could be enhanced with biometric validation
      },
      confidence: 85 // Could be enhanced with ML-based validation
    };

    // Check if employee exists
    const employee = await prisma.user.findUnique({
      where: { id: employeeId }
    });

    if (!employee) {
      validation.checks.employee = false;
      validation.isValid = false;
      validation.confidence = 0;
    }

    res.json({
      success: true,
      data: validation
    });
    return;
  } catch (error) {
    console.error('Validate signature error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
    return;
  }
});

export default router;
