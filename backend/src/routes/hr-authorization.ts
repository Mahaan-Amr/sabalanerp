import crypto from 'node:crypto';
import express, { type NextFunction, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authorize, type AuthRequest } from '../middleware/auth';
import { activeCompanyManagerUserIds, activeHrAuthoritiesForUser, authorizeHrUser } from '../services/hrAuthorizationService';
import { HR_REDESIGN_CATALOG } from '../services/hrRedesignDataContracts';
import {
  HR_ACTION_PERMISSION_GROUPS,
  expandHrActionPermissionSelection,
  getHrActionPermissionDefinition,
} from '../services/hrActionPermissionCatalog';

const router = express.Router();
const administer = authorize('ADMIN', 'MANAGER');
const levelValues = new Set(HR_REDESIGN_CATALOG.featureLevels);
const authorityValues = new Set<string>(HR_REDESIGN_CATALOG.businessAuthorities);
const responsibilityValues = new Set<string>(HR_REDESIGN_CATALOG.responsibilityTypes);

const asyncHandler = (handler: (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>) => (
  req: AuthRequest, res: Response, next: NextFunction,
) => void handler(req, res, next).catch(next);
const actorId = (req: AuthRequest) => req.user!.id;
const text = (value: unknown) => String(value ?? '').trim();
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode, isOperational: true });
const badRequest = (message: string) => httpError(400, message);
const forbidden = (message: string) => httpError(403, message);
const conflict = (message: string) => httpError(409, message);
const optionalDate = (value: unknown) => {
  if (!value) return null;
  const result = new Date(String(value));
  if (Number.isNaN(result.getTime())) throw badRequest('تاریخ واردشده معتبر نیست.');
  return result;
};
const requiredReason = (value: unknown) => {
  const reason = text(value);
  if (reason.length < 3) throw badRequest('دلیل مستند با حداقل سه نویسه الزامی است.');
  return reason;
};
const jsonValue = (value: unknown) => value == null ? Prisma.JsonNull : JSON.parse(JSON.stringify(value));
const legacyAuthorizationReadOnly = (_req: AuthRequest, res: Response) => res.status(410).json({
  success: false,
  error: 'HR_LEGACY_AUTHORIZATION_READ_ONLY',
});

router.post('/business-authorities', legacyAuthorizationReadOnly);
router.post('/business-authorities/:id/revoke', legacyAuthorizationReadOnly);
router.post('/responsibilities', legacyAuthorizationReadOnly);
router.post('/responsibilities/:id/end', legacyAuthorizationReadOnly);
router.post('/destinations', legacyAuthorizationReadOnly);

const assertOperationalAdministrator = async (req: AuthRequest, authorityCode?: string) => {
  if (req.user!.role === 'ADMIN') return;
  if (authorityCode === 'COMPANY_MANAGER') throw forbidden('فقط مدیر سامانه می‌تواند اختیار مدیر شرکت را مدیریت کند.');
  const authorities = await activeHrAuthoritiesForUser(prisma, actorId(req));
  if (!authorities.includes('COMPANY_MANAGER')) throw forbidden('اختیار فعال مدیر شرکت برای این عملیات الزامی است.');
};

const assertActiveUser = async (client: Prisma.TransactionClient, userId: string) => {
  const user = await client.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } });
  if (!user) throw badRequest('کاربر فعال پیدا نشد.');
};

const writeAudit = async (client: Prisma.TransactionClient, input: {
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string;
  reason: string;
  effectiveAt: Date;
  before?: unknown;
  after?: unknown;
}) => client.hrAuthorizationAuditEvent.create({ data: {
  entityType: input.entityType,
  entityId: input.entityId,
  action: input.action,
  actorUserId: input.actorUserId,
  reason: input.reason,
  effectiveAt: input.effectiveAt,
  beforeJson: jsonValue(input.before),
  afterJson: jsonValue(input.after),
} });

router.get('/me', asyncHandler(async (req, res) => {
  const now = new Date();
  const [workspaceGrants, featureGrants, authorityCodes, administration] = await Promise.all([
    prisma.hrWorkspaceAccessGrant.findMany({ where: { userId: actorId(req) }, orderBy: { createdAt: 'desc' } }),
    prisma.hrFeatureAccessGrant.findMany({ where: { userId: actorId(req) }, orderBy: { createdAt: 'desc' } }),
    activeHrAuthoritiesForUser(prisma, actorId(req), now),
    authorizeHrUser(prisma, actorId(req), {
      workspaceLevel: 'ADMIN',
      feature: { code: 'AUTHORITY_RESPONSIBILITY_ADMINISTRATION', level: 'ADMIN' },
    }, now),
  ]);
  res.json({ success: true, data: {
    workspaceGrants, featureGrants, authorityCodes,
    canAdministerAuthorityResponsibility: administration.allowed,
    generatedAt: now,
  } });
}));

