import { prisma } from '../lib/prisma';
import express, { Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { protect } from '../middleware/auth';
import type { WorkspaceRequest } from '../middleware/workspace';
import { requireHrFeature } from '../middleware/hrAuthorization';
import { normalizeWorkSchedule, savePersonnelWorkSchedule } from '../utils/personnelWorkSchedule';
import { archiveRosterMembershipEnd, assertSubsequentEmploymentRelationship } from '../services/hrPersonnelBoundary';
import { dateOnlyRangeIncludes, plannedStartHasArrived } from '../services/hrEmploymentActivation';
import { assertArchiveReason, assertArchivedRecordMutable, assertPermanentDeletionConfirmation, assertPersonnelErasureTarget, projectRecordRetentionCapabilities } from '../services/hrRecordRetentionPolicy';
import { buildPersonnelErasurePlan, executePersonnelErasureGraph } from '../services/hrPersonnelErasureGraph';
import { commitStagedHiringFiles, planHiringFilesForDeletion, restoreStagedHiringFiles, stagePlannedHiringFiles, type StagedHiringFile } from '../services/hrDeletionFileTransaction';
import { PERSONNEL_ERASURE_LEASE_MS } from '../services/hrPersonnelErasureRecovery';
import {
  HR_REDESIGN_CATALOG,
  canReadLegacyAssessmentCompatibility,
  projectLegacyAssessmentCompatibility,
  projectLegacyHrAccess,
  projectLegacyHrWorkItem,
  projectLegacyPosition,
  runHrRedesignBackfill,
} from '../services/hrRedesignDataContracts';
import hrAuthorizationRoutes from './hr-authorization';
import personnelPerformanceRoutes from './personnel-performance';
import { activeHrActionPermissionsForUser, authorizeHrUser } from '../services/hrAuthorizationService';
import {
  assertCapacityChangeAllowed,
  assertFreshVersion,
  capacityAt,
  FoundationVersionConflictError,
  maximumCapacityCommitmentFrom,
  projectEffectiveFoundation,
  reconcilePositionCapacity,
  resolveFoundationStatus,
  summarizePositionCoverage,
  type CapacityAssignment,
} from '../services/hrOrganizationCapacity';
import { assertAutomatedHrMigrationOperationAllowed } from '../services/hrMigrationReconciliation';
import { getHrReconciliationWorkspace, recordHrReconciliationReview } from '../services/hrMigrationReconciliationStore';
import { buildPersonnelCollection, personnelOriginFeature } from '../services/hrPersonnelCollection';
import { publishRealtime } from '../services/realtimePublisher';
import { loadHrOperationalReference } from '../services/hrOperationalReferenceProjection';
import { normalizeApplicantDigits } from '../services/hrCandidateAccess';
import {
  allocateFoundationCodeOccurrence,
  foundationReferenceSnapshot,
  projectFoundationAtEvent,
  releaseFoundationCodeOccurrence,
} from '../services/hrFoundationGovernance';

const router = express.Router();

router.use(protect);
router.use('/authorization', hrAuthorizationRoutes);
router.use('/performance', personnelPerformanceRoutes);

export const featureForPath = (path: string) => {
  if (path === '/dashboard') return 'DASHBOARD';
  if (path.startsWith('/operational-reference/personnel')) return 'PERSONNEL';
  if (path.startsWith('/operational-reference/recruitment')) return 'RECRUITMENT_CASES';
  if (path.startsWith('/personnel')) return 'PERSONNEL';
  if (path.startsWith('/relationships') || path.startsWith('/assignments') || path.startsWith('/supervisor-candidates')) return 'PERSONNEL';
  if (path.startsWith('/migration')) return 'DATA_MIGRATION_RECONCILIATION';
  if (path.startsWith('/redesign/compatibility/work-items')) return 'HR_WORK_MANAGEMENT';
  if (path.includes('/assessments')) return 'RECRUITMENT_CASES';
  if (path.startsWith('/redesign/compatibility/access')) return 'AUTHORITY_RESPONSIBILITY_ADMINISTRATION';
  return 'ORGANIZATIONAL_STRUCTURE';
};
export const hrBaseFeatureLevelForRequest = (method: string, path: string) => {
  if (method === 'GET') return 'VIEW' as const;
  if (path.startsWith('/migration')) return 'ADMIN' as const;
  if (path === '/personnel/exceptional') return 'VIEW' as const;
  if (/^\/personnel\/[^/]+\/(?:archive|restore)$/.test(path)) return 'VIEW' as const;
  if (method === 'PUT' && /^\/personnel\/[^/]+\/work-schedule$/.test(path)) return 'VIEW' as const;
  return 'EDIT' as const;
};
router.use((req: WorkspaceRequest, res, next) => {
  const level = hrBaseFeatureLevelForRequest(req.method, req.path);
  return requireHrFeature(featureForPath(req.path), level)(req, res, next);
});
router.use((req: WorkspaceRequest, res, next) => {
  if (req.method !== 'GET' && /^\/(?:personnel|relationships|assignments)(?:\/|$)/.test(req.path)) {
    res.once('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        publishRealtime('hr.personnel.changed', {});
      }
    });
  }
  next();
});

// Route-specific business authority and system-role middleware below remains
// independent from the workspace/feature decision performed above.
const viewAccess: express.RequestHandler = (_req, _res, next) => next();
const editAccess: express.RequestHandler = (_req, _res, next) => next();
const adminAccess: express.RequestHandler = (_req, _res, next) => next();
const EXCEPTIONAL_PERSONNEL_SOURCES = new Set(['DATA_MIGRATION', 'HISTORICAL_CORRECTION', 'ORGANIZATIONAL_TRANSFER']);

const requireHrActionPermission = (actionPermissionCode: string) => async (
  req: WorkspaceRequest,
  res: Response,
  next: express.NextFunction,
) => {
  try {
    const decision = await authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: [actionPermissionCode] });
    if (!decision.allowed) return res.status(403).json({ success: false, error: 'HR_ACTION_PERMISSION_REQUIRED' });
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireHrManagerAuthority = async (req: WorkspaceRequest, res: Response, next: express.NextFunction) => {
  try {
    const authority = await authorizeHrUser(prisma, req.user!.id, { actionPermissionCodes: ['ARCHIVE_RECRUITMENT_CASE'] });
    if (!authority.allowed) {
      return res.status(403).json({ success: false, error: 'اختیار سازمانی HR_MANAGER برای ثبت استثنایی پرسنل الزامی است.' });
    }
    return next();
  } catch (error) {
    next(error);
  }
};

export const canLinkPersonnelUserAccount = (systemRole: string, userAdministrationAllowed: boolean) => (
  ['ADMIN', 'MANAGER'].includes(systemRole) && userAdministrationAllowed
);

const requireUserAdministrationForPersonnelLink = async (req: WorkspaceRequest, res: Response, next: express.NextFunction) => {
  if (!req.body.userId) return next();
  try {
    const authorization = await authorizeHrUser(prisma, actorId(req), {
      workspaceLevel: 'ADMIN',
      feature: { code: 'USER_ADMINISTRATION', level: 'ADMIN' },
    });
    if (!canLinkPersonnelUserAccount(req.user!.role, authorization.allowed)) {
      return res.status(403).json({ success: false, error: 'HR_AUTHORIZATION_DENIED' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireSystemAdmin = (req: WorkspaceRequest, res: Response, next: express.NextFunction) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ success: false, error: 'فقط مدیر سامانه می‌تواند حذف دائمی انجام دهد.' });
  next();
};

const textValue = (value: unknown) => String(value ?? '').trim();
const nullableText = (value: unknown) => textValue(value) || null;
const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const jsonContainsExactValue = (value: unknown, expected: string): boolean => {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => jsonContainsExactValue(item, expected));
  if (value && typeof value === 'object') return Object.values(value).some((item) => jsonContainsExactValue(item, expected));
  return false;
};
const foundationHistoryDelta = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = ['isActive', 'type', 'parentId', 'jobId', 'organizationalUnitId', 'workplaceId', 'costCenterId', 'supervisorPositionId'];
  return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key)));
};
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
const badRequest = (res: Response, error: unknown) => res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'اطلاعات واردشده معتبر نیست.' });
const handleError = (res: Response, error: unknown, context: string) => {
  console.error(context, error);
  if (error instanceof FoundationVersionConflictError) {
    return res.status(409).json({ success: false, error: error.code, message: error.message });
  }
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
  capacityChanges: { orderBy: { effectiveAt: 'asc' as const } },
  recruitmentRequests: { orderBy: { effectiveFrom: 'asc' as const } },
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
      assignmentWithdrawals: { orderBy: { createdAt: 'desc' as const } },
      hiringApplication: { select: { id: true, stage: true, outcome: true, convertedAt: true, activatedAt: true } }
    }
  },
  hrPersonnelAudits: { orderBy: { createdAt: 'desc' as const }, take: 10 }
} as const;

const personnelListInclude = {
  user: { select: { id: true, username: true, email: true, isActive: true } },
  hrEmploymentRelationships: {
    orderBy: { effectiveFrom: 'desc' as const },
    include: {
      assignments: { orderBy: { effectiveFrom: 'desc' as const }, include: assignmentInclude },
      hiringApplication: { select: { id: true, stage: true, outcome: true, convertedAt: true, activatedAt: true } }
    }
  },
  hrPersonnelAudits: { orderBy: { createdAt: 'desc' as const }, take: 1 }
} as const;

const assertActiveReference = async (client: any, model: 'hrOrganizationalUnit' | 'hrWorkplace' | 'hrCostCenter' | 'hrJob', id: string | null, label: string, at = new Date()) => {
  if (!id) return;
  const record = await client[model].findUnique({ where: { id }, select: { isActive: true } });
  const entityType = model === 'hrOrganizationalUnit' ? 'ORGANIZATIONAL_UNIT' : model === 'hrWorkplace' ? 'WORKPLACE' : model === 'hrCostCenter' ? 'COST_CENTER' : 'JOB';
  const versions = record ? await client.hrFoundationLifecycleVersion.findMany({ where: { entityType, entityId: id }, select: { status: true, effectiveFrom: true, version: true, afterJson: true } }) : [];
  if (!record || !resolveFoundationStatus({ baseActive: record.isActive, at, versions })) throw new Error(`${label} پیدا نشد یا غیرفعال است.`);
};

const assertNoUnitCycle = async (client: any, unitId: string, parentId: string | null, at = new Date()) => {
  if (!parentId) return;
  if (unitId === parentId) throw new Error('واحد سازمانی نمی‌تواند والد خودش باشد.');
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === unitId) throw new Error('چرخه در سلسله‌مراتب سازمانی مجاز نیست.');
    const parent: { id: string; parentId: string | null; isActive: boolean } | null = await client.hrOrganizationalUnit.findUnique({ where: { id: cursor }, select: { id: true, parentId: true, isActive: true } });
    const versions = parent ? await client.hrFoundationLifecycleVersion.findMany({ where: { entityType: 'ORGANIZATIONAL_UNIT', entityId: parent.id }, select: { effectiveFrom: true, afterJson: true, version: true } }) : [];
    cursor = parent ? projectEffectiveFoundation(parent, versions, at).parentId || null : null;
  }
};

