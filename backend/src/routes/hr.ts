import express, { Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES, WorkspaceRequest } from '../middleware/workspace';
import { normalizeWorkSchedule } from '../utils/personnelWorkSchedule';
import { assertSubsequentEmploymentRelationship } from '../services/hrPersonnelBoundary';
import { assertWorkScheduleAction } from '../services/hrWorkScheduleGovernance';

const router = express.Router();
const prisma = new PrismaClient();

router.use(protect);

const viewAccess = requireWorkspaceAccess(WORKSPACES.HR, WORKSPACE_PERMISSIONS.VIEW);
const editAccess = requireWorkspaceAccess(WORKSPACES.HR, WORKSPACE_PERMISSIONS.EDIT);
const adminAccess = requireWorkspaceAccess(WORKSPACES.HR, WORKSPACE_PERMISSIONS.ADMIN);
const EXCEPTIONAL_PERSONNEL_SOURCES = new Set(['DATA_MIGRATION', 'HISTORICAL_CORRECTION', 'ORGANIZATIONAL_TRANSFER']);

const requireHrManagerAuthority = async (req: WorkspaceRequest, res: Response, next: express.NextFunction) => {
  try {
    const authority = await prisma.hrHiringAuthority.findFirst({
      where: { userId: req.user!.id, authority: 'HR_MANAGER', isActive: true }
    });
    if (!authority) {
      return res.status(403).json({ success: false, error: 'اختیار سازمانی HR_MANAGER برای ثبت استثنایی پرسنل الزامی است.' });
    }
    next();
  } catch (error) {
    next(error);
  }
};

