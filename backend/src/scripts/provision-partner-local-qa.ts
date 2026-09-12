import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { canonicalHash, type PartnerActivationCommandV3 } from '@sabalanerp/partner-sales-contracts';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { grantScopedAction } from '../services/effectiveAuthorization/scopedActions';
import { createPrismaPartnerActivationPackage } from '../services/partnerSales/activationPackage/prisma';
import { acceptanceResponsibilities, readinessGates } from '../services/partnerSales/operations/readiness';
import { PARTNER_OPERATIONS_CONTROL_ID } from '../services/partnerSales/authorization/technicalRollout';

export type LocalPartnerQaProvisioning = {
  subjectUsername: string;
  responderUsername: string;
  releaseId: string;
  schemaId: string;
};

const identityId = (userId: string) => `partner-local-qa-identity-${userId}`;
const commercialPolicyId = 'partner-local-qa-commercial-v1';
const creditPolicyId = 'partner-local-qa-credit-v1';

export async function provisionLocalPartnerQa(database: PrismaClient, input: LocalPartnerQaProvisioning) {
  const [admin, subject, responder] = await Promise.all([
    database.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { id: 'asc' } }),
    database.user.findUnique({ where: { username: input.subjectUsername }, include: { partnerProfile: true } }),
    database.user.findUnique({ where: { username: input.responderUsername } }),
  ]);
  if (!admin || !subject?.isActive || !responder?.isActive || responder.role === 'ADMIN') {
    throw new Error('Active Admin, subject and non-Admin responder accounts are required.');
  }
  if (subject.partnerProfile) throw new Error('The subject already has a Partner profile.');

  const identity = { legalName: `${subject.firstName} ${subject.lastName}`.trim() || subject.username,
    personType: 'NATURAL' as const, identifiers: { localQaReference: subject.username },
    phone: '09170000000', address: 'نشانی نمونه آزمون محلی؛ پیش از استفاده واقعی جایگزین شود' };
  const commercial = { purpose: 'PARTNER_TECHNICAL_PRICING' as const, label: 'شرایط استاندارد آزمون محلی',
    effectiveDate: new Date('2026-01-01T00:00:00.000Z'), terms: { calculationPolicyVersion: 'partner-v1', localQa: true } };
  const credit = { purpose: 'PARTNER_CREDIT_TERMS' as const, label: 'تسویه نقدی آزمون محلی',
    effectiveDate: new Date('2026-01-01T00:00:00.000Z'), terms: { settlementDays: 0, localQa: true } };
  const [identityHash, commercialHash, creditHash] = await Promise.all([
    canonicalHash(identity), canonicalHash({ ...commercial, effectiveDate: commercial.effectiveDate.toISOString().slice(0, 10) }),
    canonicalHash({ ...credit, effectiveDate: credit.effectiveDate.toISOString().slice(0, 10) }),
  ]);

  await database.$transaction(async tx => {
    await tx.partnerIdentityEvidence.upsert({ where: { id: identityId(subject.id) }, update: {}, create: {
      id: identityId(subject.id), userId: subject.id, ...identity, integrityHash: identityHash, issuedBy: admin.id,
    } });
    await tx.partnerTermsPolicy.upsert({ where: { id: commercialPolicyId }, update: {}, create: {
      id: commercialPolicyId, ...commercial, integrityHash: commercialHash, issuedBy: admin.id,
    } });
    await tx.partnerTermsPolicy.upsert({ where: { id: creditPolicyId }, update: {}, create: {
      id: creditPolicyId, ...credit, integrityHash: creditHash, issuedBy: admin.id,
    } });
    const responderGrant = await tx.effectiveActionGrant.findFirst({ where: { principalKind: 'USER',
      principalId: responder.id, domain: 'PARTNER', action: 'INQUIRY_RESPOND', rootKind: 'INQUIRY',
      purpose: 'RESPONDER', scope: 'ASSIGNED', effect: 'ALLOW', revokedAt: null } });
    if (!responderGrant) await grantScopedAction(tx, { actorId: admin.id,
      reason: 'اعطای مجوز پاسخ‌گویی فقط برای آزمون محلی فروش همکار', correlationId: randomUUID() },
    { principal: { kind: 'USER', id: responder.id }, domain: 'PARTNER', action: 'INQUIRY_RESPOND',
      rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'ASSIGNED', effect: 'ALLOW' });
  });

  const now = new Date(), verifiedPackageId = `partner-local-qa-${randomUUID()}`;
  const evidence = { source: 'DATABASE_VERIFIED' as const, evidenceId: verifiedPackageId,
    releaseId: input.releaseId, schemaId: input.schemaId, checkedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
    gates: Object.fromEntries(readinessGates.map(gate => [gate, true])),
    acceptedBy: Object.fromEntries(acceptanceResponsibilities.map(role => [role, `local-qa-${role}`])),
  };
  const control = await database.partnerOperationsControl.findUniqueOrThrow({
    where: { id: PARTNER_OPERATIONS_CONTROL_ID }, select: { revision: true },
  });
  const service = createPrismaPartnerActivationPackage({ database, actorId: admin.id,
    runtimeIdentity: { releaseId: input.releaseId, schemaId: input.schemaId },
    resolveVerifiedReadiness: async (_tx, packageId) => packageId === verifiedPackageId ? evidence : null,
    authorize: async () => ({ ok: true, value: { evidenceId: 'local-qa-provisioning', isAdmin: true } }),
  });
  const intent = { schemaVersion: 3 as const, type: 'RELEASE_READINESS_PUBLISH' as const,
    verifiedPackageId, expectedControlRevision: control.revision,
    reason: 'ثبت آمادگی محدود و موقت برای آزمون محلی فروش همکار' };
  const commandId = randomUUID();
  const command: PartnerActivationCommandV3 = { ...intent, commandId, correlationId: commandId,
    idempotency: { actorId: admin.id, operation: intent.type, targetId: verifiedPackageId,
      key: commandId, payloadHash: await canonicalHash(intent) } };
  const published = await service.execute(command);
  if (!published.ok) throw new Error(`Local QA readiness publication failed: ${published.error.code}`);
  return { subject: subject.username, responder: responder.username, identityId: identityId(subject.id),
    commercialPolicyId, creditPolicyId, expiresAt: evidence.expiresAt };
}

function assertLocalDatabase(raw: string) {
  const url = new URL(raw);
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('This command is restricted to the existing sabalanerp-local database.');
  }
}

async function main() {
  if (process.env.PARTNER_LOCAL_QA_CONFIRM !== 'PROVISION_LOCAL_SAMPLE_ONLY') {
    throw new Error('Set PARTNER_LOCAL_QA_CONFIRM=PROVISION_LOCAL_SAMPLE_ONLY.');
  }
  assertLocalDatabase(process.env.DATABASE_URL || '');
  const result = await provisionLocalPartnerQa(prisma, {
    subjectUsername: process.env.PARTNER_QA_SUBJECT_USERNAME || 'pourshahid',
    responderUsername: process.env.PARTNER_QA_RESPONDER_USERNAME || 'yaghoobi',
    releaseId: process.env.DEPLOYMENT_RELEASE_ID || 'local-partner-qa',
    schemaId: process.env.PARTNER_SCHEMA_ID || 'partner-schema-v1',
  });
  console.log(JSON.stringify({ ok: true, ...result }));
}

if (require.main === module) {
  main().catch(error => { console.error(JSON.stringify({ ok: false, message: String(error?.message || error) }));
    process.exitCode = 1; }).finally(disconnectDatabase);
}
