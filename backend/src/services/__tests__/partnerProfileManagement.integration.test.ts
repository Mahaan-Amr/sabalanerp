import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { canonicalHash, type PartnerManagementCommandV2 } from '@sabalanerp/partner-sales-contracts';
import { createPartnerProfileManagementService } from '../partnerSales/profiles/management';
import { createPrismaPartnerProfileManagementStore } from '../partnerSales/profiles/managementPrismaStore';
import { createPrismaPartnerProfileStore } from '../partnerSales/profiles/prismaStore';

function localDatabase() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local DB required');
  }
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

type CommandInput = { type: 'PROFILE_CREATE'; identityEvidenceId: string } |
  { type: 'IDENTITY_VERIFY'; profileId: string; expectedRevision: number; evidenceId: string } |
  { type: 'COMMERCIAL_TERMS_SET' | 'CREDIT_TERMS_SET'; profileId: string; expectedRevision: number; termsVersionId: string } |
  { type: 'PROFILE_CONVERSION'; profileId: string; expectedRevision: number; transition: 'START' | 'ABANDON' | 'RESOLVE';
    dispositionEvidenceIds: string[] };

async function command(actorId: string, input: CommandInput, id: string): Promise<PartnerManagementCommandV2> {
  const intent = { schemaVersion: 2 as const, ...input, reason: 'ثبت شواهد معتبر پروفایل همکار' } as const;
  const targetId = input.type === 'PROFILE_CREATE' ? input.identityEvidenceId : input.profileId;
  return { ...intent, commandId: id, correlationId: id, idempotency: { actorId, operation: input.type,
    targetId, key: id, payloadHash: await canonicalHash(intent) } } as PartnerManagementCommandV2;
}