const textValue = (value: unknown) => String(value ?? '').trim();
const nullableText = (value: unknown) => textValue(value) || null;
const parseDate = (value: unknown, label: string) => {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} معتبر نیست.`);
  return parsed;
};
const optionalDate = (value: unknown, label: string) => value ? parseDate(value, label) : null;
const isValidIranianNationalCode = (value: string) => {
  if (!/^\d{10}$/.test(value) || /^(\d)\1{9}$/.test(value)) return false;
  const check = Number(value[9]);
  const remainder = value.slice(0, 9).split('').reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0) % 11;
  return check === (remainder < 2 ? remainder : 11 - remainder);
};
const actorId = (req: WorkspaceRequest) => req.user!.id;
const hasHiringAuthority = async (userId: string, authority: 'HR_PROCESSOR' | 'HR_MANAGER') => Boolean(
  await prisma.hrHiringAuthority.findFirst({
    where: { userId, authority, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { id: true }
  })
);
const badRequest = (res: Response, error: unknown) => res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'اطلاعات واردشده معتبر نیست.' });
const handleError = (res: Response, error: unknown, context: string) => {
  console.error(context, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return res.status(409).json({ success: false, error: 'کد یا شناسه واردشده قبلاً ثبت شده است.' });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    return res.status(409).json({ success: false, error: 'داده هم‌زمان تغییر کرده است؛ اطلاعات را به‌روزرسانی و عملیات را دوباره انجام دهید.' });
  }
  return badRequest(res, error);
};

const overlaps = (from: Date, to: Date | null) => ({
  effectiveFrom: { lte: to || new Date('9999-12-31T23:59:59.999Z') },
  OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }]
});

const positionInclude = {
  job: true,
  organizationalUnit: true,
  workplace: true,
  costCenter: true,
  supervisorPosition: { select: { id: true, code: true, title: true } },
  _count: { select: { subordinatePositions: true } }
} as const;

const assignmentInclude = {
  position: { include: positionInclude },
  organizationalUnit: true,
  workplace: true,
  costCenter: true,
  responsibleSupervisorAssignment: {
    include: {
      position: { select: { id: true, code: true, title: true } },
      employmentRelationship: { include: { personnel: { select: { id: true, firstName: true, lastName: true, user: { select: { id: true } } } } } }
    }
  }
} as const;

const personnelInclude = {
  user: { select: { id: true, username: true, email: true, isActive: true } },
  workSchedules: {
    include: { days: { orderBy: { weekday: 'asc' as const } } },
    orderBy: { effectiveFrom: 'desc' as const },
    take: 1
  },
  workScheduleChanges: { orderBy: { createdAt: 'desc' as const }, take: 5 },
  hrEmploymentRelationships: {
    orderBy: { effectiveFrom: 'desc' as const },
    include: {
      assignments: { orderBy: { effectiveFrom: 'desc' as const }, include: assignmentInclude },
      hiringApplication: { select: { id: true, stage: true, outcome: true, convertedAt: true, activatedAt: true } }
    }
  },
  hrPersonnelAudits: { orderBy: { createdAt: 'desc' as const }, take: 10 }
} as const;

const assertActiveReference = async (client: any, model: 'hrOrganizationalUnit' | 'hrWorkplace' | 'hrCostCenter' | 'hrJob', id: string | null, label: string) => {
  if (!id) return;
  const record = await client[model].findUnique({ where: { id }, select: { isActive: true } });
  if (!record?.isActive) throw new Error(`${label} پیدا نشد یا غیرفعال است.`);
};

const assertNoUnitCycle = async (unitId: string, parentId: string | null) => {
  if (!parentId) return;
  if (unitId === parentId) throw new Error('واحد سازمانی نمی‌تواند والد خودش باشد.');
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === unitId) throw new Error('چرخه در سلسله‌مراتب سازمانی مجاز نیست.');
    const parent: { parentId: string | null } | null = await prisma.hrOrganizationalUnit.findUnique({ where: { id: cursor }, select: { parentId: true } });
    cursor = parent?.parentId || null;
  }
};

const assertNoPositionCycle = async (positionId: string, supervisorPositionId: string | null) => {
  if (!supervisorPositionId) return;
  if (positionId === supervisorPositionId) throw new Error('جایگاه نمی‌تواند سرپرست خودش باشد.');
  let cursor: string | null = supervisorPositionId;
  while (cursor) {
    if (cursor === positionId) throw new Error('چرخه در خط گزارش‌دهی جایگاه‌ها مجاز نیست.');
    const parent: { supervisorPositionId: string | null } | null = await prisma.hrPosition.findUnique({ where: { id: cursor }, select: { supervisorPositionId: true } });
    cursor = parent?.supervisorPositionId || null;
  }
};

const validateAssignment = async (client: any, input: {
  relationshipId: string;
  positionId: string;
  type: 'PRIMARY' | 'SECONDARY' | 'ACTING';
  effectiveFrom: Date;
  effectiveTo: Date | null;
  responsibleSupervisorAssignmentId?: string | null;
  excludeAssignmentId?: string;
}) => {
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new Error('پایان تخصیص نمی‌تواند پیش از شروع آن باشد.');
  const relationship = await client.hrEmploymentRelationship.findUnique({ where: { id: input.relationshipId } });
  if (!relationship) throw new Error('رابطه استخدامی پیدا نشد.');
  if (input.effectiveFrom < relationship.effectiveFrom || (relationship.effectiveTo && (!input.effectiveTo || input.effectiveTo > relationship.effectiveTo))) {
    throw new Error('بازه تخصیص باید کاملاً داخل بازه رابطه استخدامی باشد.');
  }
  const position = await client.hrPosition.findUnique({ where: { id: input.positionId }, include: positionInclude });
  if (!position?.isActive) throw new Error('جایگاه پیدا نشد یا غیرفعال است.');

  if (input.type === 'PRIMARY') {
    const primaryOverlap = await client.hrEmploymentAssignment.findFirst({
      where: {
        employmentRelationshipId: input.relationshipId,
        type: 'PRIMARY',
        ...(input.excludeAssignmentId ? { id: { not: input.excludeAssignmentId } } : {}),
        ...overlaps(input.effectiveFrom, input.effectiveTo)
      }
    });
    if (primaryOverlap) throw new Error('در هر لحظه فقط یک تخصیص اصلی برای فرد مجاز است.');
  }

  if (input.type !== 'ACTING') {
    const occupied = await client.hrEmploymentAssignment.count({
      where: {
        positionId: input.positionId,
        type: { in: ['PRIMARY', 'SECONDARY'] },
        ...(input.excludeAssignmentId ? { id: { not: input.excludeAssignmentId } } : {}),
        employmentRelationship: { status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } },
        ...overlaps(input.effectiveFrom, input.effectiveTo)
      }
    });
    if (occupied >= position.capacity) throw new Error('ظرفیت این جایگاه در بازه انتخاب‌شده تکمیل است.');
  }

  let supervisorAssignmentId = input.responsibleSupervisorAssignmentId || null;
  if (position.supervisorPositionId) {
    const candidates = await client.hrEmploymentAssignment.findMany({
      where: {
        positionId: position.supervisorPositionId,
        effectiveFrom: { lte: input.effectiveFrom },
        OR: input.effectiveTo
          ? [{ effectiveTo: null }, { effectiveTo: { gte: input.effectiveTo } }]
          : [{ effectiveTo: null }],
        employmentRelationship: { status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } }
      },
      select: { id: true }
    });
    if (candidates.length === 1 && !supervisorAssignmentId) supervisorAssignmentId = candidates[0].id;
    if (candidates.length > 1 && !supervisorAssignmentId) throw new Error('این جایگاه چند سرپرست فعال دارد؛ انتخاب فرد مسئول الزامی است.');
    if (supervisorAssignmentId && !candidates.some((candidate: { id: string }) => candidate.id === supervisorAssignmentId)) {
      throw new Error('سرپرست انتخاب‌شده در جایگاه سرپرستی و کل بازه مسئولیت فعال نیست.');
    }
  } else if (supervisorAssignmentId) {
    throw new Error('برای جایگاه بدون خط گزارش‌دهی نمی‌توان سرپرست مسئول انتخاب کرد.');
  }
  return { position, supervisorAssignmentId };
};

const foundationData = async () => {
  const now = new Date();
  const [organizationalUnits, workplaces, costCenters, jobs, positions, currentAssignments, availableUsers] = await Promise.all([
    prisma.hrOrganizationalUnit.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
    prisma.hrWorkplace.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
    prisma.hrCostCenter.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
    prisma.hrJob.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
    prisma.hrPosition.findMany({ include: positionInclude, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
    prisma.hrEmploymentAssignment.findMany({
      where: {
        type: { in: ['PRIMARY', 'SECONDARY'] },
        OR: [
          { employmentRelationship: { status: 'PLANNED' }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
          { employmentRelationship: { status: { in: ['ACTIVE', 'SUSPENDED'] } }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }
        ]
      },
      select: { positionId: true, employmentRelationship: { select: { status: true } } }
    }),
    prisma.user.findMany({ where: { personnelId: null, isActive: true }, select: { id: true, firstName: true, lastName: true, username: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] })
  ]);
  const occupancy = currentAssignments.reduce<Record<string, { active: number; committed: number }>>((result, assignment) => {
    const current = result[assignment.positionId] || { active: 0, committed: 0 };
    if (assignment.employmentRelationship.status === 'PLANNED') current.committed += 1;
    else current.active += 1;
    result[assignment.positionId] = current;
    return result;
  }, {});
  return {
    organizationalUnits, workplaces, costCenters, jobs, availableUsers,
    positions: positions.map((position) => ({
      ...position,
      occupancy: occupancy[position.id] || { active: 0, committed: 0 },
      vacancy: Math.max(0, position.capacity - (occupancy[position.id]?.active || 0) - (occupancy[position.id]?.committed || 0))
    }))
  };
};

router.get('/dashboard', viewAccess, async (_req, res) => {
  try {
    const foundation = await foundationData();
    const [personnel, activeRelationships, plannedRelationships, suspendedRelationships, unassigned] = await Promise.all([
      prisma.personnel.count(),
      prisma.hrEmploymentRelationship.count({ where: { status: 'ACTIVE', effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] } }),
      prisma.hrEmploymentRelationship.count({ where: { status: 'PLANNED' } }),
      prisma.hrEmploymentRelationship.count({ where: { status: 'SUSPENDED' } }),
      prisma.hrEmploymentRelationship.count({ where: { status: { in: ['ACTIVE', 'PLANNED', 'SUSPENDED'] }, assignments: { none: { type: 'PRIMARY', effectiveTo: null } } } })
    ]);
    const vacancies = foundation.positions.reduce((sum, position) => sum + position.vacancy, 0);
    const committedCapacity = foundation.positions.reduce((sum, position) => sum + position.occupancy.committed, 0);
    const vacantSupervisorPositions = foundation.positions.filter((position) => position._count.subordinatePositions > 0 && position.occupancy.active === 0);
    res.json({ success: true, data: { metrics: { personnel, activeHeadcount: activeRelationships, planned: plannedRelationships, suspended: suspendedRelationships, committedCapacity, vacancies }, verification: { relationshipsWithoutPrimaryAssignment: unassigned, inactiveFoundationRecords: [...foundation.organizationalUnits, ...foundation.workplaces, ...foundation.costCenters, ...foundation.jobs, ...foundation.positions].filter((item) => !item.isActive).length, vacantSupervisorPositions: vacantSupervisorPositions.length }, positions: foundation.positions.slice(0, 8) } });
  } catch (error) { handleError(res, error, 'HR dashboard'); }
});

router.get('/foundation', viewAccess, async (_req, res) => {
  try { res.json({ success: true, data: await foundationData() }); }
  catch (error) { handleError(res, error, 'HR foundation'); }
});

router.post('/organizational-units', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const code = textValue(req.body.code).toUpperCase(); const name = textValue(req.body.name); const parentId = nullableText(req.body.parentId);
    if (!code || !name) throw new Error('کد و نام واحد سازمانی الزامی است.');
    if (!['COMPANY', 'DIVISION', 'DEPARTMENT', 'SECTION', 'TEAM'].includes(req.body.type)) throw new Error('نوع واحد سازمانی معتبر نیست.');
    if (parentId) await assertActiveReference(prisma, 'hrOrganizationalUnit', parentId, 'واحد والد');
    const record = await prisma.hrOrganizationalUnit.create({ data: { code, name, type: req.body.type, parentId, createdBy: actorId(req) } });
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Create HR unit'); }
});

router.put('/organizational-units/:id', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const parentId = nullableText(req.body.parentId); await assertNoUnitCycle(req.params.id, parentId);
    if (parentId) await assertActiveReference(prisma, 'hrOrganizationalUnit', parentId, 'واحد والد');
    const record = await prisma.hrOrganizationalUnit.update({ where: { id: req.params.id }, data: { name: textValue(req.body.name), type: req.body.type, parentId, isActive: Boolean(req.body.isActive) } });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Update HR unit'); }
});

const simpleCatalogCreate = (model: 'hrWorkplace' | 'hrCostCenter') => async (req: WorkspaceRequest, res: Response) => {
  try {
    const code = textValue(req.body.code).toUpperCase(); const name = textValue(req.body.name);
    if (!code || !name) throw new Error('کد و نام الزامی است.');
    const record = await (prisma[model] as any).create({ data: { code, name, description: nullableText(req.body.description), createdBy: actorId(req) } });
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, `Create ${model}`); }
};
const simpleCatalogUpdate = (model: 'hrWorkplace' | 'hrCostCenter') => async (req: WorkspaceRequest, res: Response) => {
  try {
    const record = await (prisma[model] as any).update({ where: { id: req.params.id }, data: { name: textValue(req.body.name), description: nullableText(req.body.description), isActive: Boolean(req.body.isActive) } });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, `Update ${model}`); }
};
router.post('/workplaces', editAccess, simpleCatalogCreate('hrWorkplace'));
router.put('/workplaces/:id', editAccess, simpleCatalogUpdate('hrWorkplace'));
router.post('/cost-centers', editAccess, simpleCatalogCreate('hrCostCenter'));
router.put('/cost-centers/:id', editAccess, simpleCatalogUpdate('hrCostCenter'));

router.post('/jobs', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const code = textValue(req.body.code).toUpperCase(); const title = textValue(req.body.title);
    if (!code || !title) throw new Error('کد و عنوان شغل الزامی است.');
    const record = await prisma.hrJob.create({ data: { code, title, description: nullableText(req.body.description), responsibilities: nullableText(req.body.responsibilities), createdBy: actorId(req) } });
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Create HR job'); }
});
router.put('/jobs/:id', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const record = await prisma.hrJob.update({ where: { id: req.params.id }, data: { title: textValue(req.body.title), description: nullableText(req.body.description), responsibilities: nullableText(req.body.responsibilities), isActive: Boolean(req.body.isActive) } });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Update HR job'); }
});

router.post('/positions', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const code = textValue(req.body.code).toUpperCase(); const title = textValue(req.body.title); const capacity = Number(req.body.capacity);
    if (!code || !title || !Number.isInteger(capacity) || capacity < 1) throw new Error('کد، عنوان و ظرفیت مثبت جایگاه الزامی است.');
    const jobId = textValue(req.body.jobId); const organizationalUnitId = textValue(req.body.organizationalUnitId);
    await Promise.all([assertActiveReference(prisma, 'hrJob', jobId, 'شغل'), assertActiveReference(prisma, 'hrOrganizationalUnit', organizationalUnitId, 'واحد سازمانی'), assertActiveReference(prisma, 'hrWorkplace', nullableText(req.body.workplaceId), 'محل کار'), assertActiveReference(prisma, 'hrCostCenter', nullableText(req.body.costCenterId), 'مرکز هزینه')]);
    const supervisorPositionId = nullableText(req.body.supervisorPositionId);
    if (supervisorPositionId && !(await prisma.hrPosition.findUnique({ where: { id: supervisorPositionId, isActive: true } }))) throw new Error('جایگاه سرپرست معتبر نیست.');
    const record = await prisma.hrPosition.create({ data: { code, title, capacity, jobId, organizationalUnitId, workplaceId: nullableText(req.body.workplaceId), costCenterId: nullableText(req.body.costCenterId), supervisorPositionId, createdBy: actorId(req) }, include: positionInclude });
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Create HR position'); }
});
router.put('/positions/:id', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const capacity = Number(req.body.capacity); if (!Number.isInteger(capacity) || capacity < 1) throw new Error('ظرفیت باید حداقل یک باشد.');
    const occupied = await prisma.hrEmploymentAssignment.count({ where: { positionId: req.params.id, type: { in: ['PRIMARY', 'SECONDARY'] }, effectiveTo: null, employmentRelationship: { status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } } } });
    if (capacity < occupied) throw new Error('ظرفیت نمی‌تواند از تعداد تخصیص‌های متعهد کمتر شود.');
    const supervisorPositionId = nullableText(req.body.supervisorPositionId); await assertNoPositionCycle(req.params.id, supervisorPositionId);
    const record = await prisma.hrPosition.update({ where: { id: req.params.id }, data: { title: textValue(req.body.title), capacity, workplaceId: nullableText(req.body.workplaceId), costCenterId: nullableText(req.body.costCenterId), supervisorPositionId, isActive: Boolean(req.body.isActive) }, include: positionInclude });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Update HR position'); }
});

router.get('/personnel', viewAccess, async (req, res) => {
  try {
    const search = textValue(req.query.search);
    const [rows, authorityRows] = await Promise.all([
      prisma.personnel.findMany({ where: search ? { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { employeeNumber: { contains: search, mode: 'insensitive' } }, { nationalCode: { contains: search } }] } : {}, include: personnelInclude, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
      prisma.hrHiringAuthority.findMany({ where: { userId: actorId(req), isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { authority: true } })
    ]);
    const authorities = new Set(authorityRows.map((row) => row.authority));
    const data = rows.map((person) => {
      const relationship = person.hrEmploymentRelationships[0];
      const primary = relationship?.assignments.find((assignment) => assignment.type === 'PRIMARY' && !assignment.effectiveTo);
      const change = person.workScheduleChanges[0];
      const isResponsibleSupervisor = primary?.responsibleSupervisorAssignment?.employmentRelationship.personnel.user?.id === actorId(req);
      const separateReviewer = change?.preparedBy !== actorId(req);
      const canSeeChangeDetails = Boolean(isResponsibleSupervisor) || authorities.has('HR_PROCESSOR') || authorities.has('HR_MANAGER');
      return {
        ...person,
        workScheduleChanges: canSeeChangeDetails ? person.workScheduleChanges : [],
        workScheduleCapabilities: {
          canPropose: Boolean(isResponsibleSupervisor) && (!change || change.status === 'APPROVED'),
          canPrepare: authorities.has('HR_PROCESSOR') && Boolean(change && ['PROPOSED', 'RETURNED', 'DRAFT'].includes(change.status)),
          canSubmit: authorities.has('HR_PROCESSOR') && change?.status === 'DRAFT',
          canApprove: authorities.has('HR_MANAGER') && change?.status === 'SUBMITTED' && separateReviewer,
          canReturn: authorities.has('HR_MANAGER') && change?.status === 'SUBMITTED' && separateReviewer
        }
      };
    });
    res.json({ success: true, data });
  } catch (error) { handleError(res, error, 'List HR personnel'); }
});

router.post('/personnel/exceptional', editAccess, requireHrManagerAuthority, async (req: WorkspaceRequest, res) => {
  try {
    const firstName = textValue(req.body.firstName); const lastName = textValue(req.body.lastName);
    if (!firstName || !lastName) throw new Error('نام و نام خانوادگی الزامی است.');
    const sourceCategory = textValue(req.body.sourceCategory);
    const reason = textValue(req.body.reason);
    if (!EXCEPTIONAL_PERSONNEL_SOURCES.has(sourceCategory)) throw new Error('دسته منبع ثبت استثنایی معتبر نیست.');
    if (reason.length < 10) throw new Error('دلیل ثبت استثنایی باید روشن و حداقل ۱۰ نویسه باشد.');
    const nationalCode = nullableText(req.body.nationalCode);
    if (nationalCode && !isValidIranianNationalCode(nationalCode)) throw new Error('کد ملی معتبر نیست.');
    const duplicate = await prisma.personnel.findFirst({ where: { firstName: { equals: firstName, mode: 'insensitive' }, lastName: { equals: lastName, mode: 'insensitive' } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true } });
    if (duplicate && !req.body.confirmDuplicate) return res.status(409).json({ success: false, code: 'DUPLICATE_PERSONNEL_CONFIRMATION_REQUIRED', error: 'فردی با نام مشابه وجود دارد؛ پرونده موجود را بررسی کنید و فقط در صورت تفاوت واقعی ثبت را تأیید کنید.', duplicate });
    const effectiveFrom = parseDate(req.body.effectiveFrom, 'تاریخ شروع');
    const status = req.body.status === 'PLANNED' ? 'PLANNED' : 'ACTIVE';
    if (status === 'ACTIVE' && effectiveFrom > new Date()) throw new Error('استخدام با تاریخ شروع آینده باید برنامه‌ریزی‌شده باشد.');
    const positionId = textValue(req.body.positionId); if (!positionId) throw new Error('تخصیص اصلی اولیه الزامی است.');
    const result = await prisma.$transaction(async (tx) => {
      const personnel = await tx.personnel.create({ data: { firstName, lastName, nationalCode, employeeNumber: nullableText(req.body.employeeNumber), isActive: status === 'ACTIVE' } });
      if (req.body.userId) {
        const user = await tx.user.findUnique({ where: { id: textValue(req.body.userId) }, select: { personnelId: true } });
        if (!user || user.personnelId) throw new Error('کاربر انتخاب‌شده پیدا نشد یا قبلاً به پرسنل متصل است.');
        await tx.user.update({ where: { id: textValue(req.body.userId) }, data: { personnelId: personnel.id } });
      }
      const relationship = await tx.hrEmploymentRelationship.create({ data: { personnelId: personnel.id, status, effectiveFrom, originalStartDate: effectiveFrom, startDateVerified: true, createdBy: actorId(req) } });
      const validated = await validateAssignment(tx, { relationshipId: relationship.id, positionId, type: 'PRIMARY', effectiveFrom, effectiveTo: null, responsibleSupervisorAssignmentId: nullableText(req.body.responsibleSupervisorAssignmentId) });
      await tx.hrEmploymentAssignment.create({ data: { employmentRelationshipId: relationship.id, positionId, type: 'PRIMARY', effectiveFrom, organizationalUnitId: validated.position.organizationalUnitId, workplaceId: validated.position.workplaceId, costCenterId: validated.position.costCenterId, responsibleSupervisorAssignmentId: validated.supervisorAssignmentId, createdBy: actorId(req) } });
      await tx.hrPersonnelAudit.create({ data: {
        personnelId: personnel.id,
        actorUserId: actorId(req),
        eventType: 'EXCEPTIONAL_PERSONNEL_REGISTERED',
        sourceCategory,
        reason,
        payloadJson: {
          relationshipId: relationship.id,
          positionId,
          status,
          effectiveFrom: effectiveFrom.toISOString(),
          linkedUser: Boolean(req.body.userId)
        }
      } });
      return tx.personnel.findUniqueOrThrow({ where: { id: personnel.id }, include: personnelInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ success: true, data: result });
  } catch (error) { handleError(res, error, 'Create exceptional HR personnel'); }
});

router.put('/personnel/:id', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const nationalCode = nullableText(req.body.nationalCode); if (nationalCode && !isValidIranianNationalCode(nationalCode)) throw new Error('کد ملی معتبر نیست.');
    const record = await prisma.personnel.update({ where: { id: req.params.id }, data: { firstName: textValue(req.body.firstName), lastName: textValue(req.body.lastName), nationalCode, employeeNumber: nullableText(req.body.employeeNumber) }, include: personnelInclude });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Update HR personnel'); }
});

router.put('/personnel/:id/work-schedule', editAccess, async (req: WorkspaceRequest, res) => {
  res.status(403).json({ success: false, error: 'تغییر مستقیم ساعت کاری مجاز نیست؛ از گردش پیشنهاد، آماده‌سازی و تأیید استفاده کنید.' });
});

router.post('/personnel/:id/work-schedule/proposals', viewAccess, async (req: WorkspaceRequest, res) => {
  try {
    const now = new Date();
    const supervisorLink = await prisma.hrEmploymentAssignment.findFirst({
      where: {
        employmentRelationship: {
          personnelId: req.params.id, status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] },
          effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
        },
        effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        responsibleSupervisorAssignment: {
          effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          employmentRelationship: {
            status: { in: ['ACTIVE', 'SUSPENDED'] }, effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
            personnel: { user: { id: actorId(req) } }
          }
        }
      },
      select: { id: true }
    });
    assertWorkScheduleAction('PROPOSE', { isResponsibleSupervisor: Boolean(supervisorLink) });
    const schedule = normalizeWorkSchedule(req.body);
    const proposalNote = textValue(req.body.proposalNote);
    if (!schedule || !proposalNote) throw new Error('تاریخ اجرا، روزهای برنامه کاری و دلیل پیشنهاد الزامی است.');
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.hrWorkScheduleChange.create({ data: {
        personnelId: req.params.id,
        effectiveFrom: parseDate(schedule.effectiveDate, 'تاریخ اجرا'),
        daysJson: schedule.days as any,
        proposalNote,
        proposedBy: actorId(req)
      } });
      await tx.hrPersonnelAudit.create({ data: { personnelId: req.params.id, actorUserId: actorId(req), eventType: 'WORK_SCHEDULE_PROPOSED', sourceCategory: 'WORK_SCHEDULE', reason: proposalNote, payloadJson: { changeId: created.id, effectiveDate: schedule.effectiveDate, days: schedule.days } as any } });
      return created;
    });
    res.status(201).json({ success: true, data: row });
  } catch (error) { handleError(res, error, 'Propose personnel work schedule'); }
});

router.put('/personnel/:id/work-schedule/changes/:changeId/prepare', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const [change, hasHrProcessor] = await Promise.all([
      prisma.hrWorkScheduleChange.findFirstOrThrow({ where: { id: req.params.changeId, personnelId: req.params.id } }),
      hasHiringAuthority(actorId(req), 'HR_PROCESSOR')
    ]);
    assertWorkScheduleAction('PREPARE', { hasHrProcessor, status: change.status });
    const schedule = normalizeWorkSchedule(req.body);
    if (!schedule) throw new Error('برنامه کاری کامل الزامی است.');
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.hrWorkScheduleChange.update({ where: { id: change.id }, data: {
        status: 'DRAFT', effectiveFrom: parseDate(schedule.effectiveDate, 'تاریخ اجرا'), daysJson: schedule.days as any,
        preparedBy: actorId(req), preparedAt: new Date(), returnedBy: null, returnedAt: null, returnReason: null
      } });
      await tx.hrPersonnelAudit.create({ data: { personnelId: req.params.id, actorUserId: actorId(req), eventType: 'WORK_SCHEDULE_PREPARED', sourceCategory: 'WORK_SCHEDULE', reason: 'آماده‌سازی پیش‌نویس برنامه کاری', payloadJson: { changeId: change.id, effectiveDate: schedule.effectiveDate, days: schedule.days } as any } });
      return updated;
    });
    res.json({ success: true, data: row });
  } catch (error) { handleError(res, error, 'Prepare personnel work schedule'); }
});

router.post('/personnel/:id/work-schedule/changes/:changeId/submit', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const [change, hasHrProcessor] = await Promise.all([
      prisma.hrWorkScheduleChange.findFirstOrThrow({ where: { id: req.params.changeId, personnelId: req.params.id } }),
      hasHiringAuthority(actorId(req), 'HR_PROCESSOR')
    ]);
    assertWorkScheduleAction('SUBMIT', { hasHrProcessor, status: change.status, actorId: actorId(req) });
    const row = await prisma.hrWorkScheduleChange.update({ where: { id: change.id }, data: { status: 'SUBMITTED', submittedBy: actorId(req), submittedAt: new Date() } });
    await prisma.hrPersonnelAudit.create({ data: { personnelId: req.params.id, actorUserId: actorId(req), eventType: 'WORK_SCHEDULE_SUBMITTED', sourceCategory: 'WORK_SCHEDULE', reason: 'ارسال برنامه کاری برای تأیید', payloadJson: { changeId: change.id } } });
    res.json({ success: true, data: row });
  } catch (error) { handleError(res, error, 'Submit personnel work schedule'); }
});

router.post('/personnel/:id/work-schedule/changes/:changeId/return', adminAccess, async (req: WorkspaceRequest, res) => {
  try {
    const [change, hasHrManager] = await Promise.all([
      prisma.hrWorkScheduleChange.findFirstOrThrow({ where: { id: req.params.changeId, personnelId: req.params.id } }),
      hasHiringAuthority(actorId(req), 'HR_MANAGER')
    ]);
    const reason = textValue(req.body.reason);
    assertWorkScheduleAction('RETURN', { hasHrManager, status: change.status, returnReason: reason });
    const row = await prisma.hrWorkScheduleChange.update({ where: { id: change.id }, data: { status: 'RETURNED', returnedBy: actorId(req), returnedAt: new Date(), returnReason: reason } });
    await prisma.hrPersonnelAudit.create({ data: { personnelId: req.params.id, actorUserId: actorId(req), eventType: 'WORK_SCHEDULE_RETURNED', sourceCategory: 'WORK_SCHEDULE', reason, payloadJson: { changeId: change.id } } });
    res.json({ success: true, data: row });
  } catch (error) { handleError(res, error, 'Return personnel work schedule'); }
});

router.post('/personnel/:id/work-schedule/changes/:changeId/approve', adminAccess, async (req: WorkspaceRequest, res) => {
  try {
    const [change, hasHrManager] = await Promise.all([
      prisma.hrWorkScheduleChange.findFirstOrThrow({ where: { id: req.params.changeId, personnelId: req.params.id } }),
      hasHiringAuthority(actorId(req), 'HR_MANAGER')
    ]);
    assertWorkScheduleAction('APPROVE', { hasHrManager, status: change.status, actorId: actorId(req), preparedBy: change.preparedBy });
    if (!change.effectiveFrom || !Array.isArray(change.daysJson)) throw new Error('پیش‌نویس کامل برنامه کاری پیدا نشد.');
    const row = await prisma.$transaction(async (tx) => {
      const existing = await tx.personnelWorkSchedule.findUnique({ where: { personnelId_effectiveFrom: { personnelId: req.params.id, effectiveFrom: change.effectiveFrom! } }, select: { id: true } });
      if (existing) throw new Error('برای این تاریخ اجرا قبلاً یک نسخه تأییدشده وجود دارد.');
      const schedule = await tx.personnelWorkSchedule.create({ data: {
        personnelId: req.params.id, effectiveFrom: change.effectiveFrom!,
        days: { create: (change.daysJson as any[]).map((day) => ({ weekday: day.weekday, startTime: day.startTime, endTime: day.endTime })) }
      } });
      const updated = await tx.hrWorkScheduleChange.update({ where: { id: change.id }, data: { status: 'APPROVED', approvedBy: actorId(req), approvedAt: new Date(), canonicalScheduleId: schedule.id } });
      await tx.hrPersonnelAudit.create({ data: { personnelId: req.params.id, actorUserId: actorId(req), eventType: 'WORK_SCHEDULE_APPROVED', sourceCategory: 'WORK_SCHEDULE', reason: 'تأیید نسخه برنامه کاری', payloadJson: { changeId: change.id, canonicalScheduleId: schedule.id, effectiveFrom: change.effectiveFrom!.toISOString() } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ success: true, data: row });
  } catch (error) { handleError(res, error, 'Approve personnel work schedule'); }
});

router.post('/personnel/:id/relationships', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const effectiveFrom = parseDate(req.body.effectiveFrom, 'تاریخ شروع');
    if (req.body.status !== 'PLANNED' && effectiveFrom > new Date()) throw new Error('رابطه با تاریخ شروع آینده باید برنامه‌ریزی‌شده باشد.');
    const effectiveTo = optionalDate(req.body.effectiveTo, 'تاریخ پایان');
    const record = await prisma.$transaction(async (tx) => {
      const existingRelationshipCount = await tx.hrEmploymentRelationship.count({ where: { personnelId: req.params.id } });
      assertSubsequentEmploymentRelationship(existingRelationshipCount);
      const overlap = await tx.hrEmploymentRelationship.findFirst({ where: { personnelId: req.params.id, ...overlaps(effectiveFrom, effectiveTo) } });
      if (overlap) throw new Error('رابطه استخدامی هم‌پوشان برای این فرد مجاز نیست.');
      return tx.hrEmploymentRelationship.create({ data: { personnelId: req.params.id, status: req.body.status === 'PLANNED' ? 'PLANNED' : 'ACTIVE', effectiveFrom, effectiveTo, originalStartDate: optionalDate(req.body.originalStartDate, 'تاریخ استخدام'), startDateVerified: Boolean(req.body.startDateVerified), createdBy: actorId(req) } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Create employment relationship'); }
});

router.post('/relationships/:id/assignments', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const type = req.body.type as 'PRIMARY' | 'SECONDARY' | 'ACTING'; if (!['PRIMARY', 'SECONDARY', 'ACTING'].includes(type)) throw new Error('نوع تخصیص معتبر نیست.');
    const effectiveFrom = parseDate(req.body.effectiveFrom, 'تاریخ شروع'); const effectiveTo = optionalDate(req.body.effectiveTo, 'تاریخ پایان');
    const positionId = textValue(req.body.positionId);
    const record = await prisma.$transaction(async (tx) => {
      const validated = await validateAssignment(tx, { relationshipId: req.params.id, positionId, type, effectiveFrom, effectiveTo, responsibleSupervisorAssignmentId: nullableText(req.body.responsibleSupervisorAssignmentId) });
      return tx.hrEmploymentAssignment.create({ data: { employmentRelationshipId: req.params.id, positionId, type, effectiveFrom, effectiveTo, organizationalUnitId: validated.position.organizationalUnitId, workplaceId: validated.position.workplaceId, costCenterId: validated.position.costCenterId, responsibleSupervisorAssignmentId: validated.supervisorAssignmentId, scheduleContributing: type !== 'PRIMARY' && Boolean(req.body.scheduleContributing), createdBy: actorId(req) }, include: assignmentInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Create employment assignment'); }
});

router.post('/relationships/:id/transfer-primary', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const effectiveFrom = parseDate(req.body.effectiveFrom, 'تاریخ اجرای انتقال');
    const positionId = textValue(req.body.positionId); if (!positionId) throw new Error('جایگاه جدید الزامی است.');
    const record = await prisma.$transaction(async (tx) => {
      const current = await tx.hrEmploymentAssignment.findFirst({
        where: { employmentRelationshipId: req.params.id, type: 'PRIMARY', effectiveFrom: { lte: effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] },
        orderBy: { effectiveFrom: 'desc' }
      });
      if (!current) throw new Error('تخصیص اصلی جاری برای انتقال پیدا نشد؛ ابتدا یک تخصیص اصلی ثبت کنید.');
      if (effectiveFrom <= current.effectiveFrom) throw new Error('تاریخ انتقال باید پس از شروع تخصیص اصلی جاری باشد.');
      await tx.hrEmploymentAssignment.update({ where: { id: current.id }, data: { effectiveTo: new Date(effectiveFrom.getTime() - 1) } });
      const validated = await validateAssignment(tx, { relationshipId: req.params.id, positionId, type: 'PRIMARY', effectiveFrom, effectiveTo: null, responsibleSupervisorAssignmentId: nullableText(req.body.responsibleSupervisorAssignmentId) });
      return tx.hrEmploymentAssignment.create({ data: { employmentRelationshipId: req.params.id, positionId, type: 'PRIMARY', effectiveFrom, organizationalUnitId: validated.position.organizationalUnitId, workplaceId: validated.position.workplaceId, costCenterId: validated.position.costCenterId, responsibleSupervisorAssignmentId: validated.supervisorAssignmentId, createdBy: actorId(req) }, include: assignmentInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Transfer primary assignment'); }
});

router.put('/assignments/:id/end', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const assignment = await prisma.hrEmploymentAssignment.findUnique({ where: { id: req.params.id } }); if (!assignment) throw new Error('تخصیص پیدا نشد.');
    if (assignment.type === 'PRIMARY') throw new Error('تخصیص اصلی باید با عملیات انتقال/ارتقا جایگزین شود و نمی‌تواند به‌تنهایی پایان یابد.');
    const effectiveTo = parseDate(req.body.effectiveTo, 'تاریخ پایان'); if (effectiveTo < assignment.effectiveFrom) throw new Error('تاریخ پایان پیش از شروع تخصیص است.');
    const record = await prisma.hrEmploymentAssignment.update({ where: { id: assignment.id }, data: { effectiveTo }, include: assignmentInclude });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'End assignment'); }
});

router.put('/relationships/:id/status', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    if (!['PLANNED', 'ACTIVE', 'SUSPENDED'].includes(req.body.status)) throw new Error('پایان استخدام فقط از جریان مستقل Offboarding انجام می‌شود.');
    const existing = await prisma.hrEmploymentRelationship.findUnique({ where: { id: req.params.id } }); if (!existing) throw new Error('رابطه استخدامی پیدا نشد.');
    if (req.body.status === 'ACTIVE' && existing.status === 'PLANNED' && existing.hiringApplicationId) throw new Error('فعال‌سازی نیروی جذب‌شده فقط از پرونده جذب و پس از تکمیل همه پیش‌نیازها انجام می‌شود.');
    if (req.body.status === 'ACTIVE' && existing.effectiveFrom > new Date()) throw new Error('رابطه برنامه‌ریزی‌شده پیش از تاریخ شروع قابل فعال‌سازی نیست.');
    const effectiveTo = existing.effectiveTo;
    if (effectiveTo && effectiveTo < existing.effectiveFrom) throw new Error('تاریخ پایان استخدام معتبر نیست.');
    const record = await prisma.$transaction(async (tx) => {
      return tx.hrEmploymentRelationship.update({ where: { id: existing.id }, data: { status: req.body.status, effectiveTo } });
    });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Update employment status'); }
});

router.get('/supervisor-candidates', viewAccess, async (req, res) => {
  try {
    const position = await prisma.hrPosition.findUnique({ where: { id: textValue(req.query.positionId) } });
    if (!position?.supervisorPositionId) return res.json({ success: true, data: [] });
    const effectiveFrom = parseDate(req.query.effectiveFrom || new Date().toISOString(), 'تاریخ شروع'); const effectiveTo = optionalDate(req.query.effectiveTo, 'تاریخ پایان');
    const rows = await prisma.hrEmploymentAssignment.findMany({ where: { positionId: position.supervisorPositionId, effectiveFrom: { lte: effectiveFrom }, OR: effectiveTo ? [{ effectiveTo: null }, { effectiveTo: { gte: effectiveTo } }] : [{ effectiveTo: null }], employmentRelationship: { status: { in: ['ACTIVE', 'PLANNED', 'SUSPENDED'] } } }, include: { employmentRelationship: { include: { personnel: true } }, position: true } });
    res.json({ success: true, data: rows.map((row) => ({ id: row.id, positionTitle: row.position.title, personnelId: row.employmentRelationship.personnelId, name: `${row.employmentRelationship.personnel.firstName} ${row.employmentRelationship.personnel.lastName}` })) });
  } catch (error) { handleError(res, error, 'Supervisor candidates'); }
});

router.get('/migration/preview', adminAccess, async (_req, res) => {
  try {
    const [activePersonnel, inactivePersonnel, linkedUsers, unlinkedUsers, departments, schedules, exceptions, migrated] = await Promise.all([
      prisma.personnel.count({ where: { isActive: true } }), prisma.personnel.count({ where: { isActive: false } }), prisma.user.count({ where: { personnelId: { not: null } } }), prisma.user.count({ where: { personnelId: null } }), prisma.department.findMany({ orderBy: { name: 'asc' } }), prisma.personnelWorkSchedule.count(), prisma.exceptionRequest.groupBy({ by: ['exceptionType'], _count: true }), prisma.hrEmploymentRelationship.count({ where: { sourceSystem: 'LEGACY_PERSONNEL' } })
    ]);
    const duplicates = await prisma.$queryRaw<Array<{ firstName: string; lastName: string; count: bigint }>>`SELECT lower(trim("firstName")) AS "firstName", lower(trim("lastName")) AS "lastName", count(*) AS count FROM "personnel" GROUP BY 1, 2 HAVING count(*) > 1`;
    res.json({ success: true, data: { counts: { activePersonnel, inactivePersonnel, linkedUsers, unlinkedUsers, departments: departments.length, schedules, migrated }, departments, exceptions: exceptions.map((row) => ({ type: row.exceptionType, count: row._count })), conflicts: { duplicateNames: duplicates.map((row) => ({ ...row, count: Number(row.count) })), inactivePersonnelNeedReview: inactivePersonnel } } });
  } catch (error) { handleError(res, error, 'HR migration preview'); }
});

router.post('/migration/apply', adminAccess, async (req: WorkspaceRequest, res) => {
  try {
    const baseline = parseDate(req.body.baselineDate, 'تاریخ مبنای مهاجرت');
    if (baseline > new Date()) throw new Error('تاریخ مبنای مهاجرت نمی‌تواند در آینده باشد.');
    const departmentIds = Array.isArray(req.body.confirmedDepartmentIds) ? req.body.confirmedDepartmentIds.map(textValue) : [];
    const result = await prisma.$transaction(async (tx) => {
      let unitsCreated = 0;
      for (const departmentId of departmentIds) {
        const department = await tx.department.findUnique({ where: { id: departmentId } }); if (!department) continue;
        const existing = await tx.hrOrganizationalUnit.findUnique({ where: { legacyDepartmentId: department.id } });
        if (!existing) {
          await tx.hrOrganizationalUnit.create({ data: { code: `LEGACY-${department.id.slice(-8).toUpperCase()}`, name: department.namePersian || department.name, type: 'DEPARTMENT', legacyDepartmentId: department.id, isActive: department.isActive, createdBy: actorId(req) } });
          unitsCreated += 1;
        }
      }
      const personnel = await tx.personnel.findMany({ where: { isActive: true }, select: { id: true } });
      let relationshipsCreated = 0;
      let relationshipsSkipped = 0;
      for (const person of personnel) {
        const existing = await tx.hrEmploymentRelationship.findUnique({ where: { sourceSystem_sourceId: { sourceSystem: 'LEGACY_PERSONNEL', sourceId: person.id } } });
        const currentRelationship = await tx.hrEmploymentRelationship.findFirst({ where: { personnelId: person.id, ...overlaps(baseline, null) } });
        if (!existing && !currentRelationship) {
          await tx.hrEmploymentRelationship.create({ data: { personnelId: person.id, status: 'ACTIVE', effectiveFrom: baseline, startDateVerified: false, sourceSystem: 'LEGACY_PERSONNEL', sourceId: person.id, migratedAt: new Date(), createdBy: actorId(req) } });
          relationshipsCreated += 1;
        } else {
          relationshipsSkipped += 1;
        }
      }
      return { unitsCreated, relationshipsCreated, relationshipsSkipped };
    });
    res.json({ success: true, data: result, message: 'مهاجرت کنترل‌شده انجام شد؛ موارد فاقد تخصیص اصلی همچنان برای تکمیل HR علامت‌گذاری می‌شوند.' });
  } catch (error) { handleError(res, error, 'Apply HR migration'); }
});

export default router;