const assertNoPositionCycle = async (client: any, positionId: string, supervisorPositionId: string | null, at = new Date()) => {
  if (!supervisorPositionId) return;
  if (positionId === supervisorPositionId) throw new Error('جایگاه نمی‌تواند سرپرست خودش باشد.');
  let cursor: string | null = supervisorPositionId;
  while (cursor) {
    if (cursor === positionId) throw new Error('چرخه در خط گزارش‌دهی جایگاه‌ها مجاز نیست.');
    const parent: { id: string; supervisorPositionId: string | null; isActive: boolean } | null = await client.hrPosition.findUnique({ where: { id: cursor }, select: { id: true, supervisorPositionId: true, isActive: true } });
    const versions = parent ? await client.hrFoundationLifecycleVersion.findMany({ where: { entityType: 'POSITION', entityId: parent.id }, select: { effectiveFrom: true, afterJson: true, version: true } }) : [];
    cursor = parent ? projectEffectiveFoundation(parent, versions, at).supervisorPositionId || null : null;
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
  const relationship = await client.hrEmploymentRelationship.findUnique({ where: { id: input.relationshipId }, include: { hiringApplication: { select: { convertedAt: true } } } });
  if (!relationship) throw new Error('رابطه استخدامی پیدا نشد.');
  if (input.effectiveFrom < relationship.effectiveFrom || (relationship.effectiveTo && (!input.effectiveTo || input.effectiveTo > relationship.effectiveTo))) {
    throw new Error('بازه تخصیص باید کاملاً داخل بازه رابطه استخدامی باشد.');
  }
  const position = await client.hrPosition.findUnique({ where: { id: input.positionId }, include: positionInclude });
  const positionLifecycle = position ? await client.hrFoundationLifecycleVersion.findMany({
    where: { entityType: 'POSITION', entityId: input.positionId },
    select: { status: true, effectiveFrom: true, version: true, afterJson: true },
  }) : [];
  if (!position || !resolveFoundationStatus({ baseActive: position.isActive, at: input.effectiveFrom, versions: positionLifecycle })) throw new Error('جایگاه پیدا نشد یا غیرفعال است.');
  const lifecycleCheckpoints = [input.effectiveFrom, ...positionLifecycle
    .map((version: { effectiveFrom: Date }) => version.effectiveFrom)
    .filter((effectiveFrom: Date) => effectiveFrom >= input.effectiveFrom && (!input.effectiveTo || effectiveFrom <= input.effectiveTo))];
  if (lifecycleCheckpoints.some((checkpoint) => !resolveFoundationStatus({ baseActive: position.isActive, at: checkpoint, versions: positionLifecycle }))) {
    throw new Error('بازه تخصیص با دوره غیرفعال جایگاه هم‌پوشانی دارد.');
  }

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
    const occupiedAssignments = await client.hrEmploymentAssignment.findMany({
      where: {
        positionId: input.positionId,
        type: { in: ['PRIMARY', 'SECONDARY'] },
        ...(input.excludeAssignmentId ? { id: { not: input.excludeAssignmentId } } : {}),
        employmentRelationship: { status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } },
        ...overlaps(input.effectiveFrom, input.effectiveTo)
      },
      select: {
        id: true, type: true, effectiveFrom: true, effectiveTo: true,
        employmentRelationship: { select: { status: true, hiringApplication: { select: { convertedAt: true } } } },
      },
    });
    const commitments: CapacityAssignment[] = occupiedAssignments
      .filter((assignment: any) => !input.effectiveTo || assignment.effectiveFrom <= input.effectiveTo)
      .map((assignment: any) => ({
        id: assignment.id,
        type: assignment.type,
        relationshipStatus: assignment.employmentRelationship.status,
        effectiveFrom: assignment.effectiveFrom,
        effectiveTo: assignment.effectiveTo,
        hireConvertedAt: assignment.employmentRelationship.hiringApplication?.convertedAt ?? null,
      }));
    const candidate: CapacityAssignment = {
      id: input.excludeAssignmentId || 'candidate',
      type: input.type,
      relationshipStatus: relationship.status,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      hireConvertedAt: relationship.hiringApplication?.convertedAt ?? null,
    };
    const withinRequestedRange = (value: Date) => value >= input.effectiveFrom && (!input.effectiveTo || value <= input.effectiveTo);
    const checkpoints = [
      input.effectiveFrom,
      ...commitments.map((assignment) => assignment.effectiveFrom).filter(withinRequestedRange),
      ...position.capacityChanges.map((change: { effectiveAt: Date }) => change.effectiveAt).filter(withinRequestedRange),
    ];
    const violatesCapacity = checkpoints.some((checkpoint) => {
      const breakdown = reconcilePositionCapacity({ capacity: capacityAt(position.capacity, position.capacityChanges, checkpoint), active: true, at: checkpoint, assignments: [...commitments, candidate] });
      return breakdown.inUse + breakdown.reservedForStart > breakdown.capacity;
    });
    if (violatesCapacity) throw new Error('ظرفیت این جایگاه در بازه انتخاب‌شده تکمیل است.');
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

const foundationData = async (now = new Date()) => {
  const [organizationalUnits, workplaces, costCenters, jobs, positions, assignments, lifecycleVersions, availableUsers] = await Promise.all([
    prisma.hrOrganizationalUnit.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
    prisma.hrWorkplace.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
    prisma.hrCostCenter.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
    prisma.hrJob.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
    prisma.hrPosition.findMany({ include: positionInclude, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
    prisma.hrEmploymentAssignment.findMany({
      select: {
        id: true, positionId: true, type: true, effectiveFrom: true, effectiveTo: true,
        employmentRelationship: {
          select: { status: true, hiringApplication: { select: { convertedAt: true } } }
        }
      }
    }),
    prisma.hrFoundationLifecycleVersion.findMany({ orderBy: { effectiveFrom: 'asc' } }),
    prisma.user.findMany({ where: { personnelId: null, isActive: true }, select: { id: true, firstName: true, lastName: true, username: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] })
  ]);
  const versionsFor = (entityType: string, entityId: string) => lifecycleVersions
    .filter((version) => version.entityType === entityType && version.entityId === entityId);
  const projectLifecycle = <T extends { id: string; isActive: boolean }>(entityType: string, rows: T[]) => rows.map((row) => {
    const versions = versionsFor(entityType, row.id);
    const effective = projectEffectiveFoundation(row, versions, now);
    return {
      ...effective,
      isActive: resolveFoundationStatus({ baseActive: effective.isActive, at: now, versions }),
      lifecycle: versions,
    };
  });
  const projectedUnits = projectLifecycle('ORGANIZATIONAL_UNIT', organizationalUnits);
  const projectedWorkplaces = projectLifecycle('WORKPLACE', workplaces);
  const projectedCostCenters = projectLifecycle('COST_CENTER', costCenters);
  const projectedJobs = projectLifecycle('JOB', jobs);
  const projectedPositions = projectLifecycle('POSITION', positions);
  const unitRows = projectedUnits.map((unit) => {
    const checkpoints = [now, ...unit.lifecycle.filter((version) => version.effectiveFrom >= now).map((version) => version.effectiveFrom)];
    const dependencyParentIdsFrom = [...new Set(checkpoints.flatMap((checkpoint) => {
      const projected = projectEffectiveFoundation(unit, unit.lifecycle, checkpoint);
      return resolveFoundationStatus({ baseActive: projected.isActive, at: checkpoint, versions: unit.lifecycle }) && projected.parentId ? [projected.parentId] : [];
    }))];
    return { ...unit, dependencyParentIdsFrom };
  });
  const positionRows = projectedPositions.map((position) => {
    const positionAssignments: CapacityAssignment[] = assignments
      .filter((assignment) => assignment.positionId === position.id)
      .map((assignment) => ({
        id: assignment.id,
        type: assignment.type,
        relationshipStatus: assignment.employmentRelationship.status,
        effectiveFrom: assignment.effectiveFrom,
        effectiveTo: assignment.effectiveTo,
        hireConvertedAt: assignment.employmentRelationship.hiringApplication?.convertedAt ?? null,
      }));
    const effectiveCapacity = capacityAt(position.capacity, position.capacityChanges, now);
    const breakdown = reconcilePositionCapacity({ capacity: effectiveCapacity, active: position.isActive, at: now, assignments: positionAssignments });
    const projectedSupervisor = projectedPositions.find((candidate) => candidate.id === position.supervisorPositionId);
    const subordinatePositions = projectedPositions.filter((candidate) => candidate.isActive && candidate.supervisorPositionId === position.id).length;
    return {
      ...position,
      job: projectedJobs.find((job) => job.id === position.jobId) ?? position.job,
      organizationalUnit: projectedUnits.find((unit) => unit.id === position.organizationalUnitId) ?? position.organizationalUnit,
      workplace: projectedWorkplaces.find((workplace) => workplace.id === position.workplaceId) ?? position.workplace,
      costCenter: projectedCostCenters.find((costCenter) => costCenter.id === position.costCenterId) ?? position.costCenter,
      supervisorPosition: projectedSupervisor
        ? { id: projectedSupervisor.id, code: projectedSupervisor.code, title: projectedSupervisor.title }
        : position.supervisorPosition,
      capacity: effectiveCapacity,
      capacityBreakdown: breakdown,
      _count: { ...position._count, subordinatePositions },
      occupancy: { active: breakdown.inUse, committed: breakdown.reservedForStart },
      vacancy: breakdown.vacancy,
    };
  });
  return {
    organizationalUnits: unitRows,
    workplaces: projectedWorkplaces,
    costCenters: projectedCostCenters,
    jobs: projectedJobs,
    availableUsers,
    positions: positionRows,
    capacitySummary: summarizePositionCoverage(positionRows.filter((position) => position.isActive).map((position) => position.capacityBreakdown)),
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

router.get('/foundation', viewAccess, async (req, res) => {
  try {
    const [data, deletionDecision, editDecision] = await Promise.all([
      foundationData(req.query.dependencyAt ? parseDate(req.query.dependencyAt, 'تاریخ وابستگی') : new Date()),
      authorizeHrUser(prisma, actorId(req as WorkspaceRequest), { actionPermissionCodes: ['PERMANENTLY_DELETE_ORGANIZATIONAL_FOUNDATION'] }),
      authorizeHrUser(prisma, actorId(req as WorkspaceRequest), { feature: { code: 'ORGANIZATIONAL_STRUCTURE', level: 'EDIT' } }),
    ]);
    res.json({ success: true, data: { ...data, capabilities: { canEditFoundation: editDecision.allowed, canPermanentlyDeleteFoundation: deletionDecision.allowed, canPermanentlyDeleteCatalog: (req as WorkspaceRequest).user!.role === 'ADMIN' } } });
  }
  catch (error) { handleError(res, error, 'HR foundation'); }
});

router.get('/operational-reference/:surface', viewAccess, async (req: WorkspaceRequest, res) => {
  try {
    const surface = textValue(req.params.surface);
    if (!['personnel', 'recruitment'].includes(surface)) {
      return res.status(404).json({ success: false, error: 'سطح مرجع منابع انسانی پیدا نشد.' });
    }
    const [actionPermissions, personnelEdit] = await Promise.all([
      activeHrActionPermissionsForUser(prisma, actorId(req)),
      surface === 'personnel'
        ? authorizeHrUser(prisma, actorId(req), { workspaceLevel: 'EDIT', feature: { code: 'PERSONNEL', level: 'EDIT' } })
        : Promise.resolve({ allowed: false }),
    ]);
    const includeAvailableCapacity = surface === 'recruitment'
      ? actionPermissions.includes('MANAGE_RECRUITMENT_CASE')
      : personnelEdit.allowed || actionPermissions.includes('ARCHIVE_RECRUITMENT_CASE');
    return res.json({
      success: true,
      data: await loadHrOperationalReference(prisma, { includeAvailableCapacity }),
    });
  } catch (error) { return handleError(res, error, 'HR operational reference'); }
});

export const filterFoundationPositions = (positions: Awaited<ReturnType<typeof foundationData>>['positions'], filter: string, dependencyAt?: Date) => positions.filter((position) => {
  const matchesStructuralFrom = (field: 'supervisorPositionId' | 'organizationalUnitId' | 'jobId' | 'workplaceId' | 'costCenterId', expected: string) => {
    if (!dependencyAt) return position[field] === expected;
    const checkpoints = [dependencyAt, ...position.lifecycle.filter((version) => version.effectiveFrom >= dependencyAt).map((version) => version.effectiveFrom)];
    return checkpoints.some((checkpoint) => {
      const projected = projectEffectiveFoundation(position, position.lifecycle, checkpoint);
      return resolveFoundationStatus({ baseActive: projected.isActive, at: checkpoint, versions: position.lifecycle }) && projected[field] === expected;
    });
  };
  if (filter === 'vacant') return position.capacityBreakdown.vacancy > 0;
  if (filter === 'in-use') return position.capacityBreakdown.inUse > 0;
  if (filter === 'reserved' || filter === 'committed') return position.capacityBreakdown.reservedForStart > 0;
  if (filter === 'allocated') return position.capacityBreakdown.inUse + position.capacityBreakdown.reservedForStart > 0;
  if (filter === 'acting') return position.capacityBreakdown.acting > 0;
  if (filter === 'ended') return position.capacityBreakdown.ended > 0;
  if (filter === 'future') return position.capacityBreakdown.future > 0;
  if (filter === 'inactive') return !position.isActive;
  if (filter === 'vacant-supervisor') return position._count.subordinatePositions > 0 && position.capacityBreakdown.inUse === 0;
  if (filter.startsWith('supervisor:')) return matchesStructuralFrom('supervisorPositionId', filter.slice('supervisor:'.length));
  if (filter.startsWith('organizational-unit:')) return matchesStructuralFrom('organizationalUnitId', filter.slice('organizational-unit:'.length));
  if (filter.startsWith('job:')) return matchesStructuralFrom('jobId', filter.slice('job:'.length));
  if (filter.startsWith('workplace:')) return matchesStructuralFrom('workplaceId', filter.slice('workplace:'.length));
  if (filter.startsWith('cost_center:')) return matchesStructuralFrom('costCenterId', filter.slice('cost_center:'.length));
  return true;
});

router.get('/positions', viewAccess, async (req, res) => {
  try {
    const foundation = await foundationData(req.query.dependencyAt ? parseDate(req.query.dependencyAt, 'تاریخ وابستگی') : new Date());
    const filter = textValue(req.query.filter) || 'all';
    const dependencyAt = req.query.dependencyAt ? parseDate(req.query.dependencyAt, 'تاریخ وابستگی') : undefined;
    res.json({ success: true, data: { filter, positions: filterFoundationPositions(foundation.positions, filter, dependencyAt) } });
  } catch (error) { handleError(res, error, 'List HR positions'); }
});

router.get('/positions/capacity-summary', viewAccess, async (_req, res) => {
  try {
    const foundation = await foundationData(_req.query.dependencyAt ? parseDate(_req.query.dependencyAt, 'تاریخ وابستگی') : new Date());
    res.json({ success: true, data: foundation.capacitySummary });
  } catch (error) { handleError(res, error, 'HR position capacity summary'); }
});

router.get('/positions/:id/history', viewAccess, async (req: WorkspaceRequest, res) => {
  try {
    const [editDecision, personnelViewDecision] = await Promise.all([
      authorizeHrUser(prisma, actorId(req), {
        workspaceLevel: 'EDIT',
        feature: { code: 'ORGANIZATIONAL_STRUCTURE', level: 'EDIT' },
      }),
      authorizeHrUser(prisma, actorId(req), {
        workspaceLevel: 'VIEW',
        feature: { code: 'PERSONNEL', level: 'VIEW' },
      }),
    ]);
    const position = await prisma.hrPosition.findUnique({
      where: { id: req.params.id },
      include: {
        ...positionInclude,
        assignments: {
          orderBy: { effectiveFrom: 'desc' },
          include: {
            employmentRelationship: {
              select: {
                status: true,
                hiringApplication: { select: { convertedAt: true } },
                personnel: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });
    if (!position) return res.status(404).json({ success: false, error: 'جایگاه پیدا نشد.' });
    const lifecycle = await prisma.hrFoundationLifecycleVersion.findMany({
      where: { entityType: 'POSITION', entityId: position.id },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    const effectivePosition = (await foundationData()).positions.find((candidate) => candidate.id === position.id) ?? position;
    const historyView = textValue(req.query.view);
    const historyNow = req.query.dependencyAt ? parseDate(req.query.dependencyAt, 'تاریخ وابستگی') : new Date();
    const assignmentRows = position.assignments.filter((assignment) => historyView !== 'assignments-live' || (
      ['PLANNED', 'ACTIVE', 'SUSPENDED'].includes(assignment.employmentRelationship.status)
      && (!assignment.effectiveTo || assignment.effectiveTo >= historyNow)
    ));
    res.json({
      success: true,
      data: {
        position: {
          id: effectivePosition.id, code: effectivePosition.code, title: effectivePosition.title, capacity: effectivePosition.capacity, isActive: effectivePosition.isActive, updatedAt: position.updatedAt,
          job: effectivePosition.job, organizationalUnit: effectivePosition.organizationalUnit,
          workplace: effectivePosition.workplace, costCenter: effectivePosition.costCenter,
          supervisorPosition: effectivePosition.supervisorPosition,
        },
        assignments: assignmentRows.map((assignment) => ({
          id: assignment.id,
          type: assignment.type,
          relationshipStatus: assignment.employmentRelationship.status,
          effectiveFrom: assignment.effectiveFrom,
          effectiveTo: assignment.effectiveTo,
          hireConvertedAt: assignment.employmentRelationship.hiringApplication?.convertedAt ?? null,
          personnel: personnelViewDecision.allowed ? {
            id: assignment.employmentRelationship.personnel.id,
            name: `${assignment.employmentRelationship.personnel.firstName} ${assignment.employmentRelationship.personnel.lastName}`,
          } : null,
        })),
        capacityChanges: position.capacityChanges.map((change) => ({
          id: change.id, version: change.version, previousCapacity: change.previousCapacity,
          newCapacity: change.newCapacity, effectiveAt: change.effectiveAt, reason: change.reason, createdAt: change.createdAt,
        })),
        recruitmentRequests: position.recruitmentRequests.filter((request) => historyView !== 'recruitment-open' || (
          ['DRAFT', 'APPROVED'].includes(request.status) && (!request.effectiveTo || request.effectiveTo >= historyNow)
        )).map((request) => ({
          id: request.id, status: request.status, approvedHeadcount: request.approvedHeadcount,
          convertedHires: request.convertedHires, effectiveFrom: request.effectiveFrom, effectiveTo: request.effectiveTo,
        })),
        structuralChanges: lifecycle.map((change) => ({
          id: change.id,
          version: change.version,
          status: change.status,
          effectiveFrom: change.effectiveFrom,
          reason: change.reason,
          changes: foundationHistoryDelta(change.afterJson),
          createdAt: change.createdAt,
        })),
        capabilities: { canEditCapacity: editDecision.allowed, canViewAssigneeIdentity: personnelViewDecision.allowed },
      },
    });
  } catch (error) { handleError(res, error, 'HR position history'); }
});

router.post('/positions/:id/capacity-changes', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const stableKey = textValue(req.body.idempotencyKey) || crypto.randomUUID();
      const replay = await tx.hrPositionCapacityChange.findUnique({ where: { stableKey } });
      if (replay) {
        if (replay.positionId !== req.params.id) throw new Error('کلید تکرار به تغییر دیگری تعلق دارد.');
        return replay;
      }
      const position = await tx.hrPosition.findUnique({
        where: { id: req.params.id },
        include: { capacityChanges: { orderBy: { effectiveAt: 'asc' } } },
      });
      if (!position) throw new Error('جایگاه پیدا نشد.');
      assertFreshVersion(position.updatedAt, req.body.expectedUpdatedAt);
      const effectiveAt = parseDate(req.body.effectiveAt, 'تاریخ اثر');
      const newCapacity = Number(normalizeApplicantDigits(req.body.newCapacity));
      const assignmentRows = await tx.hrEmploymentAssignment.findMany({
        where: {
          positionId: position.id,
          type: { in: ['PRIMARY', 'SECONDARY'] },
          employmentRelationship: { status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }],
        },
        select: {
          id: true, type: true, effectiveFrom: true, effectiveTo: true,
          employmentRelationship: { select: { status: true, hiringApplication: { select: { convertedAt: true } } } },
        },
      });
      const capacityAssignments: CapacityAssignment[] = assignmentRows.map((assignment) => ({
        id: assignment.id, type: assignment.type,
        relationshipStatus: assignment.employmentRelationship.status,
        effectiveFrom: assignment.effectiveFrom, effectiveTo: assignment.effectiveTo,
        hireConvertedAt: assignment.employmentRelationship.hiringApplication?.convertedAt ?? null,
      }));
      const recruitment = await tx.hrRecruitmentRequest.findMany({
        where: {
          positionId: position.id, status: 'APPROVED',
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }],
        },
        select: { approvedHeadcount: true, convertedHires: true, effectiveFrom: true, effectiveTo: true },
      });
      const previousCapacity = capacityAt(position.capacity, position.capacityChanges, effectiveAt);
      assertCapacityChangeAllowed({
        currentCapacity: previousCapacity,
        newCapacity,
        committedFromEffectiveDate: maximumCapacityCommitmentFrom(capacityAssignments, effectiveAt, recruitment.map((request) => ({
          effectiveFrom: request.effectiveFrom,
          effectiveTo: request.effectiveTo,
          remaining: request.approvedHeadcount - request.convertedHires,
        }))),
        approvedRecruitmentRemaining: 0,
        reason: textValue(req.body.reason),
        effectiveAt,
        today: new Date(),
      });
      const latestVersion = await tx.hrPositionCapacityChange.findFirst({ where: { positionId: position.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const version = (latestVersion?.version ?? 0) + 1;
      const change = await tx.hrPositionCapacityChange.create({
        data: {
          stableKey, positionId: position.id, version, previousCapacity, newCapacity, effectiveAt,
          reason: textValue(req.body.reason) || 'افزایش ظرفیت', changedByUserId: actorId(req),
        },
      });
      await tx.hrPosition.update({ where: { id: position.id }, data: effectiveAt <= new Date() ? { capacity: newCapacity } : { updatedAt: new Date() } });
      return change;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ success: true, data: result });
  } catch (error) { handleError(res, error, 'Change HR position capacity'); }
});

const foundationEntityModels = {
  'organizational-unit': { entityType: 'ORGANIZATIONAL_UNIT', model: 'hrOrganizationalUnit' },
  workplace: { entityType: 'WORKPLACE', model: 'hrWorkplace' },
  'cost-center': { entityType: 'COST_CENTER', model: 'hrCostCenter' },
  job: { entityType: 'JOB', model: 'hrJob' },
  position: { entityType: 'POSITION', model: 'hrPosition' },
} as const;
type FoundationEntitySlug = keyof typeof foundationEntityModels;

const foundationEntityConfig = (value: string) => {
  const config = foundationEntityModels[value as FoundationEntitySlug];
  if (!config) throw new Error('نوع رکورد سازمانی معتبر نیست.');
  return config;
};

const foundationDependencyPreview = async (
  entityType: string,
  id: string,
  client: any = prisma,
  at = new Date(),
  includeInactiveDefinitions = false,
) => {
  const now = at;
  const dependency = (kind: string, count: number, href: string) => ({ kind, count, href });
  const lifecycleHistory = await client.hrFoundationLifecycleVersion.findMany({
    select: { entityType: true, entityId: true, version: true, status: true, effectiveFrom: true, beforeJson: true, afterJson: true },
  });
  const projectDefinitionAt = (entityTypeForRow: string, row: any, projectAt: Date) => {
    const versions = lifecycleHistory.filter((version: any) => version.entityType === entityTypeForRow && version.entityId === row.id);
    const projected = projectEffectiveFoundation(row, versions, projectAt);
    return { ...projected, isActive: resolveFoundationStatus({ baseActive: projected.isActive, at: projectAt, versions }) };
  };
  const isDefinitionDependentFrom = (entityTypeForRow: string, row: any, predicate: (projected: any) => boolean) => {
    const checkpoints = [at, ...lifecycleHistory
      .filter((version: any) => version.entityType === entityTypeForRow && version.entityId === row.id && version.effectiveFrom >= at)
      .map((version: any) => version.effectiveFrom)];
    return checkpoints.some((checkpoint) => {
      const projected = projectDefinitionAt(entityTypeForRow, row, checkpoint);
      return (includeInactiveDefinitions || projected.isActive) && predicate(projected);
    });
  };
  const historicalStructureReferences = lifecycleHistory.filter((version: any) => (
    (version.entityType === entityType && version.entityId === id && version.version > 1)
    || ((version.entityType !== entityType || version.entityId !== id)
      && (jsonContainsExactValue(version.beforeJson, id) || jsonContainsExactValue(version.afterJson, id)))
  )).length;
  if (entityType === 'POSITION') {
    const [liveAssignments, allAssignments, liveApplications, allApplications, recruitmentRequests, allRecruitmentRequests, subordinateRows, capacityChanges, activeEvaluationEligibility, allEvaluationEligibility] = await Promise.all([
      client.hrEmploymentAssignment.count({ where: { positionId: id, employmentRelationship: { status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] } }),
      client.hrEmploymentAssignment.count({ where: { positionId: id } }),
      client.hrJobApplication.count({ where: { positionId: id, outcome: null } }),
      client.hrJobApplication.count({ where: { positionId: id } }),
      client.hrRecruitmentRequest.count({ where: { positionId: id, status: { in: ['DRAFT', 'APPROVED'] }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] } }),
      client.hrRecruitmentRequest.count({ where: { positionId: id } }),
      client.hrPosition.findMany({ select: { id: true, supervisorPositionId: true, isActive: true } }),
      client.hrPositionCapacityChange.count({ where: { positionId: id } }),
      client.hrRecruitmentEvaluationPositionEligibility.count({ where: { positionId: id, isActive: true } }),
      client.hrRecruitmentEvaluationPositionEligibility.count({ where: { positionId: id } }),
    ]);
    const subordinates = subordinateRows.filter((row: any) => isDefinitionDependentFrom('POSITION', row, (projected) => projected.supervisorPositionId === id)).length;
    const live = [
        dependency('assignments', liveAssignments, `/dashboard/hr/structure/positions/${id}?view=assignments-live&dependencyAt=${encodeURIComponent(at.toISOString())}`),
        dependency('applications', liveApplications, `/dashboard/hr/hiring?positionId=${id}`),
        dependency('recruitmentRequests', recruitmentRequests, `/dashboard/hr/structure/positions/${id}?view=recruitment-open&dependencyAt=${encodeURIComponent(at.toISOString())}`),
        dependency('subordinatePositions', subordinates, `/dashboard/hr/structure/positions?filter=supervisor:${id}&dependencyAt=${encodeURIComponent(at.toISOString())}`),
        dependency('evaluationEligibility', activeEvaluationEligibility, '/dashboard/hr/hiring?view=evaluator-settings'),
      ].filter((row) => row.count > 0);
    const snapshotEligible = [
      dependency('assignments', Math.max(0, allAssignments - liveAssignments), `/dashboard/hr/structure/positions/${id}?view=ended`),
      dependency('applications', Math.max(0, allApplications - liveApplications), `/dashboard/hr/hiring?positionId=${id}&view=closed`),
      dependency('recruitmentRequests', Math.max(0, allRecruitmentRequests - recruitmentRequests), `/dashboard/hr/structure/positions/${id}?view=recruitment-history`),
      dependency('capacityChanges', capacityChanges, `/dashboard/hr/structure/positions/${id}?view=capacity`),
      dependency('evaluationEligibility', Math.max(0, allEvaluationEligibility - activeEvaluationEligibility), '/dashboard/hr/hiring?view=evaluator-settings'),
    ].filter((row) => row.count > 0);
    return { live, resolvable: live, snapshotEligible, eligible: live.length === 0, historicalReferenceCount: allAssignments + allApplications + allRecruitmentRequests + capacityChanges + allEvaluationEligibility + historicalStructureReferences };
  }
  if (entityType === 'ORGANIZATIONAL_UNIT') {
    const [unitRows, positionRows, liveAssignments, allAssignments] = await Promise.all([
      client.hrOrganizationalUnit.findMany({ select: { id: true, parentId: true, isActive: true } }),
      client.hrPosition.findMany({ select: { id: true, organizationalUnitId: true, isActive: true } }),
      client.hrEmploymentAssignment.findMany({ where: { organizationalUnitId: id, employmentRelationship: { status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }, select: { employmentRelationship: { select: { personnelId: true } } } }),
      client.hrEmploymentAssignment.count({ where: { organizationalUnitId: id } }),
    ]);
    const livePersonnel = new Set(liveAssignments.map((assignment: any) => assignment.employmentRelationship.personnelId)).size;
    const children = unitRows.filter((row: any) => isDefinitionDependentFrom('ORGANIZATIONAL_UNIT', row, (projected) => projected.parentId === id)).length;
    const positions = positionRows.filter((row: any) => isDefinitionDependentFrom('POSITION', row, (projected) => projected.organizationalUnitId === id)).length;
    const live = [dependency('childUnits', children, `/dashboard/hr/structure?tab=units&parentId=${id}&dependencyAt=${encodeURIComponent(at.toISOString())}`), dependency('positions', positions, `/dashboard/hr/structure/positions?filter=organizational-unit:${id}&dependencyAt=${encodeURIComponent(at.toISOString())}`), dependency('assignments', livePersonnel, `/dashboard/hr/personnel?organizationalUnitId=${id}&dependencyAt=${encodeURIComponent(at.toISOString())}`)].filter((row) => row.count > 0);
    const snapshotEligible = [dependency('assignments', Math.max(0, allAssignments - liveAssignments.length), `/dashboard/hr/personnel?organizationalUnitId=${id}`)].filter((row) => row.count > 0);
    return { live, resolvable: live, snapshotEligible, eligible: live.length === 0, historicalReferenceCount: allAssignments + positions + children + historicalStructureReferences };
  }
  const field = entityType === 'JOB' ? 'jobId' : entityType === 'WORKPLACE' ? 'workplaceId' : 'costCenterId';
  const positionRows = await client.hrPosition.findMany({ select: { id: true, jobId: true, workplaceId: true, costCenterId: true, isActive: true } });
  const positions = positionRows.filter((row: any) => isDefinitionDependentFrom('POSITION', row, (projected) => projected[field] === id)).length;
  const assignments = entityType === 'JOB' ? 0 : await client.hrEmploymentAssignment.count({ where: { [field]: id } });
  const liveAssignmentRows = entityType === 'JOB' ? [] : await client.hrEmploymentAssignment.findMany({ where: {
    [field]: id,
    employmentRelationship: { status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
  }, select: { employmentRelationship: { select: { personnelId: true } } } });
  const liveAssignments = new Set(liveAssignmentRows.map((assignment: any) => assignment.employmentRelationship.personnelId)).size;
  const assignmentFilter = entityType === 'WORKPLACE' ? 'workplaceId' : 'costCenterId';
  const live = [
      dependency('positions', positions, `/dashboard/hr/structure/positions?filter=${entityType.toLowerCase()}:${id}&dependencyAt=${encodeURIComponent(at.toISOString())}`),
      dependency('assignments', liveAssignments, `/dashboard/hr/personnel?${assignmentFilter}=${id}&dependencyAt=${encodeURIComponent(at.toISOString())}`),
      ...(entityType === 'JOB' ? [] : [dependency('historicalAssignments', Math.max(0, assignments - liveAssignmentRows.length), `/dashboard/hr/personnel?${assignmentFilter}=${id}`)]),
      ...(entityType === 'JOB' || historicalStructureReferences === 0 ? [] : [dependency('historicalStructureChanges', historicalStructureReferences, '/dashboard/hr/structure')]),
    ].filter((row) => row.count > 0);
  const snapshotEligible: Array<{ kind: string; count: number; href: string }> = [];
  return { live, resolvable: live, snapshotEligible, eligible: live.length === 0, historicalReferenceCount: positions + assignments + historicalStructureReferences };
};

router.get('/foundation/:entityType/:id/dependencies', viewAccess, async (req, res) => {
  try {
    const config = foundationEntityConfig(req.params.entityType);
    res.json({ success: true, data: await foundationDependencyPreview(config.entityType, req.params.id, prisma, new Date(), textValue(req.query.purpose) === 'deletion') });
  } catch (error) { handleError(res, error, 'Preview HR foundation dependencies'); }
});

router.get('/foundation/:entityType/:id/detail', viewAccess, async (req: WorkspaceRequest, res) => {
  try {
    const config = foundationEntityConfig(req.params.entityType);
    if (!['ORGANIZATIONAL_UNIT', 'JOB', 'POSITION'].includes(config.entityType)) throw new Error('جزئیات این نوع تعریف سازمانی پشتیبانی نمی‌شود.');
    const [current, historicalSnapshot, deletionReceipt, codeHistory, lifecycle, editDecision, personnelViewDecision, recruitmentViewDecision, deleteDecision] = await Promise.all([
      (prisma as any)[config.model].findUnique({ where: { id: req.params.id } }),
      prisma.hrFoundationHistoricalSnapshot.findUnique({ where: { entityType_entityId: { entityType: config.entityType, entityId: req.params.id } } }),
      prisma.hrFoundationDeletionReceipt.findUnique({ where: { entityType_entityId: { entityType: config.entityType, entityId: req.params.id } } }),
      prisma.hrFoundationCodeOccurrence.findMany({ where: { entityType: config.entityType, entityId: req.params.id }, orderBy: { assignedAt: 'desc' } }),
      prisma.hrFoundationLifecycleVersion.findMany({ where: { entityType: config.entityType, entityId: req.params.id }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }] }),
      authorizeHrUser(prisma, actorId(req), { feature: { code: 'ORGANIZATIONAL_STRUCTURE', level: 'EDIT' } }),
      authorizeHrUser(prisma, actorId(req), { workspaceLevel: 'VIEW', feature: { code: 'PERSONNEL', level: 'VIEW' } }),
      authorizeHrUser(prisma, actorId(req), { workspaceLevel: 'VIEW', feature: { code: 'RECRUITMENT_CASES', level: 'VIEW' } }),
      authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: ['PERMANENTLY_DELETE_ORGANIZATIONAL_FOUNDATION'] }),
    ]);
    if (!current && !historicalSnapshot) return res.status(404).json({ success: false, error: 'رکورد سازمانی پیدا نشد.' });
    if (!current) {
      const storedSnapshot = historicalSnapshot?.snapshotJson as Record<string, unknown> | undefined;
      const snapshotJson = storedSnapshot && !recruitmentViewDecision.allowed
        ? { ...storedSnapshot, evaluationEligibilityHistory: undefined }
        : storedSnapshot;
      return res.json({ success: true, data: {
      entityType: config.entityType, entity: snapshotJson, deleted: true,
      deletionReceipt, codeHistory, lifecycle: Array.isArray(snapshotJson?.lifecycleHistory) ? snapshotJson.lifecycleHistory : [], dependencies: { live: [], resolvable: [], snapshotEligible: [], eligible: false },
      linked: {}, capabilities: { canEdit: false, canDelete: false, canViewPersonnelIdentity: false },
    } });
    }
    const dependencies = await foundationDependencyPreview(config.entityType, current.id, prisma, new Date(), true);
    let linked: Record<string, unknown> = {};
    if (config.entityType === 'ORGANIZATIONAL_UNIT') {
      const [children, positions, assignments] = await Promise.all([
        prisma.hrOrganizationalUnit.findMany({ where: { parentId: current.id }, select: { id: true, code: true, codeOccurrence: true, name: true, type: true, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.hrPosition.findMany({ where: { organizationalUnitId: current.id }, select: { id: true, code: true, codeOccurrence: true, title: true, isActive: true }, orderBy: { title: 'asc' } }),
        prisma.hrEmploymentAssignment.findMany({ where: { organizationalUnitId: current.id }, include: { employmentRelationship: { include: { personnel: { select: { id: true, firstName: true, lastName: true } } } }, position: { select: { id: true, code: true, title: true } } }, orderBy: { effectiveFrom: 'desc' } }),
      ]);
      linked = { children, positions, assignments: assignments.map((row) => ({ id: row.id, type: row.type, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, relationshipStatus: row.employmentRelationship.status, position: row.position, personnel: personnelViewDecision.allowed ? { id: row.employmentRelationship.personnel.id, name: `${row.employmentRelationship.personnel.firstName} ${row.employmentRelationship.personnel.lastName}` } : null })) };
    } else if (config.entityType === 'JOB') {
      linked = { positions: await prisma.hrPosition.findMany({ where: { jobId: current.id }, include: { organizationalUnit: { select: { id: true, code: true, name: true } } }, orderBy: { title: 'asc' } }) };
    } else {
      const [position, withdrawals] = await Promise.all([
        prisma.hrPosition.findUnique({ where: { id: current.id }, include: { ...positionInclude, subordinatePositions: { select: { id: true, code: true, codeOccurrence: true, title: true, isActive: true } }, assignments: { include: { employmentRelationship: { include: { personnel: { select: { id: true, firstName: true, lastName: true } } } } }, orderBy: { effectiveFrom: 'desc' } }, hiringApplications: { select: { id: true, stage: true, outcome: true } } } }),
        prisma.hrEmploymentAssignmentWithdrawal.findMany({ where: { assignmentSnapshot: { path: ['position', 'entityId'], equals: current.id } }, orderBy: { createdAt: 'desc' } }),
      ]);
      const visibleWithdrawals = withdrawals.map((row) => {
        if (!row.assignmentSnapshot || typeof row.assignmentSnapshot !== 'object' || Array.isArray(row.assignmentSnapshot)) return row;
        const assignmentSnapshot = { ...(row.assignmentSnapshot as Record<string, any>) };
        if (!personnelViewDecision.allowed) assignmentSnapshot.personnel = null;
        if (!recruitmentViewDecision.allowed && assignmentSnapshot.position && typeof assignmentSnapshot.position === 'object' && !Array.isArray(assignmentSnapshot.position)) {
          const position = { ...assignmentSnapshot.position };
          if (position.definition && typeof position.definition === 'object' && !Array.isArray(position.definition)) {
            const { recruitmentRequests: _restrictedRequests, recruitmentEvaluationEligibilities: _restrictedEligibilities, ...visibleDefinition } = position.definition;
            position.definition = visibleDefinition;
          }
          assignmentSnapshot.position = position;
        }
        return { ...row, assignmentSnapshot };
      });
      linked = {
        ...position,
        assignments: position?.assignments.map((row) => ({ ...row, personnel: personnelViewDecision.allowed ? { id: row.employmentRelationship.personnel.id, name: `${row.employmentRelationship.personnel.firstName} ${row.employmentRelationship.personnel.lastName}` } : null, employmentRelationship: undefined })),
        hiringApplications: recruitmentViewDecision.allowed ? position?.hiringApplications : [],
        recruitmentRequests: recruitmentViewDecision.allowed ? position?.recruitmentRequests : [],
        withdrawals: visibleWithdrawals,
      };
    }
    res.json({ success: true, data: {
      entityType: config.entityType, entity: current, deleted: false, deletionReceipt: null, codeHistory, lifecycle,
      dependencies, linked,
      capabilities: { canEdit: editDecision.allowed, canDelete: deleteDecision.allowed, canViewPersonnelIdentity: personnelViewDecision.allowed },
    } });
  } catch (error) { handleError(res, error, 'HR foundation detail'); }
});

router.post('/foundation/:entityType/:id/lifecycle', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const config = foundationEntityConfig(req.params.entityType);
    const status = textValue(req.body.status);
    if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new Error('وضعیت چرخه عمر معتبر نیست.');
    const effectiveFrom = parseDate(req.body.effectiveFrom, 'تاریخ اثر');
    if (Date.UTC(effectiveFrom.getUTCFullYear(), effectiveFrom.getUTCMonth(), effectiveFrom.getUTCDate()) < Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) throw new Error('تغییر چرخه عمر در گذشته مجاز نیست.');
    const reason = textValue(req.body.reason);
    if (!reason) throw new Error('دلیل تغییر وضعیت الزامی است.');
    const result = await prisma.$transaction(async (tx) => {
      const stableKey = textValue(req.body.idempotencyKey) || crypto.randomUUID();
      const replay = await tx.hrFoundationLifecycleVersion.findUnique({ where: { stableKey } });
      if (replay) {
        if (replay.entityType !== config.entityType || replay.entityId !== req.params.id) throw new Error('کلید تکرار به تغییر دیگری تعلق دارد.');
        return replay;
      }
      const model = (tx as any)[config.model];
      const entity = await model.findUnique({ where: { id: req.params.id } });
      if (!entity) throw new Error('رکورد سازمانی پیدا نشد.');
      assertFreshVersion(entity.updatedAt, req.body.expectedUpdatedAt);
      const entityVersions = await tx.hrFoundationLifecycleVersion.findMany({
        where: { entityType: config.entityType, entityId: entity.id },
        select: { effectiveFrom: true, afterJson: true, version: true },
      });
      const projectedEntity = projectEffectiveFoundation(entity, entityVersions, effectiveFrom);
      if (status === 'INACTIVE') {
        const dependencies = await foundationDependencyPreview(config.entityType, entity.id, tx, effectiveFrom);
        if (dependencies.live.length) {
          const error = new Error('غیرفعال‌سازی به دلیل وابستگی‌های زنده مسدود است.') as Error & { dependencies?: unknown };
          error.dependencies = dependencies.live;
          throw error;
        }
      }
      if (status === 'ACTIVE' && config.entityType === 'POSITION') {
        await Promise.all([
          assertActiveReference(tx, 'hrJob', projectedEntity.jobId, 'شغل', effectiveFrom),
          assertActiveReference(tx, 'hrOrganizationalUnit', projectedEntity.organizationalUnitId, 'واحد سازمانی', effectiveFrom),
          assertActiveReference(tx, 'hrWorkplace', projectedEntity.workplaceId, 'محل کار', effectiveFrom),
          assertActiveReference(tx, 'hrCostCenter', projectedEntity.costCenterId, 'مرکز هزینه', effectiveFrom),
        ]);
        await assertNoPositionCycle(tx, entity.id, projectedEntity.supervisorPositionId, effectiveFrom);
      }
      if (status === 'ACTIVE' && config.entityType === 'ORGANIZATIONAL_UNIT' && projectedEntity.parentId) {
        await assertActiveReference(tx, 'hrOrganizationalUnit', projectedEntity.parentId, 'واحد والد', effectiveFrom);
        await assertNoUnitCycle(tx, entity.id, projectedEntity.parentId, effectiveFrom);
      }
      const previous = await tx.hrFoundationLifecycleVersion.findFirst({
        where: { entityType: config.entityType, entityId: entity.id }, orderBy: { version: 'desc' },
      });
      const version = (previous?.version ?? 0) + 1;
      const lifecycle = await tx.hrFoundationLifecycleVersion.create({
        data: {
          stableKey, entityType: config.entityType, entityId: entity.id, version,
          status: status as 'ACTIVE' | 'INACTIVE', effectiveFrom, reason,
          beforeJson: jsonValue({ isActive: entity.isActive }), afterJson: jsonValue({ isActive: status === 'ACTIVE' }), changedByUserId: actorId(req),
        },
      });
      await model.update({ where: { id: entity.id }, data: effectiveFrom <= new Date() ? { isActive: status === 'ACTIVE' } : { updatedAt: new Date() } });
      return lifecycle;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error && 'dependencies' in error) return res.status(409).json({ success: false, error: error.message, dependencies: (error as any).dependencies });
    handleError(res, error, 'Change HR foundation lifecycle');
  }
});

const requireFoundationPermanentDelete = async (req: WorkspaceRequest, res: Response, next: express.NextFunction) => {
  try {
    const governed = ['organizational-unit', 'job', 'position'].includes(req.params.entityType);
    if (!governed) return requireSystemAdmin(req, res, next);
    const decision = await authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: ['PERMANENTLY_DELETE_ORGANIZATIONAL_FOUNDATION'] });
    if (!decision.allowed) return res.status(403).json({ success: false, error: 'مجوز مستقل حذف دائمی ساختار سازمانی برای این عملیات الزامی است.' });
    return next();
  } catch (error) { return next(error); }
};

router.delete('/foundation/:entityType/:id/permanent', requireFoundationPermanentDelete, async (req: WorkspaceRequest, res) => {
  try {
    const config = foundationEntityConfig(req.params.entityType);
    const reason = textValue(req.body.reason);
    const model = (prisma as any)[config.model];
    const [target, actor] = await Promise.all([
      model.findUnique({ where: { id: req.params.id } }),
      prisma.user.findUnique({ where: { id: actorId(req) }, select: { password: true } }),
    ]);
    if (!target) return res.status(404).json({ success: false, error: 'رکورد سازمانی پیدا نشد.' });
    if (!actor || !(await bcrypt.compare(String(req.body.adminPassword || ''), actor.password))) return res.status(403).json({ success: false, error: 'رمز عبور کاربر مجاز صحیح نیست.' });
    if (!reason || textValue(req.body.entityId) !== target.id || textValue(req.body.confirmationCode) !== target.code) {
      throw new Error('دلیل، شناسه پایدار و کد دقیق رکورد برای حذف دائمی الزامی است.');
    }
    const governedEntity = ['ORGANIZATIONAL_UNIT', 'JOB', 'POSITION'].includes(config.entityType);
    const dependencies = await foundationDependencyPreview(config.entityType, req.params.id, prisma, new Date(), governedEntity);
    if (dependencies.live.length || (!governedEntity && dependencies.historicalReferenceCount > 0)) {
      return res.status(409).json({ success: false, error: 'ابتدا وابستگی‌های جاری این رکورد را تعیین تکلیف کنید.', dependencies });
    }
    const deleted = await prisma.$transaction(async (tx) => {
      const model = (tx as any)[config.model];
      const entity = await model.findUnique({ where: { id: req.params.id } });
      if (!entity) throw new Error('رکورد سازمانی پیدا نشد.');
      assertFreshVersion(entity.updatedAt, req.body.expectedUpdatedAt);
      if (entity.id !== target.id || entity.code !== target.code) throw new FoundationVersionConflictError();
      const transactionDependencies = await foundationDependencyPreview(config.entityType, entity.id, tx, new Date(), governedEntity);
      if (transactionDependencies.live.length || (!governedEntity && transactionDependencies.historicalReferenceCount > 0)) throw new FoundationVersionConflictError();
      if (!governedEntity) {
        await tx.hrFoundationReservedCode.create({ data: { entityType: config.entityType, code: entity.code, deletedEntityId: entity.id, deletedByUserId: actorId(req), reason } });
        await model.delete({ where: { id: entity.id } });
        return { id: entity.id, code: entity.code, permanentlyDeleted: true };
      }
      const entityType = config.entityType as 'ORGANIZATIONAL_UNIT' | 'JOB' | 'POSITION';
      const capturedAt = new Date();
      const [lifecycleHistoryRows, codeOccurrenceRows, evaluationEligibilityRows] = await Promise.all([
        tx.hrFoundationLifecycleVersion.findMany({ where: { entityType, entityId: entity.id }, orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] }),
        tx.hrFoundationCodeOccurrence.findMany({ where: { entityType, entityId: entity.id }, orderBy: { assignedAt: 'asc' } }),
        entityType === 'POSITION'
          ? tx.hrRecruitmentEvaluationPositionEligibility.findMany({ where: { positionId: entity.id }, orderBy: { createdAt: 'asc' } })
          : Promise.resolve([]),
      ]);
      const snapshotAt = (effectiveAt: Date) => {
        const projected = projectFoundationAtEvent(entity, lifecycleHistoryRows, effectiveAt);
        const occurrence = [...codeOccurrenceRows].reverse().find((row) => row.assignedAt <= effectiveAt && (!row.releasedAt || row.releasedAt > effectiveAt))
          || codeOccurrenceRows[0]
          || { code: entity.code, occurrence: entity.codeOccurrence };
        return {
          ...foundationReferenceSnapshot(entityType, { ...projected, code: occurrence.code, codeOccurrence: occurrence.occurrence }, capturedAt),
          effectiveAt: effectiveAt.toISOString(),
        };
      };
      const snapshot = {
        ...foundationReferenceSnapshot(entityType, entity, capturedAt),
        lifecycleHistory: lifecycleHistoryRows,
        codeHistory: codeOccurrenceRows,
        evaluationEligibilityHistory: evaluationEligibilityRows,
      };
      await tx.hrFoundationHistoricalSnapshot.create({ data: {
        entityType, entityId: entity.id, code: entity.code, codeOccurrence: entity.codeOccurrence,
        displayName: snapshot.name, snapshotJson: jsonValue(snapshot), capturedAt, capturedByUserId: actorId(req),
      } });
      if (entityType === 'POSITION') {
        const [assignments, applications, requests, capacityChanges] = await Promise.all([
          tx.hrEmploymentAssignment.findMany({ where: { positionId: entity.id }, select: { id: true, effectiveFrom: true } }),
          tx.hrJobApplication.findMany({ where: { positionId: entity.id }, select: { id: true, createdAt: true } }),
          tx.hrRecruitmentRequest.findMany({ where: { positionId: entity.id }, select: { id: true, effectiveFrom: true } }),
          tx.hrPositionCapacityChange.findMany({ where: { positionId: entity.id }, select: { id: true, effectiveAt: true } }),
        ]);
        for (const row of assignments) await tx.hrEmploymentAssignment.update({ where: { id: row.id }, data: { positionId: null, positionSnapshot: jsonValue(snapshotAt(row.effectiveFrom)) } });
        for (const row of applications) await tx.hrJobApplication.update({ where: { id: row.id }, data: { positionId: null, positionSnapshot: jsonValue(snapshotAt(row.createdAt)) } });
        for (const row of requests) await tx.hrRecruitmentRequest.update({ where: { id: row.id }, data: { positionId: null, positionSnapshot: jsonValue(snapshotAt(row.effectiveFrom)) } });
        for (const row of capacityChanges) await tx.hrPositionCapacityChange.update({ where: { id: row.id }, data: { positionId: null, positionSnapshot: jsonValue(snapshotAt(row.effectiveAt)) } });
        await tx.hrRecruitmentEvaluationPositionEligibility.deleteMany({ where: { positionId: entity.id } });
      } else if (entityType === 'ORGANIZATIONAL_UNIT') {
        const assignments = await tx.hrEmploymentAssignment.findMany({ where: { organizationalUnitId: entity.id }, select: { id: true, effectiveFrom: true } });
        for (const row of assignments) await tx.hrEmploymentAssignment.update({ where: { id: row.id }, data: { organizationalUnitId: null, organizationalUnitSnapshot: jsonValue(snapshotAt(row.effectiveFrom)) } });
      }
      await tx.hrFoundationLifecycleVersion.deleteMany({ where: { entityType, entityId: entity.id } });
      await releaseFoundationCodeOccurrence(tx, {
        entityType, entityId: entity.id, code: entity.code, occurrence: entity.codeOccurrence,
        actorUserId: actorId(req), reason, at: capturedAt,
      });
      await tx.hrFoundationDeletionReceipt.create({ data: {
        entityType, entityId: entity.id, code: entity.code, codeOccurrence: entity.codeOccurrence,
        deletedByUserId: actorId(req), deletedAt: capturedAt, reason,
        dependencyResolutionJson: jsonValue({ snapshotEligible: transactionDependencies.snapshotEligible }),
      } });
      await model.delete({ where: { id: entity.id } });
      return { id: entity.id, code: entity.code, codeOccurrence: entity.codeOccurrence, permanentlyDeleted: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ success: true, data: deleted });
  } catch (error) { handleError(res, error, 'Permanently delete HR foundation record'); }
});

const createFoundationRecord = async (
  req: WorkspaceRequest,
  config: { entityType: string; model: string },
  data: Record<string, unknown>,
  include?: Record<string, unknown>,
) => prisma.$transaction(async (tx) => {
  const code = String(data.code);
  const stableKey = textValue(req.body.idempotencyKey) || crypto.randomUUID();
  const replay = await tx.hrFoundationLifecycleVersion.findUnique({ where: { stableKey } });
  if (replay) {
    if (replay.entityType !== config.entityType) throw new Error('کلید تکرار به ایجاد دیگری تعلق دارد.');
    return (tx as any)[config.model].findUnique({ where: { id: replay.entityId }, ...(include ? { include } : {}) });
  }
  if (!['ORGANIZATIONAL_UNIT', 'JOB', 'POSITION'].includes(config.entityType)) {
    const reserved = await tx.hrFoundationReservedCode.findUnique({ where: { entityType_code: { entityType: config.entityType, code } } });
    if (reserved) throw new Error('این کد به‌صورت دائمی رزرو شده و قابل استفاده دوباره نیست.');
  }
  const status = textValue(req.body.status) || 'ACTIVE';
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new Error('وضعیت ایجاد معتبر نیست.');
  const effectiveFrom = req.body.effectiveFrom ? parseDate(req.body.effectiveFrom, 'تاریخ فعال‌سازی') : new Date();
  if (Date.UTC(effectiveFrom.getUTCFullYear(), effectiveFrom.getUTCMonth(), effectiveFrom.getUTCDate()) < Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) throw new Error('فعال‌سازی در گذشته مجاز نیست.');
  let record = await (tx as any)[config.model].create({
    data: { ...data, isActive: status === 'ACTIVE' && effectiveFrom <= new Date() },
    ...(include ? { include } : {}),
  });
  if (['ORGANIZATIONAL_UNIT', 'JOB', 'POSITION'].includes(config.entityType)) {
    const codeOccurrence = await allocateFoundationCodeOccurrence(tx, {
      entityType: config.entityType as 'ORGANIZATIONAL_UNIT' | 'JOB' | 'POSITION',
      entityId: record.id,
      code,
      actorUserId: actorId(req),
    });
    record = await (tx as any)[config.model].update({
      where: { id: record.id },
      data: { codeOccurrence },
      ...(include ? { include } : {}),
    });
  }
  await tx.hrFoundationLifecycleVersion.create({
    data: {
      stableKey, entityType: config.entityType, entityId: record.id, version: 1,
      status: status as 'ACTIVE' | 'INACTIVE', effectiveFrom,
      reason: textValue(req.body.lifecycleReason) || 'ایجاد رکورد سازمانی',
      beforeJson: Prisma.JsonNull, afterJson: jsonValue(record), changedByUserId: actorId(req),
    },
  });
  return record;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

const changeFoundationCode = async (
  tx: Prisma.TransactionClient,
  req: WorkspaceRequest,
  entityType: 'ORGANIZATIONAL_UNIT' | 'JOB' | 'POSITION',
  current: { id: string; code: string; codeOccurrence: number; isActive: boolean },
) => {
  const code = req.body.code === undefined ? current.code : textValue(req.body.code).toUpperCase();
  if (!code) throw new Error('کد الزامی است.');
  if (code === current.code) return { code: current.code, codeOccurrence: current.codeOccurrence };
  const reason = textValue(req.body.reason);
  if (!reason) throw new Error('دلیل تغییر کد الزامی است.');
  const at = new Date();
  const codeOccurrence = await allocateFoundationCodeOccurrence(tx, {
    entityType, entityId: current.id, code, actorUserId: actorId(req), at,
  });
  await releaseFoundationCodeOccurrence(tx, {
    entityType, entityId: current.id, code: current.code, occurrence: current.codeOccurrence,
    actorUserId: actorId(req), reason, at,
  });
  const previous = await tx.hrFoundationLifecycleVersion.findFirst({
    where: { entityType, entityId: current.id }, orderBy: { version: 'desc' }, select: { version: true },
  });
  await tx.hrFoundationLifecycleVersion.create({
    data: {
      stableKey: crypto.randomUUID(), entityType, entityId: current.id, version: (previous?.version ?? 0) + 1,
      status: current.isActive ? 'ACTIVE' : 'INACTIVE', effectiveFrom: at, reason,
      beforeJson: jsonValue({ code: current.code, codeOccurrence: current.codeOccurrence }),
      afterJson: jsonValue({ code, codeOccurrence }), changedByUserId: actorId(req),
    },
  });
  return { code, codeOccurrence };
};

const foundationDefinitionForHistory = (
  entityType: 'ORGANIZATIONAL_UNIT' | 'JOB' | 'POSITION',
  row: Record<string, any>,
) => {
  const common = {
    id: row.id,
    code: row.code,
    codeOccurrence: row.codeOccurrence,
    isActive: row.isActive,
  };
  if (entityType === 'ORGANIZATIONAL_UNIT') return { ...common, name: row.name, type: row.type, parentId: row.parentId };
  if (entityType === 'JOB') return { ...common, title: row.title, description: row.description, responsibilities: row.responsibilities };
  return {
    ...common,
    title: row.title,
    capacity: row.capacity,
    jobId: row.jobId,
    organizationalUnitId: row.organizationalUnitId,
    workplaceId: row.workplaceId,
    costCenterId: row.costCenterId,
    supervisorPositionId: row.supervisorPositionId,
  };
};

const recordFoundationDefinitionEdit = async (
  tx: Prisma.TransactionClient,
  req: WorkspaceRequest,
  entityType: 'ORGANIZATIONAL_UNIT' | 'JOB' | 'POSITION',
  before: Record<string, any>,
  after: Record<string, any>,
) => {
  const beforeJson = foundationDefinitionForHistory(entityType, before);
  const afterJson = foundationDefinitionForHistory(entityType, after);
  if (JSON.stringify(beforeJson) === JSON.stringify(afterJson)) return;
  const reason = textValue(req.body.reason);
  if (!reason) throw new Error('دلیل ویرایش تعریف سازمانی الزامی است.');
  const previous = await tx.hrFoundationLifecycleVersion.findFirst({
    where: { entityType, entityId: after.id }, orderBy: { version: 'desc' }, select: { version: true },
  });
  await tx.hrFoundationLifecycleVersion.create({ data: {
    stableKey: crypto.randomUUID(), entityType, entityId: after.id, version: (previous?.version ?? 0) + 1,
    status: after.isActive ? 'ACTIVE' : 'INACTIVE', effectiveFrom: new Date(), reason,
    beforeJson: jsonValue(beforeJson), afterJson: jsonValue(afterJson), changedByUserId: actorId(req),
  } });
};

router.post('/organizational-units', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const code = textValue(req.body.code).toUpperCase(); const name = textValue(req.body.name); const parentId = nullableText(req.body.parentId);
    if (!code || !name) throw new Error('کد و نام واحد سازمانی الزامی است.');
    if (!['COMPANY', 'DIVISION', 'DEPARTMENT', 'SECTION', 'TEAM'].includes(req.body.type)) throw new Error('نوع واحد سازمانی معتبر نیست.');
    const effectiveFrom = req.body.effectiveFrom ? parseDate(req.body.effectiveFrom, 'تاریخ فعال‌سازی') : new Date();
    if (parentId) await assertActiveReference(prisma, 'hrOrganizationalUnit', parentId, 'واحد والد', effectiveFrom);
    const record = await createFoundationRecord(req, foundationEntityModels['organizational-unit'], { code, name, type: req.body.type, parentId, createdBy: actorId(req) });
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Create HR unit'); }
});

router.put('/organizational-units/:id', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const parentId = nullableText(req.body.parentId);
    const record = await prisma.$transaction(async (tx) => {
      const current = await tx.hrOrganizationalUnit.findUnique({ where: { id: req.params.id } });
      if (!current) throw new Error('واحد سازمانی پیدا نشد.');
      assertFreshVersion(current.updatedAt, req.body.expectedUpdatedAt);
      const codeChange = await changeFoundationCode(tx, req, 'ORGANIZATIONAL_UNIT', current);
      const structuralChange = current.type !== req.body.type || current.parentId !== parentId;
      const references = structuralChange ? await Promise.all([
        tx.hrOrganizationalUnit.count({ where: { parentId: current.id } }),
        tx.hrPosition.count({ where: { organizationalUnitId: current.id } }),
        tx.hrEmploymentAssignment.count({ where: { organizationalUnitId: current.id } }),
      ]) : [0, 0, 0];
      const validationAt = structuralChange && references.some(Boolean)
        ? parseDate(req.body.effectiveFrom, 'تاریخ اثر تغییر ساختاری')
        : new Date();
      if (parentId) await assertActiveReference(tx, 'hrOrganizationalUnit', parentId, 'واحد والد', validationAt);
      await assertNoUnitCycle(tx, current.id, parentId, validationAt);
      if (structuralChange && references.some(Boolean)) {
        const effectiveFrom = validationAt;
        const reason = textValue(req.body.reason);
        if (!reason) throw new Error('دلیل تغییر ساختاری الزامی است.');
        if (effectiveFrom < new Date(new Date().toISOString().slice(0, 10))) throw new Error('تغییر ساختاری در گذشته مجاز نیست.');
        const previous = await tx.hrFoundationLifecycleVersion.findFirst({ where: { entityType: 'ORGANIZATIONAL_UNIT', entityId: current.id }, orderBy: { version: 'desc' } });
        await tx.hrFoundationLifecycleVersion.create({ data: { stableKey: textValue(req.body.idempotencyKey) || crypto.randomUUID(), entityType: 'ORGANIZATIONAL_UNIT', entityId: current.id, version: (previous?.version ?? 0) + 1, status: current.isActive ? 'ACTIVE' : 'INACTIVE', effectiveFrom, reason, beforeJson: jsonValue({ type: current.type, parentId: current.parentId }), afterJson: jsonValue({ type: req.body.type, parentId }), changedByUserId: actorId(req) } });
        if (effectiveFrom > new Date()) {
          const updated = await tx.hrOrganizationalUnit.update({ where: { id: current.id }, data: { name: textValue(req.body.name), ...codeChange } });
          await recordFoundationDefinitionEdit(tx, req, 'ORGANIZATIONAL_UNIT', current, updated);
          return updated;
        }
      }
      const updated = await tx.hrOrganizationalUnit.update({ where: { id: current.id }, data: { name: textValue(req.body.name), type: req.body.type, parentId, ...codeChange } });
      await recordFoundationDefinitionEdit(tx, req, 'ORGANIZATIONAL_UNIT', current, updated);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Update HR unit'); }
});

const simpleCatalogCreate = (model: 'hrWorkplace' | 'hrCostCenter') => async (req: WorkspaceRequest, res: Response) => {
  try {
    const code = textValue(req.body.code).toUpperCase(); const name = textValue(req.body.name);
    if (!code || !name) throw new Error('کد و نام الزامی است.');
    const config = model === 'hrWorkplace' ? foundationEntityModels.workplace : foundationEntityModels['cost-center'];
    const record = await createFoundationRecord(req, config, { code, name, description: nullableText(req.body.description), createdBy: actorId(req) });
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, `Create ${model}`); }
};
const simpleCatalogUpdate = (model: 'hrWorkplace' | 'hrCostCenter') => async (req: WorkspaceRequest, res: Response) => {
  try {
    const current = await (prisma[model] as any).findUnique({ where: { id: req.params.id } });
    if (!current) throw new Error('رکورد پیدا نشد.');
    assertFreshVersion(current.updatedAt, req.body.expectedUpdatedAt);
    const record = await (prisma[model] as any).update({ where: { id: req.params.id }, data: { name: textValue(req.body.name), description: nullableText(req.body.description) } });
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
    const record = await createFoundationRecord(req, foundationEntityModels.job, { code, title, description: nullableText(req.body.description), responsibilities: nullableText(req.body.responsibilities), createdBy: actorId(req) });
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Create HR job'); }
});
router.put('/jobs/:id', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const record = await prisma.$transaction(async (tx) => {
      const current = await tx.hrJob.findUnique({ where: { id: req.params.id } });
      if (!current) throw new Error('شغل پیدا نشد.');
      assertFreshVersion(current.updatedAt, req.body.expectedUpdatedAt);
      const codeChange = await changeFoundationCode(tx, req, 'JOB', current);
      const updated = await tx.hrJob.update({ where: { id: req.params.id }, data: { ...codeChange, title: textValue(req.body.title), description: nullableText(req.body.description), responsibilities: nullableText(req.body.responsibilities) } });
      await recordFoundationDefinitionEdit(tx, req, 'JOB', current, updated);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Update HR job'); }
});

router.post('/positions', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const code = textValue(req.body.code).toUpperCase(); const title = textValue(req.body.title); const capacity = Number(normalizeApplicantDigits(req.body.capacity));
    if (!code || !title || !Number.isInteger(capacity) || capacity < 1) throw new Error('کد، عنوان و ظرفیت مثبت جایگاه الزامی است.');
    const jobId = textValue(req.body.jobId); const organizationalUnitId = textValue(req.body.organizationalUnitId);
    const effectiveFrom = req.body.effectiveFrom ? parseDate(req.body.effectiveFrom, 'تاریخ فعال‌سازی') : new Date();
    await Promise.all([assertActiveReference(prisma, 'hrJob', jobId, 'شغل', effectiveFrom), assertActiveReference(prisma, 'hrOrganizationalUnit', organizationalUnitId, 'واحد سازمانی', effectiveFrom), assertActiveReference(prisma, 'hrWorkplace', nullableText(req.body.workplaceId), 'محل کار', effectiveFrom), assertActiveReference(prisma, 'hrCostCenter', nullableText(req.body.costCenterId), 'مرکز هزینه', effectiveFrom)]);
    const supervisorPositionId = nullableText(req.body.supervisorPositionId);
    if (supervisorPositionId) {
      const supervisor = await prisma.hrPosition.findUnique({ where: { id: supervisorPositionId }, select: { isActive: true } });
      const supervisorLifecycle = supervisor ? await prisma.hrFoundationLifecycleVersion.findMany({ where: { entityType: 'POSITION', entityId: supervisorPositionId }, select: { status: true, effectiveFrom: true, version: true, afterJson: true } }) : [];
      if (!supervisor || !resolveFoundationStatus({ baseActive: supervisor.isActive, at: effectiveFrom, versions: supervisorLifecycle })) throw new Error('جایگاه سرپرست معتبر نیست.');
    }
    const record = await createFoundationRecord(req, foundationEntityModels.position, { code, title, capacity, jobId, organizationalUnitId, workplaceId: nullableText(req.body.workplaceId), costCenterId: nullableText(req.body.costCenterId), supervisorPositionId, createdBy: actorId(req) }, positionInclude);
    res.status(201).json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Create HR position'); }
});
router.put('/positions/:id', editAccess, async (req: WorkspaceRequest, res) => {
  try {
    const record = await prisma.$transaction(async (tx) => {
      const current = await tx.hrPosition.findUnique({ where: { id: req.params.id }, include: { capacityChanges: true } });
      if (!current) throw new Error('جایگاه پیدا نشد.');
      assertFreshVersion(current.updatedAt, req.body.expectedUpdatedAt);
      const codeChange = await changeFoundationCode(tx, req, 'POSITION', current);
      if (req.body.capacity != null && Number(normalizeApplicantDigits(req.body.capacity)) !== capacityAt(current.capacity, current.capacityChanges, new Date())) throw new Error('تغییر ظرفیت فقط از مسیر تغییر ظرفیت مؤثر-تاریخ‌دار مجاز است.');
      const jobId = textValue(req.body.jobId) || current.jobId;
      const organizationalUnitId = textValue(req.body.organizationalUnitId) || current.organizationalUnitId;
      const workplaceId = req.body.workplaceId === undefined ? current.workplaceId : nullableText(req.body.workplaceId);
      const costCenterId = req.body.costCenterId === undefined ? current.costCenterId : nullableText(req.body.costCenterId);
      const supervisorPositionId = req.body.supervisorPositionId === undefined ? current.supervisorPositionId : nullableText(req.body.supervisorPositionId);
      const structuralChange = current.jobId !== jobId || current.organizationalUnitId !== organizationalUnitId || current.workplaceId !== workplaceId || current.costCenterId !== costCenterId || current.supervisorPositionId !== supervisorPositionId;
      const referenceCount = structuralChange ? await Promise.all([
        tx.hrEmploymentAssignment.count({ where: { positionId: current.id } }),
        tx.hrJobApplication.count({ where: { positionId: current.id } }),
        tx.hrRecruitmentRequest.count({ where: { positionId: current.id } }),
      ]).then((counts) => counts.reduce((sum, count) => sum + count, 0)) : 0;
      const validationAt = structuralChange && referenceCount > 0
        ? parseDate(req.body.effectiveFrom, 'تاریخ اثر تغییر ساختاری')
        : new Date();
      await Promise.all([
        assertActiveReference(tx, 'hrJob', jobId, 'شغل', validationAt),
        assertActiveReference(tx, 'hrOrganizationalUnit', organizationalUnitId, 'واحد سازمانی', validationAt),
        assertActiveReference(tx, 'hrWorkplace', workplaceId, 'محل کار', validationAt),
        assertActiveReference(tx, 'hrCostCenter', costCenterId, 'مرکز هزینه', validationAt),
      ]);
      await assertNoPositionCycle(tx, current.id, supervisorPositionId, validationAt);
      const structuralData = { jobId, organizationalUnitId, workplaceId, costCenterId, supervisorPositionId };
      if (structuralChange && referenceCount > 0) {
        const effectiveFrom = validationAt;
        const reason = textValue(req.body.reason);
        if (!reason) throw new Error('دلیل تغییر ساختاری الزامی است.');
        if (effectiveFrom < new Date(new Date().toISOString().slice(0, 10))) throw new Error('تغییر ساختاری در گذشته مجاز نیست.');
        const previous = await tx.hrFoundationLifecycleVersion.findFirst({ where: { entityType: 'POSITION', entityId: current.id }, orderBy: { version: 'desc' } });
        await tx.hrFoundationLifecycleVersion.create({ data: { stableKey: textValue(req.body.idempotencyKey) || crypto.randomUUID(), entityType: 'POSITION', entityId: current.id, version: (previous?.version ?? 0) + 1, status: current.isActive ? 'ACTIVE' : 'INACTIVE', effectiveFrom, reason, beforeJson: jsonValue({ jobId: current.jobId, organizationalUnitId: current.organizationalUnitId, workplaceId: current.workplaceId, costCenterId: current.costCenterId, supervisorPositionId: current.supervisorPositionId }), afterJson: jsonValue(structuralData), changedByUserId: actorId(req) } });
        if (effectiveFrom > new Date()) {
          const updated = await tx.hrPosition.update({ where: { id: current.id }, data: { title: textValue(req.body.title) || current.title, ...codeChange }, include: positionInclude });
          await recordFoundationDefinitionEdit(tx, req, 'POSITION', current, updated);
          return updated;
        }
      }
      const updated = await tx.hrPosition.update({ where: { id: current.id }, data: { title: textValue(req.body.title) || current.title, ...structuralData, ...codeChange }, include: positionInclude });
      await recordFoundationDefinitionEdit(tx, req, 'POSITION', current, updated);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Update HR position'); }
});

router.get('/personnel', viewAccess, async (req: WorkspaceRequest, res) => {
  try {
    const search = textValue(req.query.search);
    const focusId = nullableText(req.query.focus);
    const archived = textValue(req.query.archived) === 'true';
    const relationshipStatus = textValue(req.query.relationshipStatus);
    const organizationalUnitId = textValue(req.query.organizationalUnitId);
    const workplaceId = textValue(req.query.workplaceId);
    const costCenterId = textValue(req.query.costCenterId);
    const dependencyAt = req.query.dependencyAt ? parseDate(req.query.dependencyAt, 'تاریخ وابستگی') : new Date();
    const attention = textValue(req.query.attention);
    const page = Math.max(1, Number(req.query.page || 1));
    const filterNow = new Date();
    const relationshipFilter: Prisma.HrEmploymentRelationshipWhereInput = {
      status: relationshipStatus && ['PLANNED', 'ACTIVE', 'SUSPENDED', 'ENDED', 'CANCELLED'].includes(relationshipStatus)
        ? relationshipStatus as any
        : { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] },
      ...(relationshipStatus === 'ACTIVE' ? {
        effectiveFrom: { lte: filterNow },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: filterNow } }]
      } : {}),
      ...(attention === 'missing-primary'
        ? { assignments: { none: { type: 'PRIMARY', effectiveTo: null } } }
        : {}),
      ...((organizationalUnitId || workplaceId || costCenterId) ? { assignments: { some: {
        ...(organizationalUnitId ? { organizationalUnitId } : {}),
        ...(workplaceId ? { workplaceId } : {}),
        ...(costCenterId ? { costCenterId } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: dependencyAt } }],
      } } } : {}),
    };
    const where: Prisma.PersonnelWhereInput = {
      archivedAt: archived ? { not: null } : null,
      ...((relationshipStatus || attention === 'missing-primary' || organizationalUnitId || workplaceId || costCenterId) ? { hrEmploymentRelationships: { some: relationshipFilter } } : {})
    };
    // Authorization and structural filters are applied by middleware/where first. Search,
    // Persian collation, focus canonicalization, and pagination then operate on that complete set.
    const [authorizedRows, actionPermissionCodes] = await Promise.all([
      prisma.personnel.findMany({
        where,
        select: { id: true, firstName: true, lastName: true, nationalCode: true, employeeNumber: true }
      }),
      activeHrActionPermissionsForUser(prisma, actorId(req)),
    ]);
    const collection = buildPersonnelCollection(authorizedRows, { search, page, focusId });
    const pageIds = collection.rows.map((person) => person.id);
    const unorderedRows = pageIds.length
      ? await prisma.personnel.findMany({ where: { id: { in: pageIds } }, include: personnelListInclude })
      : [];
    const pageOrder = new Map(pageIds.map((id, index) => [id, index]));
    const rows = unorderedRows.sort((left, right) => pageOrder.get(left.id)! - pageOrder.get(right.id)!);
    const archivedActorIds = [...new Set(rows.map((person) => person.archivedBy).filter(Boolean) as string[])];
    const archivedActors = archivedActorIds.length
      ? await prisma.user.findMany({ where: { id: { in: archivedActorIds } }, select: { id: true, firstName: true, lastName: true, username: true } })
      : [];
    const archivedActorNames = new Map(archivedActors.map((actor) => [actor.id, `${actor.firstName} ${actor.lastName}`.trim() || actor.username]));
    const authorities = actionPermissionCodes.includes('ARCHIVE_RECRUITMENT_CASE') ? ['HR_MANAGER'] : [];
    const data = rows.map((person) => ({
      ...person,
      archivedByDisplayName: person.archivedBy ? archivedActorNames.get(person.archivedBy) || person.archivedBy : null,
      retentionCapabilities: projectRecordRetentionCapabilities({ role: req.user!.role, authorities, archived: Boolean(person.archivedAt) }),
    }));
    res.json({ success: true, data, meta: collection.meta });
  } catch (error) { handleError(res, error, 'List HR personnel'); }
});

router.get('/personnel-origin', viewAccess, async (req: WorkspaceRequest, res) => {
  try {
    const origin = textValue(req.query.origin);
    const feature = personnelOriginFeature(origin);
    if (!feature) return res.json({ success: true, data: { origin: '/dashboard/hr' } });
    const authorization = await authorizeHrUser(prisma, actorId(req), { feature: { code: feature, level: 'VIEW' } });
    res.json({ success: true, data: { origin: authorization.allowed ? origin : '/dashboard/hr' } });
  } catch (error) { handleError(res, error, 'Resolve Personnel logical origin'); }
});

router.post('/personnel/:id/archive', viewAccess, requireHrManagerAuthority, async (req: WorkspaceRequest, res) => {
  try {
    const reason = assertArchiveReason(req.body.reason);
    const effectiveDate = parseDate(req.body.effectiveDate, 'تاریخ اجرای بایگانی');
    if (!plannedStartHasArrived(effectiveDate)) throw new Error('تاریخ اجرای بایگانی نمی‌تواند در آینده باشد.');
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const person = await tx.personnel.findUniqueOrThrow({ where: { id: req.params.id }, include: { user: true, hiringCandidate: { include: { applications: { select: { id: true } } } } } });
      if (person.archivedAt) throw new Error('پرسنل قبلاً بایگانی شده است.');
      if (req.user!.role !== 'ADMIN' && person.user?.role === 'ADMIN') throw new Error('مدیر منابع انسانی نمی‌تواند حساب مدیر سامانه را غیرفعال کند.');
      const applicationIds = person.hiringCandidate?.applications.map((application) => application.id) || [];
      const relationships = await tx.hrEmploymentRelationship.findMany({ where: { personnelId: person.id, status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } }, select: { id: true, effectiveFrom: true } });
      const relationshipIds = relationships.map((relationship) => relationship.id);
      if (relationshipIds.length) {
        const assignments = await tx.hrEmploymentAssignment.findMany({ where: { employmentRelationshipId: { in: relationshipIds }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveDate } }] }, select: { id: true, effectiveFrom: true } });
        for (const assignment of assignments) await tx.hrEmploymentAssignment.update({ where: { id: assignment.id }, data: { effectiveTo: assignment.effectiveFrom > effectiveDate ? assignment.effectiveFrom : effectiveDate } });
        for (const relationship of relationships) await tx.hrEmploymentRelationship.update({ where: { id: relationship.id }, data: { status: 'ENDED', effectiveTo: relationship.effectiveFrom > effectiveDate ? relationship.effectiveFrom : effectiveDate, endReason: reason } });
      }
      if (applicationIds.length) {
        const payrollParticipations = await tx.hrPayrollParticipation.findMany({ where: { applicationId: { in: applicationIds }, effectiveTo: null }, select: { id: true, effectiveFrom: true } });
        for (const participation of payrollParticipations) await tx.hrPayrollParticipation.update({ where: { id: participation.id }, data: { effectiveTo: participation.effectiveFrom > effectiveDate ? participation.effectiveFrom : effectiveDate, endedBy: actorId(req), endReason: reason } });
        await tx.hrOnboardingTask.updateMany({ where: { applicationId: { in: applicationIds }, status: { in: ['PENDING', 'IN_PROGRESS'] } }, data: { status: 'WAIVED', evidenceNote: `بایگانی پرسنل: ${reason}`, completedBy: actorId(req), completedAt: now } });
      }
      await tx.hrWorkScheduleChange.updateMany({
        where: { personnelId: person.id, status: { in: ['PROPOSED', 'DRAFT', 'SUBMITTED', 'RETURNED'] } },
        data: { status: 'CANCELLED', returnedBy: actorId(req), returnedAt: now, returnReason: `بایگانی پرسنل: ${reason}` }
      });
      const rosterMemberships = await tx.securityAttendanceRosterMembership.findMany({
        where: { personnelId: person.id },
        select: { id: true, effectiveFrom: true, effectiveTo: true }
      });
      let endedRosterMembershipCount = 0;
      for (const membership of rosterMemberships) {
        const effectiveTo = archiveRosterMembershipEnd(membership.effectiveFrom, membership.effectiveTo, effectiveDate);
        if (!effectiveTo) continue;
        await tx.securityAttendanceRosterMembership.update({
          where: { id: membership.id },
          data: { effectiveTo, endedBy: actorId(req) }
        });
        endedRosterMembershipCount += 1;
      }
      if (person.user) {
        await tx.authSession.updateMany({ where: { userId: person.user.id, revokedAt: null }, data: { revokedAt: now, revokedById: actorId(req), revocationReason: `بایگانی پرسنل: ${reason}` } });
        await tx.user.update({ where: { id: person.user.id }, data: { isActive: false } });
      }
      await tx.hrPersonnelAudit.create({ data: { personnelId: person.id, actorUserId: actorId(req), eventType: 'PERSONNEL_ARCHIVED', sourceCategory: 'PERSONNEL_ARCHIVE', reason, payloadJson: { effectiveDate: effectiveDate.toISOString(), linkedUserDeactivated: Boolean(person.user), endedRelationshipCount: relationshipIds.length, endedRosterMembershipCount } } });
      return tx.personnel.update({ where: { id: person.id }, data: { isActive: false, archivedAt: now, archivedBy: actorId(req), archiveReason: reason, archiveEffectiveDate: effectiveDate } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ success: true, data: result });
  } catch (error) { handleError(res, error, 'Archive HR personnel'); }
});

