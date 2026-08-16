import crypto from 'node:crypto';
import express, { type NextFunction, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authorize, type AuthRequest } from '../middleware/auth';
import { FEATURES, FEATURE_WORKSPACE_MAP } from '../middleware/feature';
import { activeCompanyManagerUserIds, activeHrAuthoritiesForUser, authorizeHrUser } from '../services/hrAuthorizationService';
import { expandFeaturePrerequisites } from '../services/featurePermissionPrerequisites';
import { canAssignSystemRole } from '../services/userRoleAdministrationPolicy';
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
  const [users, workspaceCatalog, featureCatalog, authorityCatalog, responsibilityTypes, recentWorkspaceGrants,
    activeWorkspaceGrants, recentFeatureGrants, activeFeatureGrants, authorityGrants, responsibilities, destinations, constraints, audit] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, ...(req.user!.role === 'MANAGER' ? { role: { not: 'ADMIN' } } : {}) }, select: { id: true, username: true, firstName: true, lastName: true, role: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    prisma.hrWorkspaceCatalog.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.hrFeatureCatalog.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.hrAuthorityCatalog.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.hrResponsibilityTypeCatalog.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.hrWorkspaceAccessGrant.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.hrWorkspaceAccessGrant.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } }),
    prisma.hrFeatureAccessGrant.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
    prisma.hrFeatureAccessGrant.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } }),
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
  const mergeById = <T extends { id: string }>(primary: T[], history: T[]) => {
    const rows = new Map(primary.map((row) => [row.id, row]));
    history.forEach((row) => { if (!rows.has(row.id)) rows.set(row.id, row); });
    return [...rows.values()];
  };
  const workspaceGrants = mergeById(activeWorkspaceGrants, recentWorkspaceGrants);
  const featureGrants = mergeById(activeFeatureGrants, recentFeatureGrants);
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

