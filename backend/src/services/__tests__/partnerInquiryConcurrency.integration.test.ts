import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { canonicalHash, partnerError, type InquiryIdentity, type PartnerCommand } from '@sabalanerp/partner-sales-contracts';
import { createPrismaPartnerInquiryService, type PartnerInquiryDependencies } from '../partnerSales/inquiries/service';
import { createAuditedPartnerAuthorization } from '../partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../effectiveAuthorization/audit';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', '4'); url.searchParams.set('pool_timeout', '10'); return url.toString();
}
type Fixture = { prefix: string; partnerId: string; responderId: string; managerId: string; inquiryId: string };

async function setup(database: PrismaClient, state: 'PENDING' | 'REJECTED' = 'PENDING'): Promise<Fixture> {
  const prefix = `inquiry-race-${randomUUID()}`, partnerId = `${prefix}-partner`, responderId = `${prefix}-responder`;
  const managerId = `${prefix}-manager`, inquiryId = `${prefix}-inquiry`;
  await database.$transaction(async tx => {
    await tx.user.createMany({ data: [partnerId, responderId, managerId].map((id, index) => ({ id, username: id,
      email: `${id}@example.invalid`, password: 'not-a-login', firstName: `Race${index}`, lastName: 'Fixture',
      ...(id === responderId || id === managerId ? { role: 'ADMIN' as const } : {}) })) });
    await tx.partnerProfile.create({ data: { id: partnerId, userId: partnerId, state: 'ACTIVE' } });
    await tx.partnerReleaseCohort.create({ data: { id: partnerId, name: partnerId, activationEnabled: true,
      enrollmentPaused: false, operationalPaused: false } });
    await tx.partnerCohortMembership.create({ data: { id: partnerId, profileId: partnerId, cohortId: partnerId,
      actorId: managerId, eligibilityEvidence: { fixture: true } } });
    await tx.partnerInquiry.create({ data: { id: inquiryId, profileId: partnerId, revision: 1, submittedAt: new Date() } });
    await tx.partnerInquiryAssignment.create({ data: { id: `${prefix}-assignment`, inquiryId, revision: 1,
      responderId, actorId: managerId, reason: 'تخصیص تست همزمانی', eligibilityEvidence: { fixture: true } } });
    await tx.partnerInquiryRow.create({ data: { id: `${prefix}-row`, inquiryId, version: 1,
      revision: state === 'REJECTED' ? 2 : 1, outcome: state, configurationHash: `sha256-v1:${'1'.repeat(64)}`,
      definition: { version: 1, configurationRef: { recoveryId: `${prefix}-recovery`, recoveryRevision: 1,
        productRowId: `${prefix}-row` }, identity: identity(partnerId), description: 'سنگ تست همزمانی',
        configuration: [{ label: 'نوع', value: 'آماده' }] } } });
  });
  return { prefix, partnerId, responderId, managerId, inquiryId };
}

async function cleanup(database: PrismaClient, fixture: Fixture) {
  await database.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.partnerCommandOutcome.deleteMany({ where: { targetScope: fixture.inquiryId } });
    await tx.effectiveAuthorizationAudit.deleteMany({ where: { rootId: { in: [fixture.inquiryId, fixture.partnerId] } } });
    await tx.partnerInquiryApproval.deleteMany({ where: { row: { inquiryId: fixture.inquiryId } } });
    await tx.partnerInquiryEvent.deleteMany({ where: { inquiryId: fixture.inquiryId } });
    await tx.partnerInquiryRow.deleteMany({ where: { inquiryId: fixture.inquiryId } });
    await tx.partnerInquiryAssignment.deleteMany({ where: { inquiryId: fixture.inquiryId } });
    await tx.partnerInquiry.delete({ where: { id: fixture.inquiryId } });
    await tx.partnerCohortMembership.deleteMany({ where: { profileId: fixture.partnerId } });
    await tx.partnerReleaseCohort.delete({ where: { id: fixture.partnerId } });
    await tx.partnerProfile.delete({ where: { id: fixture.partnerId } });
    await tx.user.deleteMany({ where: { id: { in: [fixture.partnerId, fixture.responderId, fixture.managerId,
      `${fixture.prefix}-replacement-a`, `${fixture.prefix}-replacement-b`] } } });
  });
}

const identity = (partnerId: string): InquiryIdentity => ({ schemaVersion: 1, partnerSellerId: partnerId,
  catalogProductId: 'catalog-race', family: 'prepared', unit: 'count',
  configuration: [{ key: 'technicalConfigurationHash', value: `sha256-v1:${'2'.repeat(64)}` }],
  materialRateEvidenceId: 'material-race', materialRateHash: `sha256-v1:${'3'.repeat(64)}`,
  components: [], currency: 'IRT', calculationPolicyVersion: 'calculation-v1', roundingPolicyVersion: 'rounding-v2' });

function authorization(actorId: string, purpose: 'PARTNER' | 'RESPONDER' | 'MANAGEMENT', correlationId: string): PartnerInquiryDependencies['authorize'] {
  return async (tx, input) => {
    const port = createAuditedPartnerAuthorization(tx, { actorId, purpose, channel: 'API' },
      { correlationId, ...(input.reason ? { reason: input.reason } : {}) });
    const result = await port.authorize(input.action, input.root); if (!result.ok) return result;
    const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId,
      action: input.action, rootKind: input.root.kind, rootId: input.root.id, purpose, channel: 'API', correlationId, allowed: true });
    return evidence ? { ok: true, value: { evidenceId: evidence.id } }
      : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  };
}