router.get('/context', administer, asyncHandler(async (req, res) => {
  const [users, workspaceCatalog, featureCatalog, authorityCatalog, responsibilityTypes, workspaceGrants,
    featureGrants, authorityGrants, responsibilities, destinations, constraints, audit] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, ...(req.user!.role === 'MANAGER' ? { role: { not: 'ADMIN' } } : {}) }, select: { id: true, username: true, firstName: true, lastName: true, role: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    prisma.hrWorkspaceCatalog.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.hrFeatureCatalog.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.hrAuthorityCatalog.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.hrResponsibilityTypeCatalog.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.hrWorkspaceAccessGrant.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.hrFeatureAccessGrant.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
    prisma.hrBusinessAuthorityGrant.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
    prisma.hrNamedResponsibility.findMany({ orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 500 }),
    prisma.hrResponsibilityDestination.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.hrSeparationOfDutyConstraint.findMany({ orderBy: [{ sourceActionCode: 'asc' }, { version: 'desc' }] }),
    prisma.hrAuthorizationAuditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
  ]);
  const visibleUserIds = new Set(users.map(({ id }) => id));
  const visibleToActor = <T extends { userId: string }>(rows: T[]) => (
    req.user!.role === 'ADMIN' ? rows : rows.filter(({ userId }) => visibleUserIds.has(userId))
  );
  res.json({ success: true, data: {
    users, workspaceCatalog, featureCatalog, actionPermissionGroups: HR_ACTION_PERMISSION_GROUPS,
    authorityCatalog, responsibilityTypes,
    workspaceGrants: visibleToActor(workspaceGrants),
    featureGrants: visibleToActor(featureGrants),
    authorityGrants: visibleToActor(authorityGrants),
    responsibilities: req.user!.role === 'ADMIN' ? responsibilities : responsibilities.filter(({ assignedUserId }) => !assignedUserId || visibleUserIds.has(assignedUserId)),
    destinations, constraints, audit: req.user!.role === 'ADMIN' ? audit : [],
  } });
}));

router.post('/workspace-grants', administer, asyncHandler(async (req, res) => {
  const userId = text(req.body.userId);
  const level = text(req.body.level).toUpperCase();
  const reason = requiredReason(req.body.reason);
  if (!userId || !levelValues.has(level as never)) throw badRequest('کاربر یا سطح دسترسی معتبر نیست.');
  const effectiveAt = optionalDate(req.body.effectiveFrom) ?? new Date();
  const effectiveTo = optionalDate(req.body.effectiveTo);
  const row = await prisma.$transaction(async (tx) => {
    await assertActiveUser(tx, userId);
    const target = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    if (req.user!.role === 'MANAGER' && (target.role === 'ADMIN' || level === 'ADMIN')) {
      throw forbidden('مدیر نمی‌تواند حساب مدیر سامانه یا سطح مدیریت کامل را تغییر دهد.');
    }
    const created = await tx.hrWorkspaceAccessGrant.create({ data: {
      stableKey: `hr-access:${userId}:workspace:${effectiveAt.toISOString()}:${crypto.randomUUID()}`,
      userId, workspaceCode: HR_REDESIGN_CATALOG.workspaceCode, level: level as never,
      effectiveFrom: effectiveAt, effectiveTo, grantedByUserId: actorId(req), reason,
    } });
    await writeAudit(tx, { entityType: 'WORKSPACE_GRANT', entityId: created.id, action: 'GRANTED', actorUserId: actorId(req), reason, effectiveAt, after: created });
    return created;
  });
  res.status(201).json({ success: true, data: row });
}));

router.post('/workspace-grants/:id/revoke', administer, asyncHandler(async (req, res) => {
  const reason = requiredReason(req.body.reason);
  const effectiveAt = new Date();
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.hrWorkspaceAccessGrant.findUniqueOrThrow({ where: { id: req.params.id } });
    const target = await tx.user.findUniqueOrThrow({ where: { id: current.userId }, select: { role: true } });
    if (req.user!.role === 'MANAGER' && (target.role === 'ADMIN' || current.level === 'ADMIN')) {
      throw forbidden('مدیر نمی‌تواند دسترسی مدیر سامانه یا سطح مدیریت کامل را لغو کند.');
    }
    if (current.status !== 'ACTIVE') throw conflict('این دسترسی فعال نیست.');
    const updated = await tx.hrWorkspaceAccessGrant.update({ where: { id: current.id }, data: {
      status: 'REVOKED', effectiveTo: effectiveAt, revokedAt: effectiveAt, revokedByUserId: actorId(req), reason,
    } });
    await writeAudit(tx, { entityType: 'WORKSPACE_GRANT', entityId: current.id, action: 'REVOKED', actorUserId: actorId(req), reason, effectiveAt, before: current, after: updated });
    return updated;
  });
  res.json({ success: true, data: row });
}));