router.post('/personnel/:id/restore', viewAccess, requireHrManagerAuthority, async (req: WorkspaceRequest, res) => {
  try {
    const reason = assertArchiveReason(req.body.reason);
    const result = await prisma.$transaction(async (tx) => {
      const person = await tx.personnel.findUniqueOrThrow({ where: { id: req.params.id } });
      if (!person.archivedAt) throw new Error('پرسنل در بایگانی نیست.');
      await tx.hrPersonnelAudit.create({ data: { personnelId: person.id, actorUserId: actorId(req), eventType: 'PERSONNEL_RESTORED', sourceCategory: 'PERSONNEL_ARCHIVE', reason, payloadJson: { restoredAt: new Date().toISOString(), employmentReactivated: false, userReactivated: false, payrollReactivated: false } } });
      return tx.personnel.update({ where: { id: person.id }, data: { archivedAt: null, archivedBy: null, archiveReason: null, archiveEffectiveDate: null } });
    });
    res.json({ success: true, data: result });
  } catch (error) { handleError(res, error, 'Restore HR personnel'); }
});

const assertCurrentPersonnelErasureAdminProtection = async (client: PrismaClient | Prisma.TransactionClient, userIds: string[], actorUserId: string) => {
  const [users, activeAdminCount] = await Promise.all([
    userIds.length ? (client as any).user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true, isActive: true } }) : [],
    (client as any).user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } })
  ]);
  if (userIds.includes(actorUserId)) assertPersonnelErasureTarget({ actorUserId, targetUserId: actorUserId, targetIsActiveAdmin: true, activeAdminCount });
  const activeAdminTargets = users.filter((user: any) => user.role === 'ADMIN' && user.isActive).length;
  if (activeAdminTargets > 0 && activeAdminCount - activeAdminTargets < 1) {
    assertPersonnelErasureTarget({ actorUserId, targetUserId: users.find((user: any) => user.role === 'ADMIN' && user.isActive)?.id, targetIsActiveAdmin: true, activeAdminCount: 1 });
  }
};