function service(database: PrismaClient, actorId: string, purpose: 'PARTNER' | 'RESPONDER' | 'MANAGEMENT', correlationId: string) {
  return createPrismaPartnerInquiryService({ database, actorId, authorize: authorization(actorId, purpose, correlationId),
    resolveInitialResponder: async () => ({ ok: false, error: partnerError('NOT_ASSIGNED') }),
    resolveResponder: async (_tx, input) => ({ ok: true, value: { responderId: input.responderId, eligibilityEvidence: { fixture: true } } }),
    resolveConfiguration: async (_tx, input) => ({ ok: true, value: { identity: identity(actorId),
      description: 'سنگ تست همزمانی', configuration: [{ label: 'ردیف', value: input.reference.productRowId }] } }) });
}

test('two concurrent successors accept exactly one linear child', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } }); const fixture = await setup(database, 'REJECTED');
  try {
    const make = async (suffix: string): Promise<PartnerCommand> => {
      const rows = [{ rowId: `${fixture.prefix}-${suffix}`, configuration: { recoveryId: `${fixture.prefix}-recovery`, recoveryRevision: 1,
        productRowId: `${fixture.prefix}-${suffix}` }, predecessor: { rowId: `${fixture.prefix}-row`, revision: 2, reason: 'اصلاح همزمانی' } }];
      const intent = { schemaVersion: 1 as const, type: 'INQUIRY_SUBMIT' as const, partnerSellerId: fixture.partnerId, rows };
      return { ...intent, commandId: `${fixture.prefix}-command-${suffix}`, correlationId: `${fixture.prefix}-correlation-${suffix}`,
        idempotency: { actorId: fixture.partnerId, operation: 'INQUIRY_SUBMIT', targetId: fixture.inquiryId,
          key: `${fixture.prefix}-key-${suffix}`, payloadHash: await canonicalHash(intent) } };
    };
    const outcomes = await Promise.all(['a', 'b'].map(async suffix => service(database, fixture.partnerId, 'PARTNER',
      `${fixture.prefix}-auth-${suffix}`).execute(await make(suffix))));
    assert.equal(outcomes.filter(result => result.ok).length, 1);
    assert.equal(outcomes.find(result => !result.ok)?.error.code, 'STATE_CONFLICT');
    assert.equal(await database.partnerInquiryRow.count({ where: { predecessorId: `${fixture.prefix}-row` } }), 1);
  } finally { await cleanup(database, fixture); await database.$disconnect(); }
});

test('two concurrent reassignments accept only the first expected assignment revision', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } }); const fixture = await setup(database);
  try {
    for (const suffix of ['a', 'b']) await database.user.create({ data: { id: `${fixture.prefix}-replacement-${suffix}`,
      username: `${fixture.prefix}-replacement-${suffix}`, email: `${fixture.prefix}-replacement-${suffix}@example.invalid`,
      password: 'not-a-login', firstName: 'Replacement', lastName: suffix, role: 'ADMIN' } });
    const make = async (suffix: string): Promise<PartnerCommand> => {
      const intent = { schemaVersion: 1 as const, type: 'INQUIRY_REASSIGN' as const, inquiryId: fixture.inquiryId,
        expectedAssignmentRevision: 1, responderId: `${fixture.prefix}-replacement-${suffix}`, reason: 'باز‌تخصیص همزمانی' };
      return { ...intent, commandId: `${fixture.prefix}-reassign-${suffix}`, correlationId: `${fixture.prefix}-reassign-${suffix}`,
        idempotency: { actorId: fixture.managerId, operation: 'INQUIRY_REASSIGN', targetId: fixture.inquiryId,
          key: `${fixture.prefix}-reassign-${suffix}`, payloadHash: await canonicalHash(intent) } };
    };
    const manager = service(database, fixture.managerId, 'MANAGEMENT', `${fixture.prefix}-manager-auth`);
    const outcomes = await Promise.all(['a', 'b'].map(async suffix => manager.execute(await make(suffix))));
    assert.equal(outcomes.filter(result => result.ok).length, 1);
    assert.equal(outcomes.find(result => !result.ok)?.error.code, 'ROW_STALE');
  } finally { await cleanup(database, fixture); await database.$disconnect(); }
});

test('profile termination and responder approval have one first-valid commit', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } }); const fixture = await setup(database);
  try {
    const decisions = [{ rowId: `${fixture.prefix}-row`, expectedRevision: 1, outcome: 'APPROVED' as const,
      wholesaleUnitPrice: { amount: '1000000', currency: 'IRT' as const }, note: 'قیمت همزمانی' }];
    const intent = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId: fixture.inquiryId,
      expectedAssignmentRevision: 1, decisions };
    const command = { ...intent, commandId: `${fixture.prefix}-decide`, correlationId: `${fixture.prefix}-decide`,
      idempotency: { actorId: fixture.responderId, operation: 'INQUIRY_DECIDE' as const, targetId: fixture.inquiryId,
        key: `${fixture.prefix}-decide`, payloadHash: await canonicalHash(intent) } };
    const response = service(database, fixture.responderId, 'RESPONDER', `${fixture.prefix}-responder-auth`).execute(command);
    const termination = database.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${fixture.partnerId} FOR UPDATE`;
      await tx.partnerProfile.update({ where: { id: fixture.partnerId }, data: { state: 'TERMINATED', revision: { increment: 1 } } }); });
    const [decision] = await Promise.all([response, termination]);
    const approvalCount = await database.partnerInquiryApproval.count({ where: { rowId: `${fixture.prefix}-row` } });
    assert.equal(decision.ok ? approvalCount === 1 : approvalCount === 0, true);
    if (!decision.ok) assert.ok(['PARTNER_NOT_ACTIVE', 'NOT_FOUND'].includes(decision.error.code));
  } finally { await cleanup(database, fixture); await database.$disconnect(); }
});