router.post('/feature-grants', administer, asyncHandler(async (req, res) => {
  const userId = text(req.body.userId);
  const featureCode = text(req.body.featureCode).toUpperCase();
  const level = text(req.body.level).toUpperCase();
  const reason = requiredReason(req.body.reason);
  if (!userId || !HR_REDESIGN_CATALOG.workspaceFeatures.some(({ code }) => code === featureCode) || !levelValues.has(level as never)) {
    throw badRequest('کاربر، قابلیت یا سطح دسترسی معتبر نیست.');
  }
  const effectiveAt = optionalDate(req.body.effectiveFrom) ?? new Date();
  const effectiveTo = optionalDate(req.body.effectiveTo);
  const featureCodes = expandHrActionPermissionSelection([featureCode]);
  const rows = await prisma.$transaction(async (tx) => {
    await assertActiveUser(tx, userId);
    const target = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    if (req.user!.role === 'MANAGER' && (target.role === 'ADMIN' || level === 'ADMIN')) {
      throw forbidden('مدیر نمی‌تواند حساب مدیر سامانه یا سطح مدیریت کامل را تغییر دهد.');
    }
    const created: any[] = [];
    for (const code of featureCodes) {
      const requiredLevel = getHrActionPermissionDefinition(code)?.level ?? (code === featureCode ? level : 'VIEW');
      const rank = { VIEW: 1, EDIT: 2, ADMIN: 3 } as const;
      const requestedLevel = code === featureCode && levelValues.has(level as never) ? level as keyof typeof rank : requiredLevel;
      const grantLevel = rank[requestedLevel] >= rank[requiredLevel as keyof typeof rank] ? requestedLevel : requiredLevel;
      const active = await tx.hrFeatureAccessGrant.findFirst({ where: {
        userId, featureCode: code, status: 'ACTIVE',
        effectiveFrom: { lte: effectiveAt },
        ...(effectiveTo
          ? { OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveTo } }] }
          : { effectiveTo: null }),
      } });
      if (active && rank[active.level] >= rank[grantLevel as keyof typeof rank]) continue;
      const row = await tx.hrFeatureAccessGrant.create({ data: {
        stableKey: `hr-access:${userId}:feature:${code}:${effectiveAt.toISOString()}:${crypto.randomUUID()}`,
        userId, featureCode: code, level: grantLevel as never, effectiveFrom: effectiveAt,
        effectiveTo, grantedByUserId: actorId(req), reason,
      } });
      await writeAudit(tx, { entityType: 'FEATURE_GRANT', entityId: row.id, action: 'GRANTED', actorUserId: actorId(req), reason, effectiveAt, after: row });
      created.push(row);
    }
    return created;
  });
  res.status(201).json({ success: true, data: rows[rows.length - 1] ?? null, prerequisiteGrants: rows.slice(0, -1) });
}));

router.post('/feature-grants/:id/revoke', administer, asyncHandler(async (req, res) => {
  const reason = requiredReason(req.body.reason);
  const effectiveAt = new Date();
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.hrFeatureAccessGrant.findUniqueOrThrow({ where: { id: req.params.id } });
    const target = await tx.user.findUniqueOrThrow({ where: { id: current.userId }, select: { role: true } });
    if (req.user!.role === 'MANAGER' && (target.role === 'ADMIN' || current.level === 'ADMIN')) {
      throw forbidden('مدیر نمی‌تواند مجوز مدیر سامانه یا سطح مدیریت کامل را لغو کند.');
    }
    if (current.status !== 'ACTIVE') throw conflict('این مجوز فعال نیست.');
    const updated = await tx.hrFeatureAccessGrant.update({ where: { id: current.id }, data: {
      status: 'REVOKED', effectiveTo: effectiveAt, revokedAt: effectiveAt, revokedByUserId: actorId(req), reason,
    } });
    await writeAudit(tx, { entityType: 'FEATURE_GRANT', entityId: current.id, action: 'REVOKED', actorUserId: actorId(req), reason, effectiveAt, before: current, after: updated });
    return updated;
  });
  res.json({ success: true, data: row });
}));

