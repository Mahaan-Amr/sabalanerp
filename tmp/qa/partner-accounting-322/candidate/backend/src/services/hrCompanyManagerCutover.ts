import type { Prisma, PrismaClient } from '@prisma/client';

type Client = PrismaClient | Prisma.TransactionClient;

const QA_USERNAME = 'qa_hiring_manager';
const COMPANY_MANAGER_USERNAME = 'behpour';
const RESPONSIBILITY_KEY = 'hr-redesign-v1:company-manager:global:behpour';
const DESTINATION_KEY = 'hr-redesign-v1:company-manager-destination:global:human-resources';

const permittedQaRelations = new Set([
  'workspacePermissions',
  'authSessions',
  'revokedAuthSessions',
  'browserProfiles',
  'authenticationEvents',
  'authenticationActions',
  'notifications',
  'assignedHrWorkItems',
  'hrWorkItemAudits',
]);

export type HrCompanyManagerCutoverPlan = {
  pendingChanges: number;
  blockers: string[];
  qaUserId: string | null;
  qaReconciliationId: string | null;
  companyManagerUserId: string | null;
  qaWorkItemIds: string[];
};

export const inspectHrCompanyManagerCutover = async (client: Client): Promise<HrCompanyManagerCutoverPlan> => {
  const [qaUser, companyManager, activeLegacyGrants, activeCatalogs, legacyAuthorities, defaultOwner, responsibility, destination] = await Promise.all([
    client.user.findUnique({ where: { username: QA_USERNAME }, select: { id: true, _count: true } }),
    client.user.findUnique({ where: { username: COMPANY_MANAGER_USERNAME }, select: { id: true, isActive: true } }),
    client.hrBusinessAuthorityGrant.count({ where: { authorityCode: 'HIRING_MANAGER', status: 'ACTIVE' } }),
    Promise.all([
      client.hrAuthorityCatalog.count({ where: { code: 'HIRING_MANAGER', isActive: true } }),
      client.hrResponsibilityTypeCatalog.count({ where: { code: 'HIRING_MANAGER', isActive: true } }),
    ]).then((counts) => counts[0] + counts[1]),
    client.hrHiringAuthority.count({ where: { authority: 'HIRING_MANAGER' } }),
    client.hrHiringAuthorityDefaultOwner.findUnique({ where: { authority: 'COMPANY_MANAGER' }, select: { userId: true } }),
    client.hrNamedResponsibility.findUnique({ where: { stableKey: RESPONSIBILITY_KEY }, select: { assignedUserId: true, effectiveTo: true } }),
    client.hrResponsibilityDestination.findUnique({ where: { stableKey: DESTINATION_KEY }, select: { workspaceCode: true, isActive: true } }),
  ]);

  const blockers: string[] = [];
  if (!companyManager?.isActive) blockers.push('COMPANY_MANAGER_OWNER_NOT_ACTIVE');

  let qaWorkItemIds: string[] = [];
  let qaReconciliationId: string | null = null;
  if (qaUser) {
    qaReconciliationId = (await client.hrReconciliationRecord.findUnique({
      where: { sourceType_sourceId: { sourceType: 'USER', sourceId: qaUser.id } },
      select: { id: true },
    }))?.id ?? null;
    const unexpectedRelations = Object.entries(qaUser._count)
      .filter(([relation, count]) => count > 0 && !permittedQaRelations.has(relation))
      .map(([relation]) => relation);
    if (unexpectedRelations.length) blockers.push(`QA_HIRING_MANAGER_UNEXPECTED_HISTORY:${unexpectedRelations.join(',')}`);

    const workItems = await client.hrWorkItem.findMany({
      where: { OR: [
        { assignedToUserId: qaUser.id }, { createdByUserId: qaUser.id },
        { completedByUserId: qaUser.id }, { waivedByUserId: qaUser.id },
      ] },
      select: { id: true, status: true, sourceType: true, sourceKey: true },
    });
    const invalidWorkItems = workItems.filter((item) => (
      item.status !== 'COMPLETE'
      || item.sourceType !== 'HIRING_ACTION'
      || !item.sourceKey?.includes(':CREATE_OFFER:')
    ));
    if (invalidWorkItems.length) blockers.push('QA_HIRING_MANAGER_NON_QA_WORK_ITEM');
    qaWorkItemIds = workItems.map(({ id }) => id);
  }

  const ownerReady = Boolean(companyManager
    && defaultOwner?.userId === companyManager.id
    && responsibility?.assignedUserId === companyManager.id
    && responsibility.effectiveTo === null
    && destination?.workspaceCode === 'HUMAN_RESOURCES'
    && destination.isActive);
  const pendingChanges = Number(Boolean(qaUser))
    + activeLegacyGrants
    + activeCatalogs
    + legacyAuthorities
    + Number(!ownerReady);

  return {
    pendingChanges,
    blockers,
    qaUserId: qaUser?.id ?? null,
    qaReconciliationId,
    companyManagerUserId: companyManager?.id ?? null,
    qaWorkItemIds,
  };
};