router.post('/user-access/:userId', administer, asyncHandler(async (req, res) => {
  const targetUserId = text(req.params.userId);
  const requestedRole = text(req.body.role).toUpperCase();
  const reason = requiredReason(req.body.reason);
  const expiryWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'expiresAt');
  const effectiveTo = expiryWasProvided ? optionalDate(req.body.expiresAt) : undefined;
  const requestedWorkspaces = (req.body.workspaceLevels && typeof req.body.workspaceLevels === 'object')
    ? req.body.workspaceLevels as Record<string, string | null>
    : {};
  const requestedFeatures = Array.isArray(req.body.features) ? req.body.features : [];
  const now = new Date();
  const legacyFeatures = Object.values(FEATURES);
  const legacyFeatureSet = new Set(legacyFeatures);
  const desiredLegacyInput = requestedFeatures
    .map((entry: unknown) => typeof entry === 'string' ? entry : text((entry as { key?: unknown })?.key))
    .filter((feature: string) => legacyFeatureSet.has(feature as never));
  const desiredLegacy = expandFeaturePrerequisites(desiredLegacyInput, legacyFeatures);
  const requestedLevelByFeature = new Map<string, string>(requestedFeatures.map((entry: any) => [text(entry.key), text(entry.level).toLowerCase()]));
  if ([...requestedLevelByFeature.values()].some((level) => !['view', 'edit', 'admin'].includes(level))) {
    throw badRequest('سطح مجوز جزئی معتبر نیست.');
  }
  const requestedHrInput = requestedFeatures
    .map((entry: unknown) => typeof entry === 'string' ? entry : text((entry as { key?: unknown })?.key))
    .filter((feature: string) => !legacyFeatureSet.has(feature as never));
  const desiredHr = expandHrActionPermissionSelection(requestedHrInput);

  const updated = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUniqueOrThrow({ where: { id: targetUserId }, select: { id: true, role: true, isActive: true } });
    if (!target.isActive) throw conflict('حساب کاربر غیرفعال است.');
    if (!canAssignSystemRole({ actorRole: req.user!.role, targetRole: target.role, requestedRole })) {
      throw forbidden('مدیر نمی‌تواند حساب مدیر سامانه را تغییر دهد یا نقش مدیر سامانه بسازد.');
    }
    const validRoles = new Set(['USER', 'SALES', 'MODERATOR', 'MANAGER', 'ADMIN']);
    if (!validRoles.has(requestedRole)) throw badRequest('نقش معتبر نیست.');
    const validLevels = new Set(['view', 'edit', 'admin']);
    if (req.user!.role === 'MANAGER' && Object.values(requestedWorkspaces).some((level) => level === 'admin')) {
      throw forbidden('مدیر نمی‌تواند سطح مدیریت اعطا کند.');
    }

    const hrCatalogRows = await tx.hrFeatureCatalog.findMany({ where: { isActive: true }, select: { code: true } });
    const contractHrFeatureSet = new Set(HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => code));
    const persistedHrFeatureSet = new Set(hrCatalogRows.map(({ code }) => code));
    const validHrFeatures = new Set([
      ...contractHrFeatureSet,
      ...persistedHrFeatureSet,
      ...HR_ACTION_PERMISSION_GROUPS.flatMap(({ permissions }) => permissions.map(({ code }) => code)),
    ]);
    if (desiredHr.some((feature) => !validHrFeatures.has(feature))) throw badRequest('یک یا چند مجوز منابع انسانی معتبر نیست.');
    for (const featureCode of desiredHr.filter((feature) => contractHrFeatureSet.has(feature as never) && !persistedHrFeatureSet.has(feature))) {
      await tx.hrFeatureCatalog.upsert({
        where: { code: featureCode },
        update: { workspaceCode: HR_REDESIGN_CATALOG.workspaceCode, version: HR_REDESIGN_CATALOG.contractVersion, isActive: true },
        create: {
          code: featureCode,
          workspaceCode: HR_REDESIGN_CATALOG.workspaceCode,
          version: HR_REDESIGN_CATALOG.contractVersion,
          displayName: getHrActionPermissionDefinition(featureCode)?.labelFa ?? featureCode,
        },
      });
    }

    if (requestedRole !== target.role) await tx.user.update({ where: { id: targetUserId }, data: { role: requestedRole as never } });

    const existingWorkspacePermissions = await tx.workspacePermission.findMany({ where: { userId: targetUserId } });
    for (const workspace of ['crm', 'sales', 'inventory', 'security', 'accounting', 'bi', 'logistics']) {
      const level = requestedWorkspaces[workspace];
      const existing = existingWorkspacePermissions.find((permission) => permission.workspace === workspace);
      const nextExpiry = expiryWasProvided ? effectiveTo ?? null : existing?.expiresAt ?? null;
      if (level && !validLevels.has(level)) throw badRequest('سطح فضای کاری معتبر نیست.');
      if (!level) await tx.workspacePermission.deleteMany({ where: { userId: targetUserId, workspace } });
      else await tx.workspacePermission.upsert({
        where: { userId_workspace: { userId: targetUserId, workspace } },
        create: { userId: targetUserId, workspace, permissionLevel: level, grantedBy: actorId(req), expiresAt: nextExpiry },
        update: { permissionLevel: level, grantedBy: actorId(req), grantedAt: now, expiresAt: nextExpiry, isActive: true },
      });
    }
    // Human Resources authorization is owned by the audited HR grant ledger.
    // Remove any legacy direct row so older readers cannot contradict it.
    await tx.workspacePermission.deleteMany({ where: { userId: targetUserId, workspace: 'hr' } });

    const managedLegacyFeatures = legacyFeatures.filter((feature) => FEATURE_WORKSPACE_MAP[feature as keyof typeof FEATURE_WORKSPACE_MAP] !== 'hr');
    const managedLegacyFeatureSet = new Set<string>(managedLegacyFeatures);
    const existingFeaturePermissions = await tx.featurePermission.findMany({ where: { userId: targetUserId, feature: { in: managedLegacyFeatures } } });
    await tx.featurePermission.deleteMany({
      where: { userId: targetUserId, feature: { in: managedLegacyFeatures.filter((feature) => !desiredLegacy.includes(feature)) } },
    });
    for (const feature of desiredLegacy.filter((candidate) => managedLegacyFeatureSet.has(candidate))) {
      const workspace = String(FEATURE_WORKSPACE_MAP[feature as keyof typeof FEATURE_WORKSPACE_MAP]);
      const level = requestedLevelByFeature.get(feature) || (feature.endsWith('_view') ? 'view' : 'edit');
      const existing = existingFeaturePermissions.find((permission) => permission.feature === feature);
      const nextExpiry = expiryWasProvided ? effectiveTo ?? null : existing?.expiresAt ?? null;
      if (req.user!.role === 'MANAGER' && level === 'admin') throw forbidden('مدیر نمی‌تواند سطح مدیریت اعطا کند.');
      await tx.featurePermission.upsert({
        where: { userId_workspace_feature: { userId: targetUserId, workspace, feature } },
        create: { userId: targetUserId, workspace, feature, permissionLevel: level, grantedBy: actorId(req), expiresAt: nextExpiry },
        update: { permissionLevel: level, grantedBy: actorId(req), grantedAt: now, expiresAt: nextExpiry, isActive: true },
      });
    }

    const activeHrWorkspace = await tx.hrWorkspaceAccessGrant.findMany({ where: { userId: targetUserId, workspaceCode: 'HUMAN_RESOURCES', status: 'ACTIVE' } });
    for (const grant of activeHrWorkspace) {
      await tx.hrWorkspaceAccessGrant.update({ where: { id: grant.id }, data: { status: 'REVOKED', effectiveTo: now, revokedAt: now, revokedByUserId: actorId(req), reason } });
    }
    const hrLevel = text(requestedWorkspaces.hr).toUpperCase();
    if (hrLevel) {
      if (!levelValues.has(hrLevel as never)) throw badRequest('سطح منابع انسانی معتبر نیست.');
      if (req.user!.role === 'MANAGER' && hrLevel === 'ADMIN') throw forbidden('مدیر نمی‌تواند سطح مدیریت اعطا کند.');
      await tx.hrWorkspaceAccessGrant.create({ data: {
        stableKey: `hr-access:${targetUserId}:workspace:${now.toISOString()}:${crypto.randomUUID()}`,
        userId: targetUserId, workspaceCode: 'HUMAN_RESOURCES', level: hrLevel as never,
        effectiveFrom: now, effectiveTo: expiryWasProvided ? effectiveTo ?? null : activeHrWorkspace[0]?.effectiveTo ?? null, grantedByUserId: actorId(req), reason,
      } });
    }

    const activeHrFeatures = await tx.hrFeatureAccessGrant.findMany({ where: { userId: targetUserId, status: 'ACTIVE' } });
    for (const grant of activeHrFeatures) {
      await tx.hrFeatureAccessGrant.update({ where: { id: grant.id }, data: { status: 'REVOKED', effectiveTo: now, revokedAt: now, revokedByUserId: actorId(req), reason } });
    }
    for (const featureCode of desiredHr) {
      const requested = requestedLevelByFeature.get(featureCode)?.toUpperCase();
      const definitionLevel = getHrActionPermissionDefinition(featureCode)?.level ?? 'VIEW';
      const level = requested && levelValues.has(requested as never) ? requested : definitionLevel;
      if (req.user!.role === 'MANAGER' && level === 'ADMIN') throw forbidden('مدیر نمی‌تواند سطح مدیریت اعطا کند.');
      await tx.hrFeatureAccessGrant.create({ data: {
        stableKey: `hr-access:${targetUserId}:feature:${featureCode}:${now.toISOString()}:${crypto.randomUUID()}`,
        userId: targetUserId, featureCode, level: level as never, effectiveFrom: now,
        effectiveTo: expiryWasProvided ? effectiveTo ?? null : activeHrFeatures.find((grant) => grant.featureCode === featureCode)?.effectiveTo ?? null, grantedByUserId: actorId(req), reason,
      } });
    }
    await writeAudit(tx, { entityType: 'USER_ACCESS', entityId: targetUserId, action: 'REPLACED', actorUserId: actorId(req), reason, effectiveAt: now, before: target, after: { role: requestedRole, workspaceLevels: requestedWorkspaces, features: [...desiredLegacy, ...desiredHr], effectiveTo } });
    return { userId: targetUserId, role: requestedRole, workspaceLevels: requestedWorkspaces, features: [...desiredLegacy, ...desiredHr] };
  });
  res.json({ success: true, data: updated });
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
    const siblingGrants = await tx.hrFeatureAccessGrant.findMany({
      where: { userId: current.userId, status: 'ACTIVE', id: { not: current.id } },
      select: { featureCode: true },
    });
    const requiredBy = siblingGrants.find(({ featureCode }) => expandHrActionPermissionSelection([featureCode]).includes(current.featureCode));
    if (requiredBy) throw conflict(`این مجوز پیش‌نیاز ${requiredBy.featureCode} است و تا زمان نیاز قابل لغو نیست.`);
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