router.post('/business-authorities', administer, asyncHandler(async (req, res) => {
  const userId = text(req.body.userId);
  const authorityCode = text(req.body.authorityCode).toUpperCase();
  const reason = requiredReason(req.body.reason);
  if (!userId || !authorityValues.has(authorityCode)) throw badRequest('کاربر یا اختیار کسب‌وکار معتبر نیست.');
  await assertOperationalAdministrator(req, authorityCode);
  if (userId === actorId(req)) throw forbidden('اعطای اختیار به خود مجاز نیست.');
  const effectiveAt = optionalDate(req.body.effectiveFrom) ?? new Date();
  const row = await prisma.$transaction(async (tx) => {
    await assertActiveUser(tx, userId);
    const active = await tx.hrBusinessAuthorityGrant.findFirst({ where: { userId, authorityCode, status: 'ACTIVE', OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveAt } }] } });
    if (active) throw conflict('این اختیار هم‌اکنون فعال است.');
    const created = await tx.hrBusinessAuthorityGrant.create({ data: {
      stableKey: `hr-authority:${userId}:${authorityCode}:${effectiveAt.toISOString()}:${crypto.randomUUID()}`,
      userId, authorityCode, effectiveFrom: effectiveAt, effectiveTo: optionalDate(req.body.effectiveTo),
      grantedByUserId: actorId(req), reason,
    } });
    await writeAudit(tx, { entityType: 'BUSINESS_AUTHORITY', entityId: created.id, action: 'GRANTED', actorUserId: actorId(req), reason, effectiveAt, after: created });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(201).json({ success: true, data: row });
}));

router.post('/business-authorities/:id/revoke', administer, asyncHandler(async (req, res) => {
  const reason = requiredReason(req.body.reason);
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.hrBusinessAuthorityGrant.findUniqueOrThrow({ where: { id: req.params.id } });
    await assertOperationalAdministrator(req, current.authorityCode);
    if (current.userId === actorId(req)) throw forbidden('سلب اختیار از خود مجاز نیست.');
    if (current.status !== 'ACTIVE' || (current.effectiveTo && current.effectiveTo <= new Date())) throw conflict('این اختیار فعال نیست.');
    if (current.authorityCode === 'COMPANY_MANAGER') {
      const otherEligibleManagerIds = await activeCompanyManagerUserIds(tx, { excludeGrantId: current.id });
      if (otherEligibleManagerIds.length === 0) throw conflict('سلب اختیار آخرین مدیر شرکت مجاز نیست.');
    }
    const effectiveAt = new Date();
    const updated = await tx.hrBusinessAuthorityGrant.update({ where: { id: current.id }, data: {
      status: 'REVOKED', effectiveTo: effectiveAt, revokedAt: effectiveAt, revokedByUserId: actorId(req), reason,
    } });
    await writeAudit(tx, { entityType: 'BUSINESS_AUTHORITY', entityId: current.id, action: 'REVOKED', actorUserId: actorId(req), reason, effectiveAt, before: current, after: updated });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json({ success: true, data: row });
}));