const personnelErasureImpact = async (personnelId: string, actorUserId: string) => {
  const person = await prisma.personnel.findUnique({ where: { id: personnelId }, include: { user: { select: { id: true, role: true, isActive: true } } } });
  if (!person) return null;
  const plan = await buildPersonnelErasurePlan(prisma, personnelId);
  const userIds = plan.nodes.User || [];
  await assertCurrentPersonnelErasureAdminProtection(prisma, userIds, actorUserId);
  const fileCounts = Object.fromEntries(Object.entries(plan.files.reduce<Record<string, number>>((counts, file) => ({ ...counts, [file.category]: (counts[file.category] || 0) + 1 }), {})).sort(([left], [right]) => left.localeCompare(right)));
  return {
    person,
    plan,
    data: {
      targetId: person.id,
      displayName: `${person.firstName} ${person.lastName}`.trim(),
      linkedUserIds: userIds,
      counts: plan.counts,
      fileCounts,
      totalRecords: Object.values(plan.counts).reduce((sum, count) => sum + count, 0),
      totalFiles: plan.files.length,
      fingerprint: plan.fingerprint,
      backupNotice: 'نسخه‌های پشتیبان تغییر داده نمی‌شوند و داده طبق دوره نگهداری عادی منقضی می‌شود.'
    }
  };
};