export const applyHrCompanyManagerCutover = async (client: Client, plan: HrCompanyManagerCutoverPlan, now = new Date()) => {
  if (plan.blockers.length) throw new Error(`HR_COMPANY_MANAGER_CUTOVER_BLOCKED:${plan.blockers.join('|')}`);
  if (!plan.companyManagerUserId) throw new Error('HR_COMPANY_MANAGER_CUTOVER_BLOCKED:COMPANY_MANAGER_OWNER_NOT_ACTIVE');

  await client.hrBusinessAuthorityGrant.updateMany({
    where: { authorityCode: 'HIRING_MANAGER', status: 'ACTIVE' },
    data: { status: 'REVOKED', effectiveTo: now, revokedAt: now, revokedByUserId: plan.companyManagerUserId, reason: 'Hiring Manager capability retired' },
  });
  await client.hrHiringAuthority.deleteMany({ where: { authority: 'HIRING_MANAGER' } });
  await client.hrAuthorityCatalog.updateMany({ where: { code: 'HIRING_MANAGER' }, data: { isActive: false } });
  await client.hrResponsibilityTypeCatalog.updateMany({ where: { code: 'HIRING_MANAGER' }, data: { isActive: false } });

  await client.hrHiringAuthorityDefaultOwner.upsert({
    where: { authority: 'COMPANY_MANAGER' },
    update: { userId: plan.companyManagerUserId, configuredBy: plan.companyManagerUserId },
    create: { authority: 'COMPANY_MANAGER', userId: plan.companyManagerUserId, configuredBy: plan.companyManagerUserId },
  });
  await client.hrNamedResponsibility.upsert({
    where: { stableKey: RESPONSIBILITY_KEY },
    update: { assignedUserId: plan.companyManagerUserId, effectiveTo: null, reason: 'Company Manager owns compensation proposals' },
    create: {
      stableKey: RESPONSIBILITY_KEY,
      responsibilityTypeCode: 'COMPANY_MANAGER', scopeType: 'GLOBAL', scopeId: null,
      assignedUserId: plan.companyManagerUserId, effectiveFrom: now,
      reason: 'Company Manager owns compensation proposals', createdByUserId: plan.companyManagerUserId,
    },
  });
  await client.hrResponsibilityDestination.upsert({
    where: { stableKey: DESTINATION_KEY },
    update: { workspaceCode: 'HUMAN_RESOURCES', isActive: true },
    create: {
      stableKey: DESTINATION_KEY,
      responsibilityTypeCode: 'COMPANY_MANAGER', scopeType: 'GLOBAL', scopeId: null,
      workspaceCode: 'HUMAN_RESOURCES', queueCode: 'COMPANY_MANAGER_QUEUE',
      createdByUserId: plan.companyManagerUserId,
    },
  });

  if (plan.qaUserId) {
    if (plan.qaReconciliationId) {
      await client.hrCutoverBlockerProjection.deleteMany({ where: { reconciliationId: plan.qaReconciliationId } });
      await client.hrReconciliationAttentionFlag.deleteMany({ where: { reconciliationId: plan.qaReconciliationId } });
      await client.hrReconciliationReview.deleteMany({ where: { reconciliationId: plan.qaReconciliationId } });
      await client.hrReconciliationRecord.delete({ where: { id: plan.qaReconciliationId } });
    }
    await client.hrWorkItemAudit.deleteMany({ where: { OR: [
      { workItemId: { in: plan.qaWorkItemIds } }, { actorUserId: plan.qaUserId },
    ] } });
    await client.hrWorkItem.deleteMany({ where: { id: { in: plan.qaWorkItemIds } } });
    await client.authenticationEvent.deleteMany({ where: { OR: [{ userId: plan.qaUserId }, { actorId: plan.qaUserId }] } });
    await client.hrAuthorizationAuditEvent.deleteMany({ where: { actorUserId: plan.qaUserId } });
    await client.hrWorkspaceAccessGrant.deleteMany({ where: { userId: plan.qaUserId } });
    await client.hrFeatureAccessGrant.deleteMany({ where: { userId: plan.qaUserId } });
    await client.hrBusinessAuthorityGrant.deleteMany({ where: { userId: plan.qaUserId } });
    await client.hrHiringAuthority.deleteMany({ where: { userId: plan.qaUserId } });
    await client.workspacePermission.deleteMany({ where: { userId: plan.qaUserId } });
    await client.featurePermission.deleteMany({ where: { userId: plan.qaUserId } });
    await client.user.delete({ where: { id: plan.qaUserId } });
  }
};