router.post('/responsibilities', administer, asyncHandler(async (req, res) => {
  const responsibilityTypeCode = text(req.body.responsibilityTypeCode).toUpperCase();
  await assertOperationalAdministrator(req, responsibilityTypeCode);
  if (!responsibilityValues.has(responsibilityTypeCode)) throw badRequest('نوع مسئولیت معتبر نیست.');
  const assignedUserId = text(req.body.assignedUserId);
  const scopeType = text(req.body.scopeType).toUpperCase();
  const scopeId = text(req.body.scopeId) || null;
  const assignmentKind = text(req.body.assignmentKind || 'PRIMARY').toUpperCase();
  const reason = requiredReason(req.body.reason);
  if (!assignedUserId || !scopeType || !['PRIMARY', 'ACTING', 'SUBSTITUTE'].includes(assignmentKind)) throw badRequest('مالک، دامنه یا نوع انتساب معتبر نیست.');
  if (assignedUserId === actorId(req)) throw forbidden('انتساب مسئولیت به خود در این عملیات مجاز نیست.');
  const effectiveAt = optionalDate(req.body.effectiveFrom) ?? new Date();
  const row = await prisma.$transaction(async (tx) => {
    await assertActiveUser(tx, assignedUserId);
    const requiresAuthority = await tx.hrAuthorityCatalog.findUnique({ where: { code: responsibilityTypeCode }, select: { code: true } });
    if (requiresAuthority && !(await authorizeHrUser(tx, assignedUserId, { authorityCodes: [responsibilityTypeCode] }, effectiveAt)).allowed) {
      throw conflict('مالک انتخاب‌شده اختیار کسب‌وکار فعال این مسئولیت را ندارد.');
    }
    const principalResponsibilityId = text(req.body.principalResponsibilityId) || null;
    if (assignmentKind !== 'PRIMARY') {
      if (!principalResponsibilityId) throw badRequest('انتساب موقت یا جانشین باید به مسئولیت اصلی متصل باشد.');
      const principal = await tx.hrNamedResponsibility.findFirst({ where: {
        id: principalResponsibilityId, responsibilityTypeCode, scopeType, scopeId, assignmentKind: 'PRIMARY',
        effectiveFrom: { lte: effectiveAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveAt } }],
      } });
      if (!principal) throw conflict('مسئولیت اصلی مؤثر برای این جانشینی پیدا نشد.');
    }
    const created = await tx.hrNamedResponsibility.create({ data: {
      stableKey: `hr-responsibility:${responsibilityTypeCode}:${scopeType}:${scopeId ?? 'GLOBAL'}:${effectiveAt.toISOString()}:${crypto.randomUUID()}`,
      responsibilityTypeCode, scopeType, scopeId, assignedUserId, assignmentKind: assignmentKind as never,
      principalResponsibilityId,
      effectiveFrom: effectiveAt, effectiveTo: optionalDate(req.body.effectiveTo), reason, createdByUserId: actorId(req),
    } });
    await writeAudit(tx, { entityType: 'NAMED_RESPONSIBILITY', entityId: created.id, action: 'ASSIGNED', actorUserId: actorId(req), reason, effectiveAt, after: created });
    return created;
  });
  res.status(201).json({ success: true, data: row });
}));

router.post('/responsibilities/:id/end', administer, asyncHandler(async (req, res) => {
  const reason = requiredReason(req.body.reason);
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.hrNamedResponsibility.findUniqueOrThrow({ where: { id: req.params.id } });
    await assertOperationalAdministrator(req, current.responsibilityTypeCode);
    if (current.assignedUserId === actorId(req)) throw forbidden('پایان‌دادن مسئولیت خود در این عملیات مجاز نیست.');
    const effectiveAt = optionalDate(req.body.effectiveTo) ?? new Date();
    if (effectiveAt <= current.effectiveFrom || (current.effectiveTo && current.effectiveTo <= effectiveAt)) throw badRequest('زمان پایان مسئولیت معتبر نیست.');
    const updated = await tx.hrNamedResponsibility.update({ where: { id: current.id }, data: { effectiveTo: effectiveAt, reason } });
    await writeAudit(tx, { entityType: 'NAMED_RESPONSIBILITY', entityId: current.id, action: 'ENDED', actorUserId: actorId(req), reason, effectiveAt, before: current, after: updated });
    return updated;
  });
  res.json({ success: true, data: row });
}));

router.post('/destinations', administer, asyncHandler(async (req, res) => {
  if (req.user!.role !== 'ADMIN') throw forbidden('فقط مدیر سامانه می‌تواند مقصد مسئولیت را پیکربندی کند.');
  const responsibilityTypeCode = text(req.body.responsibilityTypeCode).toUpperCase();
  const scopeType = text(req.body.scopeType).toUpperCase();
  const scopeId = text(req.body.scopeId) || null;
  const workspaceCode = text(req.body.workspaceCode).toUpperCase();
  const queueCode = text(req.body.queueCode).toUpperCase();
  const reason = requiredReason(req.body.reason);
  if (!responsibilityValues.has(responsibilityTypeCode) || !scopeType || !workspaceCode || !queueCode) throw badRequest('نوع مسئولیت، دامنه، فضای کاری و صف مقصد الزامی است.');
  const effectiveAt = new Date();
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.hrResponsibilityDestination.create({ data: {
      stableKey: `hr-destination:${responsibilityTypeCode}:${scopeType}:${scopeId ?? 'GLOBAL'}:${crypto.randomUUID()}`,
      responsibilityTypeCode, scopeType, scopeId, workspaceCode,
      featureCode: text(req.body.featureCode).toUpperCase() || null, queueCode, createdByUserId: actorId(req),
    } });
    await writeAudit(tx, { entityType: 'RESPONSIBILITY_DESTINATION', entityId: created.id, action: 'CONFIGURED', actorUserId: actorId(req), reason, effectiveAt, after: created });
    return created;
  });
  res.status(201).json({ success: true, data: row });
}));

export default router;