test('Prisma profile management persists owner evidence and independently effective terms with rollback cleanup', async () => {
  const database = localDatabase(), rollback = new Error('rollback profile management fixture');
  try {
    await database.$transaction(async tx => {
      const suffix = randomUUID(), actorId = `profile-manager-${suffix}`, userId = `partner-candidate-${suffix}`;
      const identityId = `partner-identity-${suffix}`, commercialId = `partner-commercial-${suffix}`;
      const creditId = `partner-credit-${suffix}`, expiredId = `partner-expired-${suffix}`;
      await tx.user.createMany({ data: [actorId, userId].map((id, index) => ({ id, username: id,
        email: `${id}@example.invalid`, password: 'not-a-login', firstName: index ? 'Partner' : 'Manager',
        lastName: 'Fixture', ...(index ? {} : { role: 'ADMIN' as const }) })) });
      await tx.partnerIdentityEvidence.create({ data: { id: identityId, userId, legalName: 'شخص همکار تست',
        personType: 'NATURAL', identifiers: { nationalIdentityEvidence: 'masked-fixture' }, phone: '+989120000000',
        address: 'تهران، نشانی معتبر تست', integrityHash: `sha256-v1:${'1'.repeat(64)}`, issuedBy: actorId } });
      await tx.partnerTermsPolicy.createMany({ data: [
        { id: commercialId, purpose: 'PARTNER_TECHNICAL_PRICING', label: 'شرایط تجاری تست',
          effectiveDate: new Date('2026-01-01'), terms: { calculationPolicyVersion: 'partner-test-v1' },
          integrityHash: `sha256-v1:${'2'.repeat(64)}`, issuedBy: actorId },
        { id: creditId, purpose: 'PARTNER_CREDIT_TERMS', label: 'شرایط اعتباری تست',
          effectiveDate: new Date('2026-01-01'), terms: { settlementDays: 7 },
          integrityHash: `sha256-v1:${'3'.repeat(64)}`, issuedBy: actorId },
        { id: expiredId, purpose: 'PARTNER_CREDIT_TERMS', label: 'شرایط منقضی تست',
          effectiveDate: new Date('2026-01-01'), issuedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-01-02'), terms: { settlementDays: 1 },
          integrityHash: `sha256-v1:${'4'.repeat(64)}`, issuedBy: actorId },
      ] });
      const store = createPrismaPartnerProfileManagementStore(database);
      const service = createPartnerProfileManagementService({ actorId, newId: () => `partner-profile-${suffix}`,
        store: { ...store, transaction: <T>(run: (inner: Prisma.TransactionClient) => Promise<T>) => run(tx) },
        authorize: async (_inner, input) => ({ ok: true, value: { evidenceId: `auth-${input.action}` } }) });
      const created = await service.execute(await command(actorId,
        { type: 'PROFILE_CREATE', identityEvidenceId: identityId }, `create-${suffix}`));
      assert.equal(created.ok, true); if (!created.ok) return;
      assert.equal(created.value.revision, 1);
      const profileId = created.value.profileId;
      const profile = await tx.partnerProfile.findUniqueOrThrow({ where: { id: profileId }, include: {
        commercialAccount: { include: { identities: true } }, events: true } });
      assert.equal(profile.state, 'PENDING');
      assert.equal(profile.commercialAccount?.identities[0].identifiers &&
        (profile.commercialAccount.identities[0].identifiers as { evidenceId?: string }).evidenceId, identityId);
      assert.equal((profile.events[0].evidence as { authorizationEvidenceId?: string }).authorizationEvidenceId,
        'auth-PROFILE_CREATE');
      assert.equal((await service.execute(await command(actorId, { type: 'IDENTITY_VERIFY', profileId,
        expectedRevision: 1, evidenceId: identityId }, `identity-${suffix}`))).ok, true);
      assert.equal((await service.execute(await command(actorId, { type: 'COMMERCIAL_TERMS_SET', profileId,
        expectedRevision: 2, termsVersionId: commercialId }, `commercial-${suffix}`))).ok, true);
      const credit = await service.execute(await command(actorId, { type: 'CREDIT_TERMS_SET', profileId,
        expectedRevision: 3, termsVersionId: creditId }, `credit-${suffix}`));
      assert.equal(credit.ok, true); if (credit.ok) assert.equal(credit.value.revision, 4);
      const terms = await tx.partnerCommercialTerms.findMany({ where: { account: { profileId } }, orderBy: { version: 'asc' } });
      assert.deepEqual(terms.map(item => (item.terms as { purpose?: string }).purpose),
        ['PARTNER_TECHNICAL_PRICING', 'PARTNER_CREDIT_TERMS']);
      const expired = await service.execute(await command(actorId, { type: 'CREDIT_TERMS_SET', profileId,
        expectedRevision: 4, termsVersionId: expiredId }, `expired-${suffix}`));
      assert.equal(expired.ok ? null : expired.error.code, 'NOT_FOUND');
      const permission = await tx.workspacePermission.create({ data: { userId, workspace: `conversion-${suffix}`,
        permissionLevel: 'EDIT', grantedBy: actorId } });
      const started = await service.execute(await command(actorId, { type: 'PROFILE_CONVERSION', profileId,
        expectedRevision: 4, transition: 'START', dispositionEvidenceIds: [] }, `conversion-start-${suffix}`));
      assert.equal(started.ok, true);
      const blocked = await service.execute(await command(actorId, { type: 'PROFILE_CONVERSION', profileId,
        expectedRevision: 5, transition: 'RESOLVE', dispositionEvidenceIds: [`disposition-${suffix}`] },
      `conversion-blocked-${suffix}`));
      assert.equal(blocked.ok ? null : blocked.error.code, 'DEPENDENCY_BLOCKED');
      await tx.workspacePermission.update({ where: { id: permission.id }, data: { isActive: false } });
      const lifecycleStore = createPrismaPartnerProfileStore(database);
      const convertingProfile = await lifecycleStore.lockProfile(tx, profileId);
      assert.ok(convertingProfile);
      assert.equal((await lifecycleStore.readActivationGates(tx, convertingProfile)).conversionCleared, false,
        'a started conversion cannot activate before explicit disposition resolution');
      await tx.partnerConversionDisposition.create({ data: { id: `disposition-${suffix}`, profileId,
        sourceType: 'WORKSPACE_PERMISSION', sourceId: permission.id, disposition: 'REVOKED', actorId,
        evidence: { previousPermissionLevel: permission.permissionLevel, authorizationEvidenceId: 'auth-PROFILE_CONVERSION_MANAGE' } } });
      const resolved = await service.execute(await command(actorId, { type: 'PROFILE_CONVERSION', profileId,
        expectedRevision: 5, transition: 'RESOLVE', dispositionEvidenceIds: [`disposition-${suffix}`] },
      `conversion-resolved-${suffix}`));
      assert.equal(resolved.ok, true); if (resolved.ok) assert.equal(resolved.value.revision, 6);
      const resolvedProfile = await lifecycleStore.lockProfile(tx, profileId);
      assert.ok(resolvedProfile);
      assert.equal((await lifecycleStore.readActivationGates(tx, resolvedProfile)).conversionCleared, true);
      await tx.$executeRawUnsafe('SAVEPOINT immutable_partner_evidence');
      await assert.rejects(tx.partnerIdentityEvidence.update({ where: { id: identityId }, data: { legalName: 'دستکاری' } }),
        /immutable/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT immutable_partner_evidence');
      throw rollback;
    }, { timeout: 25_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
});

test('conversion resolve requires current semantic transfer evidence and revalidates successors for activation', async () => {
  const database = localDatabase(), rollback = new Error('rollback conversion disposition fixture');
  try {
    await database.$transaction(async tx => {
      const suffix = randomUUID(), actorId = `conversion-manager-${suffix}`, userId = `conversion-profile-${suffix}`;
      const activeSuccessorId = `conversion-active-${suffix}`, inactiveSuccessorId = `conversion-inactive-${suffix}`;
      await tx.user.createMany({ data: [
        { id: actorId, username: actorId, email: `${actorId}@example.invalid`, password: 'not-a-login',
          firstName: 'Manager', lastName: 'Fixture', role: 'ADMIN' },
        { id: userId, username: userId, email: `${userId}@example.invalid`, password: 'not-a-login',
          firstName: 'Partner', lastName: 'Fixture' },
        { id: activeSuccessorId, username: activeSuccessorId, email: `${activeSuccessorId}@example.invalid`,
          password: 'not-a-login', firstName: 'Active', lastName: 'Seller' },
        { id: inactiveSuccessorId, username: inactiveSuccessorId, email: `${inactiveSuccessorId}@example.invalid`,
          password: 'not-a-login', firstName: 'Inactive', lastName: 'Seller', isActive: false },
      ] });
      const department = await tx.department.create({ data: { name: `conversion-${suffix}`,
        namePersian: `تبدیل-${suffix}` } });
      await tx.user.updateMany({ where: { id: { in: [userId, activeSuccessorId, inactiveSuccessorId] } },
        data: { departmentId: department.id } });
      const customer = await tx.crmCustomer.create({ data: { firstName: 'Conversion', lastName: 'Fixture',
        createdBy: actorId } });
      const profileId = `conversion-profile-record-${suffix}`;
      await tx.partnerProfile.create({ data: { id: profileId, userId, state: 'PENDING', revision: 1 } });
      const contract = await tx.salesContract.create({ data: { id: `conversion-contract-${suffix}`,
        contractNumber: `CONVERSION-${suffix}`, title: 'Conversion responsibility',
        titlePersian: 'انتقال مسئولیت تبدیل', content: 'fixture', customerId: customer.id,
        departmentId: department.id, createdBy: actorId, responsibleSellerId: userId } });
      const correction = await tx.accountingCorrectionRequest.create({ data: { id: `conversion-correction-${suffix}`,
        contractId: contract.id, category: 'OTHER', accountantNote: 'انتقال درخواست اصلاح باز',
        createdBy: actorId, assignedToUserId: userId } });
      const crmProject = await tx.crmPotentialProject.create({ data: { id: `conversion-crm-project-${suffix}`,
        customerId: customer.id, responsibleSellerId: userId, title: 'پروژه قدیمی پیش از تبدیل', workType: 'نما' } });
      const store = createPrismaPartnerProfileManagementStore(database);
      const service = createPartnerProfileManagementService({ actorId, newId: randomUUID,
        store: { ...store, transaction: <T>(run: (inner: Prisma.TransactionClient) => Promise<T>) => run(tx) },
        authorize: async () => ({ ok: true, value: { evidenceId: 'auth-conversion' } }) });
      const started = await service.execute(await command(actorId, { type: 'PROFILE_CONVERSION', profileId,
        expectedRevision: 1, transition: 'START', dispositionEvidenceIds: [] }, `start-${suffix}`));
      assert.equal(started.ok, true);
      const startedEvent = await tx.partnerProfileEvent.findUniqueOrThrow({ where: { commandId: `start-${suffix}` } });
      assert.deepEqual((startedEvent.evidence as { blockerIds: string[] }).blockerIds,
        [`CONTRACT_RESPONSIBILITY:${contract.id}`, `CORRECTION_REQUEST:${correction.id}`,
          `CRM_PROJECT_RESPONSIBILITY:${crmProject.id}`]);

      await tx.salesContract.update({ where: { id: contract.id }, data: { responsibleSellerId: inactiveSuccessorId } });
      await tx.salesContractSellerAudit.create({ data: { contractId: contract.id, previousSellerId: userId,
        nextSellerId: inactiveSuccessorId, changedBy: actorId, changeType: 'RESPONSIBILITY_REASSIGNED',
        reason: 'تست رد جانشین غیرفعال' } });
      await tx.accountingCorrectionRequest.update({ where: { id: correction.id }, data: { assignedToUserId: inactiveSuccessorId } });
      const badContractEvidence = `a-contract-disposition-${suffix}`, badCorrectionEvidence = `a-correction-disposition-${suffix}`;
      await tx.partnerConversionDisposition.createMany({ data: [
        { id: badContractEvidence, profileId, sourceType: 'CONTRACT_RESPONSIBILITY', sourceId: contract.id,
          disposition: 'TRANSFERRED', successorId: inactiveSuccessorId, actorId, evidence: { approvedBy: actorId } },
        { id: badCorrectionEvidence, profileId, sourceType: 'CORRECTION_REQUEST', sourceId: correction.id,
          disposition: 'TRANSFERRED', successorId: inactiveSuccessorId, actorId, evidence: { approvedBy: actorId } },
      ] });
      const rejected = await service.execute(await command(actorId, { type: 'PROFILE_CONVERSION', profileId,
        expectedRevision: 2, transition: 'RESOLVE', dispositionEvidenceIds: [badContractEvidence, badCorrectionEvidence] },
      `reject-${suffix}`));
      assert.equal(rejected.ok ? null : rejected.error.code, 'DEPENDENCY_BLOCKED');

      await tx.salesContract.update({ where: { id: contract.id }, data: { responsibleSellerId: userId } });
      await tx.salesContract.update({ where: { id: contract.id }, data: { responsibleSellerId: activeSuccessorId } });
      await tx.salesContractSellerAudit.create({ data: { contractId: contract.id, previousSellerId: userId,
        nextSellerId: activeSuccessorId, changedBy: actorId, changeType: 'RESPONSIBILITY_REASSIGNED',
        reason: 'تست انتقال معتبر مسئولیت' } });
      await tx.accountingCorrectionRequest.update({ where: { id: correction.id }, data: { assignedToUserId: activeSuccessorId } });
      await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_legacy_reassignment', ${JSON.stringify({
        projectId: crmProject.id, previousSellerId: userId, nextSellerId: activeSuccessorId, actorId,
        reason: 'واگذاری پروژه قدیمی برای تکمیل تبدیل Partner',
      })}, true)`;
      await tx.crmPotentialProject.update({ where: { id: crmProject.id }, data: { responsibleSellerId: activeSuccessorId } });
      await tx.crmTimelineEvent.create({ data: { customerId: customer.id, potentialProjectId: crmProject.id,
        actorId, eventType: 'reassigned', title: 'واگذاری مسئولیت پروژه قدیمی',
        description: 'واگذاری معتبر پیش از فعال‌سازی Partner', metadata: { previousSellerId: userId,
          nextSellerId: activeSuccessorId, reason: 'واگذاری پروژه قدیمی برای تکمیل تبدیل Partner' } } });
      const contractEvidence = `z-contract-disposition-${suffix}`, correctionEvidence = `z-correction-disposition-${suffix}`;
      const crmProjectEvidence = `z-crm-project-disposition-${suffix}`;
      await tx.partnerConversionDisposition.createMany({ data: [
        { id: contractEvidence, profileId, sourceType: 'CONTRACT_RESPONSIBILITY', sourceId: contract.id,
          disposition: 'TRANSFERRED', successorId: activeSuccessorId, actorId, evidence: { approvedBy: actorId } },
        { id: correctionEvidence, profileId, sourceType: 'CORRECTION_REQUEST', sourceId: correction.id,
          disposition: 'TRANSFERRED', successorId: activeSuccessorId, actorId, evidence: { approvedBy: actorId } },
        { id: crmProjectEvidence, profileId, sourceType: 'CRM_PROJECT_RESPONSIBILITY', sourceId: crmProject.id,
          disposition: 'TRANSFERRED', successorId: activeSuccessorId, actorId, evidence: { approvedBy: actorId } },
      ] });
      const resolved = await service.execute(await command(actorId, { type: 'PROFILE_CONVERSION', profileId,
        expectedRevision: 2, transition: 'RESOLVE', dispositionEvidenceIds: [contractEvidence, correctionEvidence,
          crmProjectEvidence] },
      `resolve-${suffix}`));
      assert.equal(resolved.ok, true);
      const lifecycleStore = createPrismaPartnerProfileStore(database);
      const profile = await lifecycleStore.lockProfile(tx, profileId); assert.ok(profile);
      assert.equal((await lifecycleStore.readActivationGates(tx, profile)).conversionCleared, true);
      await tx.user.update({ where: { id: activeSuccessorId }, data: { isActive: false } });
      assert.equal((await lifecycleStore.readActivationGates(tx, profile)).conversionCleared, false,
        'activation must fail closed when a previously accepted successor becomes ineligible');
      throw rollback;
    }, { timeout: 25_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
});