router.get('/personnel/:id/deletion-preview', viewAccess, requireSystemAdmin, async (req: WorkspaceRequest, res) => {
  try {
    const impact = await personnelErasureImpact(req.params.id, actorId(req));
    if (!impact) return res.status(404).json({ success: false, error: 'پرسنل پیدا نشد.' });
    res.json({ success: true, data: impact.data });
  } catch (error) { handleError(res, error, 'Preview permanent Personnel erasure'); }
});

router.post('/personnel/:id/permanent-delete', viewAccess, requireSystemAdmin, async (req: WorkspaceRequest, res) => {
  try {
    const [impact, actor] = await Promise.all([
      personnelErasureImpact(req.params.id, actorId(req)),
      prisma.user.findUnique({ where: { id: actorId(req) }, select: { password: true } })
    ]);
    if (!impact) return res.status(404).json({ success: false, error: 'پرسنل پیدا نشد.' });
    if (!actor || !(await bcrypt.compare(String(req.body.adminPassword || ''), actor.password))) return res.status(403).json({ success: false, error: 'رمز عبور مدیر سامانه صحیح نیست.' });
    assertPermanentDeletionConfirmation({ expectedFingerprint: impact.plan.fingerprint, suppliedFingerprint: req.body.fingerprint, expectedFullName: impact.data.displayName, suppliedFullName: req.body.fullName, reason: req.body.reason, confirmed: req.body.confirmed });
    const receiptId = crypto.randomUUID();
    const operationToken = crypto.randomUUID();
    const leaseExpiry = () => new Date(Date.now() + PERSONNEL_ERASURE_LEASE_MS);
    const staged: StagedHiringFile[] = [];
    const deletionReason = assertArchiveReason(req.body.reason);
    let preparedPlan = impact.plan;
    let accessPrepared = false;
    let operationRecorded = false;
    let leaseOwned = true;
    let revokedSessionIds: string[] = [];
    let previousUserStates: Array<{ id: string; isActive: boolean }> = [];
    try {
      const groups = new Map<string, string[]>();
      for (const file of impact.plan.files) groups.set(file.storageRoot, [...(groups.get(file.storageRoot) || []), file.storageName]);
      let index = 0;
      const planned = [...groups.entries()].flatMap(([storageRoot, names]) => planHiringFilesForDeletion(names, `${receiptId}-${index++}`, storageRoot));
      await prisma.$transaction(async (tx) => {
        await tx.hrDeletionReceipt.create({ data: {
          id: receiptId, targetType: 'PERSONNEL', targetId: req.params.id, actorUserId: actorId(req), reason: deletionReason,
          previewFingerprint: impact.plan.fingerprint, status: 'PREPARING', recordCounts: impact.plan.counts,
          fileCounts: impact.data.fileCounts, operationToken, leaseExpiresAt: leaseExpiry()
        } });
        if (planned.length) await tx.hrDeletionFileCleanup.createMany({ data: planned.map((item) => ({ receiptId, storageName: item.storageName, originalPath: item.originalPath, stagedPath: item.stagedPath, status: 'PREPARING' })) });
      });
      operationRecorded = true;
      for (const item of planned) {
        const renewed = await prisma.hrDeletionReceipt.updateMany({
          where: { id: receiptId, status: 'PREPARING', operationToken },
          data: { leaseExpiresAt: leaseExpiry() }
        });
        if (renewed.count !== 1) { leaseOwned = false; throw new Error('مالکیت عملیات حذف منقضی شده است؛ بازیابی خودکار وضعیت را بررسی کنید.'); }
        staged.push(...stagePlannedHiringFiles([item]));
      }
      await prisma.$transaction(async (tx) => {
        const renewed = await tx.hrDeletionReceipt.updateMany({
          where: { id: receiptId, status: 'PREPARING', operationToken },
          data: { leaseExpiresAt: leaseExpiry() }
        });
        if (renewed.count !== 1) { leaseOwned = false; throw new Error('مالکیت عملیات حذف منقضی شده است؛ بازیابی خودکار وضعیت را بررسی کنید.'); }
        const currentPlan = await buildPersonnelErasurePlan(tx, req.params.id);
        if (currentPlan.fingerprint !== impact.plan.fingerprint) throw new Error('پیش‌نمایش حذف منقضی شده است؛ دوباره بررسی کنید.');
        const targetUserIds = currentPlan.nodes.User || [];
        await assertCurrentPersonnelErasureAdminProtection(tx, targetUserIds, actorId(req));
        if (targetUserIds.length) {
          previousUserStates = await tx.user.findMany({ where: { id: { in: targetUserIds } }, select: { id: true, isActive: true } });
          revokedSessionIds = (await tx.authSession.findMany({ where: { userId: { in: targetUserIds }, revokedAt: null }, select: { id: true } })).map((session) => session.id);
          if (revokedSessionIds.length) await tx.authSession.updateMany({ where: { id: { in: revokedSessionIds } }, data: { revokedAt: new Date(), revokedById: actorId(req), revocationReason: 'PERMANENT_PERSONNEL_ERASURE' } });
          await tx.user.updateMany({ where: { id: { in: targetUserIds } }, data: { isActive: false } });
        }
        preparedPlan = await buildPersonnelErasurePlan(tx, req.params.id);
        const prepared = await tx.hrDeletionReceipt.updateMany({
          where: { id: receiptId, status: 'PREPARING', operationToken },
          data: {
            status: 'ACCESS_PREPARED',
            leaseExpiresAt: leaseExpiry(),
            recordCounts: { counts: impact.plan.counts, accessRecovery: { users: previousUserStates, sessionIds: revokedSessionIds } }
          }
        });
        if (prepared.count !== 1) { leaseOwned = false; throw new Error('مالکیت عملیات حذف منقضی شده است؛ بازیابی خودکار وضعیت را بررسی کنید.'); }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
      accessPrepared = true;
      await prisma.$transaction(async (tx) => {
        const renewed = await tx.hrDeletionReceipt.updateMany({
          where: { id: receiptId, status: 'ACCESS_PREPARED', operationToken },
          data: { leaseExpiresAt: leaseExpiry() }
        });
        if (renewed.count !== 1) { leaseOwned = false; throw new Error('مالکیت عملیات حذف منقضی شده است؛ بازیابی خودکار وضعیت را بررسی کنید.'); }
        const currentPlan = await buildPersonnelErasurePlan(tx, req.params.id);
        if (currentPlan.fingerprint !== preparedPlan.fingerprint) throw new Error('دامنه حذف پس از لغو دسترسی تغییر کرده است؛ پیش‌نمایش تازه دریافت کنید.');
        const targetUserIds = currentPlan.nodes.User || [];
        await assertCurrentPersonnelErasureAdminProtection(tx, targetUserIds, actorId(req));
        await executePersonnelErasureGraph(tx, currentPlan);
        await tx.hrDeletionReceipt.update({ where: { id: receiptId }, data: {
          status: 'FILE_CLEANUP_PENDING', operationToken: null, leaseExpiresAt: null,
          recordCounts: currentPlan.counts, fileCounts: impact.data.fileCounts, deletedAt: new Date()
        } });
        await tx.hrDeletionFileCleanup.updateMany({ where: { receiptId }, data: { status: 'PENDING' } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
    } catch (error) {
      if (!leaseOwned) throw error;
      let recoveryError: unknown = null;
      try {
        restoreStagedHiringFiles(staged);
      } catch (restoreError) {
        recoveryError = restoreError;
      } finally {
        if (accessPrepared) {
          try {
            await prisma.$transaction(async (tx) => {
              if (revokedSessionIds.length) await tx.authSession.updateMany({
                where: { id: { in: revokedSessionIds }, revocationReason: 'PERMANENT_PERSONNEL_ERASURE', revokedById: actorId(req) },
                data: { revokedAt: null, revokedById: null, revocationReason: null }
              });
              for (const user of previousUserStates) await tx.user.update({ where: { id: user.id }, data: { isActive: user.isActive } });
            });
          } catch (accessRecoveryError) {
            recoveryError = accessRecoveryError;
          }
        }
        if (!recoveryError && operationRecorded) {
          try {
            await prisma.$transaction([
              prisma.hrDeletionFileCleanup.deleteMany({ where: { receiptId } }),
              prisma.hrDeletionReceipt.update({ where: { id: receiptId }, data: {
                status: 'ABORTED', operationToken: null, leaseExpiresAt: null,
                recordCounts: { aborted: true }, fileCounts: { restored: staged.length }
              } })
            ]);
          } catch (receiptRecoveryError) {
            recoveryError = receiptRecoveryError;
          }
        }
      }
      if (recoveryError) {
        const recoveryFailure = new Error('حذف انجام نشد و بازگردانی کامل وضعیت آماده‌سازی نیز ناموفق بود؛ بررسی فوری مدیر سامانه لازم است.') as Error & { cause?: unknown };
        recoveryFailure.cause = recoveryError;
        throw recoveryFailure;
      }
      throw error;
    }
    const failures: string[] = [];
    for (const item of staged) {
      const failed = commitStagedHiringFiles([item]);
      if (failed.length) {
        failures.push(item.storageName);
        await prisma.hrDeletionFileCleanup.updateMany({ where: { receiptId, stagedPath: item.stagedPath }, data: { status: 'FAILED', lastError: 'FILE_UNLINK_FAILED' } });
      } else await prisma.hrDeletionFileCleanup.deleteMany({ where: { receiptId, stagedPath: item.stagedPath } });
    }
    const receipt = await prisma.hrDeletionReceipt.update({ where: { id: receiptId }, data: { status: failures.length ? 'FILE_CLEANUP_PENDING' : 'COMPLETED', fileCounts: { ...impact.data.fileCounts, staged: staged.length, failed: failures.length } } });
    res.status(failures.length ? 202 : 200).json({ success: !failures.length, data: { receiptId, status: receipt.status }, error: failures.length ? 'حذف پایگاه داده انجام شد اما پاک‌سازی برخی فایل‌ها نیازمند تلاش مجدد است.' : undefined });
  } catch (error) { handleError(res, error, 'Execute permanent Personnel erasure'); }
});

router.use('/personnel/:id', async (req: WorkspaceRequest, res, next) => {
  if (req.method === 'GET' || /\/(archive|restore|deletion-preview|permanent-delete)$/.test(req.path)) return next();
  try {
    const person = await prisma.personnel.findUnique({ where: { id: req.params.id }, select: { archivedAt: true } });
    assertArchivedRecordMutable(person?.archivedAt);
    next();
  } catch (error) {
    res.status(409).json({ success: false, error: error instanceof Error ? error.message : 'پرسنل بایگانی‌شده قابل تغییر نیست.' });
  }
});

router.use('/relationships/:id', async (req: WorkspaceRequest, res, next) => {
  if (req.method === 'GET') return next();
  try {
    const relationship = await prisma.hrEmploymentRelationship.findUnique({ where: { id: req.params.id }, select: { personnel: { select: { archivedAt: true } } } });
    assertArchivedRecordMutable(relationship?.personnel.archivedAt);
    next();
  } catch (error) { handleError(res, error, 'Reject archived Personnel relationship mutation'); }
});

router.use('/assignments/:id', async (req: WorkspaceRequest, res, next) => {
  if (req.method === 'GET') return next();
  try {
    const assignment = await prisma.hrEmploymentAssignment.findUnique({ where: { id: req.params.id }, select: { employmentRelationship: { select: { personnel: { select: { archivedAt: true } } } } } });
    assertArchivedRecordMutable(assignment?.employmentRelationship.personnel.archivedAt);
    next();
  } catch (error) { handleError(res, error, 'Reject archived Personnel assignment mutation'); }
});

router.get('/personnel/:id/work-schedule', viewAccess, async (req: WorkspaceRequest, res) => {
  try {
    const [person, actionPermissionCodes] = await Promise.all([
      prisma.personnel.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          archivedAt: true,
          workSchedules: {
            include: { days: { orderBy: { weekday: 'asc' } } },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
        },
      }),
      activeHrActionPermissionsForUser(prisma, actorId(req)),
    ]);
    if (!person) return res.status(404).json({ success: false, error: 'پرسنل پیدا نشد.' });
    const canManageSchedule = actionPermissionCodes.includes('MANAGE_PERSONNEL_SCHEDULE');
    res.json({
      success: true,
      data: {
        personnelId: person.id,
        archived: Boolean(person.archivedAt),
        workSchedules: person.workSchedules,
        workScheduleCapabilities: { canEdit: canManageSchedule && !person.archivedAt },
      },
    });
  } catch (error) { handleError(res, error, 'Get personnel work schedule'); }
});

router.post('/personnel/exceptional', editAccess, requireHrManagerAuthority, requireUserAdministrationForPersonnelLink, async (req: WorkspaceRequest, res) => {
  try {
    const firstName = textValue(req.body.firstName); const lastName = textValue(req.body.lastName);
    if (!firstName || !lastName) throw new Error('نام و نام خانوادگی الزامی است.');
    const sourceCategory = textValue(req.body.sourceCategory);
    const reason = textValue(req.body.reason);
    if (!EXCEPTIONAL_PERSONNEL_SOURCES.has(sourceCategory)) throw new Error('دسته منبع ثبت استثنایی معتبر نیست.');
    if (reason.length < 10) throw new Error('دلیل ثبت استثنایی باید روشن و حداقل ۱۰ نویسه باشد.');
    const nationalCode = nullableText(normalizeApplicantDigits(req.body.nationalCode));
    if (nationalCode && !isValidIranianNationalCode(nationalCode)) throw new Error('کد ملی معتبر نیست.');
    const duplicate = await prisma.personnel.findFirst({ where: { firstName: { equals: firstName, mode: 'insensitive' }, lastName: { equals: lastName, mode: 'insensitive' } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true } });
    if (duplicate && !req.body.confirmDuplicate) return res.status(409).json({ success: false, code: 'DUPLICATE_PERSONNEL_CONFIRMATION_REQUIRED', error: 'فردی با نام مشابه وجود دارد؛ پرونده موجود را بررسی کنید و فقط در صورت تفاوت واقعی ثبت را تأیید کنید.', duplicate });
    const effectiveFrom = parseDate(req.body.effectiveFrom, 'تاریخ شروع');
    const status = req.body.status === 'PLANNED' ? 'PLANNED' : 'ACTIVE';
    if (status === 'ACTIVE' && effectiveFrom > new Date()) throw new Error('استخدام با تاریخ شروع آینده باید برنامه‌ریزی‌شده باشد.');
    const positionId = textValue(req.body.positionId); if (!positionId) throw new Error('تخصیص اصلی اولیه الزامی است.');
    const result = await prisma.$transaction(async (tx) => {
      const personnel = await tx.personnel.create({ data: { firstName, lastName, nationalCode, employeeNumber: nullableText(normalizeApplicantDigits(req.body.employeeNumber)), isActive: status === 'ACTIVE' } });
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
    const nationalCode = nullableText(normalizeApplicantDigits(req.body.nationalCode)); if (nationalCode && !isValidIranianNationalCode(nationalCode)) throw new Error('کد ملی معتبر نیست.');
    const record = await prisma.personnel.update({ where: { id: req.params.id }, data: { firstName: textValue(req.body.firstName), lastName: textValue(req.body.lastName), nationalCode, employeeNumber: nullableText(normalizeApplicantDigits(req.body.employeeNumber)) }, include: personnelInclude });
    res.json({ success: true, data: record });
  } catch (error) { handleError(res, error, 'Update HR personnel'); }
});

router.put('/personnel/:id/work-schedule', editAccess, requireHrActionPermission('MANAGE_PERSONNEL_SCHEDULE'), async (req: WorkspaceRequest, res) => {
  try {
    const normalized = normalizeWorkSchedule(req.body);
    if (!normalized) throw new Error('برنامه کاری کامل الزامی است.');
    const row = await prisma.$transaction(async (tx) => {
      const schedule = await savePersonnelWorkSchedule(tx, req.params.id, normalized);
      await tx.hrWorkScheduleChange.updateMany({
        where: { personnelId: req.params.id, status: { in: ['PROPOSED', 'DRAFT', 'SUBMITTED', 'RETURNED'] } },
        data: { status: 'CANCELLED', returnedBy: actorId(req), returnedAt: new Date(), returnReason: 'گردش قدیمی با ثبت مستقیم برنامه کاری بسته شد.' },
      });
      await tx.hrPersonnelAudit.create({
        data: {
          personnelId: req.params.id,
          actorUserId: actorId(req),
          eventType: 'WORK_SCHEDULE_UPDATED',
          sourceCategory: 'WORK_SCHEDULE',
          reason: 'ثبت مستقیم برنامه کاری',
          payloadJson: { scheduleId: schedule!.id, effectiveDate: normalized.effectiveDate, days: normalized.days } as any,
        },
      });
      return schedule;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ success: true, data: row });
  } catch (error) { handleError(res, error, 'Update personnel work schedule'); }
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

const assignmentWithdrawalHandler = (action: 'CANCELLED' | 'ENDED') => async (req: WorkspaceRequest, res: Response) => {
  try {
    const reason = textValue(req.body.reason);
    if (!reason) throw new Error('دلیل برداشت تخصیص الزامی است.');
    const result = await prisma.$transaction(async (tx) => {
      const replay = await tx.hrEmploymentAssignmentWithdrawal.findUnique({
        where: { originalAssignmentId_action: { originalAssignmentId: req.params.id, action } },
      });
      if (replay) return { assignment: await tx.hrEmploymentAssignment.findUnique({ where: { id: req.params.id }, include: assignmentInclude }), withdrawal: replay };
      const assignment = await tx.hrEmploymentAssignment.findUnique({
        where: { id: req.params.id },
        include: { ...assignmentInclude, employmentRelationship: { include: { personnel: { select: { id: true, firstName: true, lastName: true } } } }, supervisedAssignments: { select: { id: true } } },
      });
      if (!assignment) throw new Error('تخصیص پیدا نشد.');
      const now = new Date();
      const effectiveAt = action === 'ENDED' ? parseDate(req.body.effectiveTo || req.body.effectiveAt, 'تاریخ پایان') : now;
      if (action === 'CANCELLED' && assignment.effectiveFrom <= now) throw new Error('فقط تخصیصی که هنوز آغاز نشده است قابل لغو است؛ تخصیص جاری را پایان دهید.');
      if (action === 'CANCELLED' && assignment.effectiveTo) throw new Error('تخصیص پایان‌یافته قابل لغو نیست.');
      if (action === 'ENDED' && (assignment.effectiveFrom > now || assignment.effectiveTo)) throw new Error('فقط تخصیص جاری و باز قابل پایان‌دادن است؛ تخصیص آینده را لغو کنید.');
      if (action === 'ENDED' && (effectiveAt < assignment.effectiveFrom || effectiveAt > now)) throw new Error('تاریخ پایان باید بین شروع تخصیص و زمان جاری باشد.');
      const withdrawal = await tx.hrEmploymentAssignmentWithdrawal.create({
        data: {
          originalAssignmentId: assignment.id,
          employmentRelationshipId: assignment.employmentRelationshipId,
          action,
          effectiveAt,
          reason,
          actorUserId: actorId(req),
          assignmentSnapshot: jsonValue({
            id: assignment.id, type: assignment.type, effectiveFrom: assignment.effectiveFrom, effectiveTo: assignment.effectiveTo,
            position: assignment.position ? foundationReferenceSnapshot('POSITION', assignment.position, now) : assignment.positionSnapshot,
            organizationalUnit: assignment.organizationalUnit ? foundationReferenceSnapshot('ORGANIZATIONAL_UNIT', assignment.organizationalUnit, now) : assignment.organizationalUnitSnapshot,
            personnel: assignment.employmentRelationship.personnel,
            detachedSupervisorReferenceCount: assignment.supervisedAssignments.length,
          }),
        },
      });
      if (action === 'ENDED') {
        const updated = await tx.hrEmploymentAssignment.update({ where: { id: assignment.id }, data: { effectiveTo: effectiveAt }, include: assignmentInclude });
        return { assignment: updated, withdrawal };
      }
      if (assignment.supervisedAssignments.length) {
        await tx.hrEmploymentAssignment.updateMany({ where: { responsibleSupervisorAssignmentId: assignment.id }, data: { responsibleSupervisorAssignmentId: null } });
      }
      await tx.hrEmploymentAssignment.delete({ where: { id: assignment.id } });
      return { assignment: null, withdrawal };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ success: true, data: result });
  } catch (error) { handleError(res, error, `${action} employment assignment`); }
};

router.post('/assignments/:id/cancel', editAccess, assignmentWithdrawalHandler('CANCELLED'));
router.post('/assignments/:id/end', editAccess, assignmentWithdrawalHandler('ENDED'));
router.put('/assignments/:id/end', editAccess, assignmentWithdrawalHandler('ENDED'));

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
    res.json({ success: true, data: rows.map((row) => ({ id: row.id, positionTitle: row.position?.title || 'جایگاه حذف‌شده', personnelId: row.employmentRelationship.personnelId, name: `${row.employmentRelationship.personnel.firstName} ${row.employmentRelationship.personnel.lastName}` })) });
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

router.get('/redesign/data-contracts', viewAccess, (_req, res) => {
  res.json({ success: true, data: HR_REDESIGN_CATALOG });
});

router.get('/redesign/compatibility/access/:userId', adminAccess, async (req, res) => {
  try {
    const [workspacePermission, featurePermissions, authorities] = await Promise.all([
      prisma.workspacePermission.findUnique({ where: { userId_workspace: { userId: req.params.userId, workspace: 'hr' } } }),
      prisma.featurePermission.findMany({ where: { userId: req.params.userId, workspace: 'hr' } }),
      prisma.hrHiringAuthority.findMany({ where: { userId: req.params.userId } }),
    ]);
    res.json({ success: true, data: projectLegacyHrAccess({ userId: req.params.userId, workspacePermission, featurePermissions, authorities }) });
  } catch (error) { handleError(res, error, 'Project legacy HR access'); }
});

router.get('/redesign/compatibility/positions', viewAccess, async (_req, res) => {
  try {
    const positions = await prisma.hrPosition.findMany({
      select: { id: true, code: true, title: true, capacity: true, isActive: true, createdAt: true },
      orderBy: { code: 'asc' },
    });
    res.json({ success: true, data: positions.map(projectLegacyPosition) });
  } catch (error) { handleError(res, error, 'Project legacy HR Positions'); }
});

router.get('/redesign/compatibility/work-items', viewAccess, async (req: WorkspaceRequest, res) => {
  try {
    const workItems = await prisma.hrWorkItem.findMany({
      where: { assignedToUserId: actorId(req) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: workItems.map(projectLegacyHrWorkItem) });
  } catch (error) { handleError(res, error, 'Project legacy HR work items'); }
});

router.get('/redesign/compatibility/applications/:applicationId/assessments', viewAccess, async (req: WorkspaceRequest, res) => {
  try {
    const [authority, assignedDuty] = await Promise.all([
      authorizeHrUser(prisma, actorId(req), {
        actionPermissionCodes: ['MANAGE_RECRUITMENT_CASE', 'VIEW_COMPANY_EVALUATION_RESULTS'],
      }),
      prisma.hrWorkItem.findFirst({
        where: {
          sourceType: 'HIRING_ACTION',
          assignedToUserId: actorId(req),
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          OR: ['COMPLETE_ASSESSMENT', 'DECIDE_ASSESSMENT', 'RECORD_ASSESSMENT'].map((action) => ({
            sourceKey: { startsWith: `HIRING:${req.params.applicationId}:${action}:` },
          })),
        },
        select: { id: true },
      }),
    ]);
    if (!canReadLegacyAssessmentCompatibility({
      hasAssignedAssessmentDuty: Boolean(assignedDuty),
      hasActiveHiringAuthority: authority.allowed,
    })) {
      return res.status(403).json({ success: false, error: 'Assigned hiring assessment duty and active authority are required.' });
    }
    const application = await prisma.hrJobApplication.findUniqueOrThrow({
      where: { id: req.params.applicationId },
      select: { id: true, assessments: { orderBy: { recordedAt: 'asc' } } },
    });
    const completedAssessmentKinds = [...new Set(application.assessments
      .map((assessment) => assessment.assessmentType)
      .filter((kind): kind is 'DISC' | 'EQ' | 'BIG_FIVE' => ['DISC', 'EQ', 'BIG_FIVE'].includes(kind)))] as Array<'DISC' | 'EQ' | 'BIG_FIVE'>;
    res.json({
      success: true,
      data: projectLegacyAssessmentCompatibility({
        applicationId: application.id,
        completedAssessmentKinds,
        evidence: application.assessments,
      }),
    });
  } catch (error) { handleError(res, error, 'Project legacy HR assessment evidence'); }
});

router.get('/migration/redesign-preview', adminAccess, async (req: WorkspaceRequest, res) => {
  try {
    const report = await runHrRedesignBackfill(prisma, {
      apply: false,
      actorUserId: actorId(req),
    });
    res.json({ success: true, data: report });
  } catch (error) { handleError(res, error, 'Preview HR redesign backfill'); }
});

router.post('/migration/redesign-backfill', adminAccess, async (req: WorkspaceRequest, res) => {
  try {
    const report = await runHrRedesignBackfill(prisma, {
      apply: true,
      actorUserId: actorId(req),
    });
    res.json({ success: true, data: report });
  } catch (error) { handleError(res, error, 'Apply HR redesign backfill'); }
});

router.get('/migration/reconciliation', adminAccess, async (req, res) => {
  try {
    const blockerValue = textValue(req.query.cutoverBlocker);
    if (blockerValue && !['true', 'false'].includes(blockerValue)) throw new Error('HR_RECONCILIATION_BLOCKER_FILTER_INVALID');
    const data = await getHrReconciliationWorkspace(prisma, {
      primaryState: nullableText(req.query.primaryState) ?? undefined,
      attentionFlag: nullableText(req.query.attentionFlag) ?? undefined,
      sourceType: nullableText(req.query.sourceType) ?? undefined,
      cutoverBlocker: blockerValue ? blockerValue === 'true' : undefined,
    });
    res.json({ success: true, data });
  } catch (error) { handleError(res, error, 'List HR migration reconciliation'); }
});

router.post('/migration/reconciliation/:id/reviews', adminAccess, async (req: WorkspaceRequest, res) => {
  try {
    const review = await recordHrReconciliationReview(prisma, {
      reconciliationId: req.params.id,
      outcome: textValue(req.body.outcome),
      reason: textValue(req.body.reason),
      actorUserId: actorId(req),
    });
    res.status(201).json({ success: true, data: review });
  } catch (error) { handleError(res, error, 'Review HR migration reconciliation'); }
});

const migrationRecordTitles: Record<string, string> = {
  'active-personnel': 'پرسنل فعال',
  'inactive-personnel': 'پرسنل غیرفعال',
  'linked-users': 'کاربران متصل به پرسنل',
  'unlinked-users': 'کاربران بدون پرسنل',
  departments: 'دپارتمان‌های قدیمی',
  schedules: 'برنامه‌های کاری قدیمی',
  migrated: 'رکوردهای قبلاً مهاجرت‌شده',
};

router.get('/migration/records/:category', adminAccess, async (req, res) => {
  try {
    const category = textValue(req.params.category);
    const title = migrationRecordTitles[category];
    if (!title) return res.status(404).json({ success: false, error: 'دسته مهاجرت پیدا نشد.' });

    let records: Array<{ id: string; title: string; subtitle?: string; detail?: string; status?: string }> = [];
    if (category === 'active-personnel' || category === 'inactive-personnel') {
      const isActive = category === 'active-personnel';
      const rows = await prisma.personnel.findMany({
        where: { isActive },
        include: { department: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      });
      records = rows.map((row) => ({
        id: row.id,
        title: `${row.firstName} ${row.lastName}`,
        subtitle: row.employeeNumber || 'بدون شماره پرسنلی',
        detail: row.department?.namePersian || row.department?.name || 'بدون دپارتمان',
        status: isActive ? 'فعال' : 'غیرفعال',
      }));
    } else if (category === 'linked-users' || category === 'unlinked-users') {
      const linked = category === 'linked-users';
      const rows = await prisma.user.findMany({
        where: linked ? { personnelId: { not: null } } : { personnelId: null },
        include: { personnel: true, department: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      });
      records = rows.map((row) => ({
        id: row.id,
        title: `${row.firstName} ${row.lastName}`,
        subtitle: row.email,
        detail: row.personnel
          ? `پرسنل: ${row.personnel.firstName} ${row.personnel.lastName}`
          : row.department?.namePersian || row.department?.name || 'بدون دپارتمان',
        status: linked ? 'متصل' : 'بدون پرسنل',
      }));
    } else if (category === 'departments') {
      const rows = await prisma.department.findMany({ orderBy: { name: 'asc' } });
      records = rows.map((row) => ({
        id: row.id,
        title: row.namePersian || row.name,
        subtitle: row.name,
        detail: row.description || undefined,
        status: row.isActive ? 'فعال' : 'غیرفعال',
      }));
    } else if (category === 'schedules') {
      const rows = await prisma.personnelWorkSchedule.findMany({
        include: { personnel: true, days: true },
        orderBy: { effectiveFrom: 'desc' },
      });
      records = rows.map((row) => ({
        id: row.id,
        title: `${row.personnel.firstName} ${row.personnel.lastName}`,
        subtitle: `از ${row.effectiveFrom.toISOString().slice(0, 10)}`,
        detail: `${row.days.length.toLocaleString('fa-IR')} روز کاری تعریف‌شده`,
        status: 'قدیمی',
      }));
    } else {
      const rows = await prisma.hrEmploymentRelationship.findMany({
        where: { sourceSystem: 'LEGACY_PERSONNEL' },
        include: { personnel: true },
        orderBy: { migratedAt: 'desc' },
      });
      records = rows.map((row) => ({
        id: row.id,
        title: `${row.personnel.firstName} ${row.personnel.lastName}`,
        subtitle: row.sourceId || 'بدون شناسه منبع',
        detail: row.migratedAt ? row.migratedAt.toISOString() : undefined,
        status: row.status,
      }));
    }

    res.json({ success: true, data: { category, title, count: records.length, records } });
  } catch (error) { handleError(res, error, 'HR migration records'); }
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
      let relationshipsBlocked = 0;
      for (const person of personnel) {
        const reconciliation = await tx.hrReconciliationRecord.findUnique({
          where: { sourceType_sourceId: { sourceType: 'PERSONNEL', sourceId: person.id } },
          select: { id: true, attentionFlags: { where: { flagCode: 'POSSIBLE_DUPLICATE_IDENTITY', isActive: true }, select: { flagCode: true } } },
        });
        if (reconciliation) {
          try {
            assertAutomatedHrMigrationOperationAllowed({
              reconciliationId: reconciliation.id,
              activeAttentionFlags: reconciliation.attentionFlags.map((flag) => flag.flagCode),
            });
          } catch {
            relationshipsBlocked += 1;
            continue;
          }
        }
        const existing = await tx.hrEmploymentRelationship.findUnique({ where: { sourceSystem_sourceId: { sourceSystem: 'LEGACY_PERSONNEL', sourceId: person.id } } });
        const currentRelationship = await tx.hrEmploymentRelationship.findFirst({ where: { personnelId: person.id, ...overlaps(baseline, null) } });
        if (!existing && !currentRelationship) {
          await tx.hrEmploymentRelationship.create({ data: { personnelId: person.id, status: 'ACTIVE', effectiveFrom: baseline, startDateVerified: false, sourceSystem: 'LEGACY_PERSONNEL', sourceId: person.id, migratedAt: new Date(), createdBy: actorId(req) } });
          relationshipsCreated += 1;
        } else {
          relationshipsSkipped += 1;
        }
      }
      return { unitsCreated, relationshipsCreated, relationshipsSkipped, relationshipsBlocked };
    });
    res.json({ success: true, data: result, message: 'مهاجرت کنترل‌شده انجام شد؛ موارد فاقد تخصیص اصلی همچنان برای تکمیل HR علامت‌گذاری می‌شوند.' });
  } catch (error) { handleError(res, error, 'Apply HR migration'); }
});

export default router;
