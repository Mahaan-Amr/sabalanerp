import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../../lib/prisma';
import { cleanupExpiredPerformanceExports, listEligibleConsequenceResults } from '../personnelPerformanceDisclosureStore';
import { publishCompensationAgreement } from '../hrCompensationAgreementStore';

const seed = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], marker: string) => {
      const suffix = Date.now().toString(36);
      const actor = await tx.user.create({ data: {
        email: `performance-disclosure-${suffix}@example.invalid`,
        username: `performance_disclosure_${suffix}`,
        password: 'not-used', firstName: 'عامل', lastName: 'افشا',
      } });
      const personnel = await tx.personnel.create({ data: { firstName: 'پرسنل', lastName: 'ارجاع' } });
      const relationship = await tx.hrEmploymentRelationship.create({ data: {
        personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
      } });
      const subject = await tx.performanceSubject.create({ data: {
        stableKey: `subject-${suffix}`, nonDisplayKey: `opaque-${suffix}`, personnelId: personnel.id,
        employmentRelationshipId: relationship.id, createdByUserId: actor.id,
      } });
      const payload = (id: string) => tx.performanceEncryptedPayload.create({ data: {
        id, aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: id, payloadKind: 'IMMUTABLE_HANDOFF', schemaVersion: 1,
        format: 'sabalan-personnel-performance', formatVersion: 1, cipher: 'aes-256-gcm', keyId: 'test-v1',
        iv: Buffer.alloc(12), authTag: Buffer.alloc(16), ciphertext: Buffer.from('encrypted'), plaintextHash: 'a'.repeat(64), aadHash: 'b'.repeat(64),
      } });
      const firstPayload = await payload(`handoff-payload-a-${suffix}`);
      const handoff = await tx.performanceConsequenceHandoff.create({ data: {
        subjectId: subject.id, personnelId: personnel.id, employmentRelationshipId: relationship.id,
        consequenceType: 'COMPENSATION_REVIEW', policyCycleKey: '1405', reasonCategory: 'SUSTAINED_CONTRIBUTION',
        reason: 'بازبینی جبران خدمت بر پایه نتیجه مصوب و شاهد مستقل', encryptedPayloadId: firstPayload.id,
        snapshotHash: 'snapshot-a', createdByUserId: actor.id,
      } });
      return { tx, suffix, actor, personnel, relationship, subject, payload, handoff, marker };
};

const main = async () => {
  await assert.rejects(prisma.$transaction(async (tx) => {
    const { actor, relationship, suffix } = await seed(tx, 'publish-agreement');
    const input = {
      actorUserId: actor.id, employmentRelationshipId: relationship.id,
      components: [{ title: 'حقوق پایه', amountRials: '100' }], payRangeMinimumRials: '50', payRangeMaximumRials: '200',
      budgetCode: 'TEST', budgetAvailableRials: '1000', approvalReason: 'انتشار توافق با تأیید مستقل و بودجه معتبر آزمون',
    };
    await assert.rejects(() => publishCompensationAgreement(tx, input), (error: any) => error.status === 403);
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: `${suffix}:agreement-publisher`, userId: actor.id, featureCode: 'MANAGE_COMPENSATION_AGREEMENTS',
      level: 'ADMIN', effectiveFrom: new Date('2020-01-01'), grantedByUserId: actor.id, reason: 'Isolated agreement publication test',
    } });
    const agreement = await publishCompensationAgreement(tx, input);
    assert.equal(agreement.status, 'ACTIVE');
    assert.equal(agreement.totalRials.toString(), '100');
    assert.equal(agreement.approvedByUserId, actor.id);
    throw new Error('ROLLBACK_AGREEMENT_PUBLICATION');
  }), /ROLLBACK_AGREEMENT_PUBLICATION/);
  await assert.rejects(prisma.$transaction(async (tx) => {
    const { actor, relationship } = await seed(tx, 'agreement');
    const agreement = await tx.hrCompensationAgreement.create({ data: {
      employmentRelationshipId: relationship.id, version: 1, effectiveFrom: new Date('2026-01-01'),
      componentsJson: [], totalRials: 100, payRangeMinimumRials: 50, payRangeMaximumRials: 200,
      budgetCode: 'TEST', budgetAvailableRials: 1000, legalControlStatus: 'APPROVED',
      contentHash: 'a'.repeat(64), createdByUserId: actor.id, approvedByUserId: actor.id, approvedAt: new Date('2025-12-01'),
    } });
    await tx.hrCompensationAgreement.update({ where: { id: agreement.id }, data: { status: 'SCHEDULED' } });
    await tx.hrCompensationAgreement.update({ where: { id: agreement.id }, data: { status: 'ACTIVE' } });
    await tx.hrCompensationAgreement.update({ where: { id: agreement.id }, data: { effectiveTo: new Date('2026-12-31') } });
    throw new Error('AGREEMENT_MUTATION_WAS_NOT_REJECTED');
  }), /immutable/i, 'an active agreement cannot silently change its effective interval');
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const seeded = await seed(tx, 'immutable');
      await tx.performanceConsequenceHandoff.update({ where: { id: seeded.handoff.id }, data: { reason: 'بازنویسی غیرمجاز شاهد ارجاع' } });
    }),
    /immutable/i,
    'submitted consequence evidence must remain immutable',
  );
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const seeded = await seed(tx, 'unique');
      const secondPayload = await seeded.payload(`handoff-payload-b-${seeded.suffix}`);
      await tx.performanceConsequenceHandoff.create({ data: {
          subjectId: seeded.subject.id, personnelId: seeded.personnel.id, employmentRelationshipId: seeded.relationship.id,
          consequenceType: 'COMPENSATION_REVIEW', policyCycleKey: '1405', reasonCategory: 'SECOND_REQUEST',
          reason: 'ارجاع فعال رقیب نباید برای همان چرخه ثبت شود', encryptedPayloadId: secondPayload.id,
          snapshotHash: 'snapshot-b', createdByUserId: seeded.actor.id,
        } });
    }),
    /unique constraint/i,
    'only one active handoff may exist for a relationship, consequence type, and policy cycle',
  );
  await assert.rejects(prisma.$transaction(async (tx) => {
    const suffix = `${Date.now().toString(36)}-scope`;
    const actor = await tx.user.create({ data: { email: `${suffix}@example.invalid`, username: suffix, password: 'not-used', firstName: 'عامل', lastName: 'محدوده' } });
    const personnelA = await tx.personnel.create({ data: { firstName: 'الف', lastName: 'محدوده' } });
    const personnelB = await tx.personnel.create({ data: { firstName: 'ب', lastName: 'محدوده' } });
    await tx.hrNamedResponsibility.create({ data: {
      stableKey: `performance-consequence-scope-${suffix}`,
      responsibilityTypeCode: 'PERFORMANCE_CONSEQUENCE_COMPENSATION_REVIEW', scopeType: 'PERSONNEL', scopeId: personnelA.id,
      assignedUserId: actor.id, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), reason: 'آزمون محدوده مستقل', createdByUserId: actor.id,
    } });
    assert.deepEqual(await listEligibleConsequenceResults(tx as any, { personnelId: personnelA.id, actorUserId: actor.id, consequenceType: 'COMPENSATION_REVIEW' }), []);
    await assert.rejects(
      () => listEligibleConsequenceResults(tx as any, { personnelId: personnelB.id, actorUserId: actor.id, consequenceType: 'COMPENSATION_REVIEW' }),
      (error: any) => error?.code === 'PERFORMANCE_CONSEQUENCE_SCOPE_FORBIDDEN',
      'named responsibility must not authorize another Personnel',
    );
    assert.ok(await tx.performanceAuditEvent.findFirst({ where: { actorUserId: actor.id, eventType: 'CONSEQUENCE_HANDOFF_SCOPE_DENIED' } }), 'scoped authority denial must be audited');
    throw new Error('ROLLBACK_SCOPED_AUTHORITY_TEST');
  }), /ROLLBACK_SCOPED_AUTHORITY_TEST/);

  const exportSuffix = `${Date.now().toString(36)}-export`;
  const exportId = `export-${exportSuffix}`;
  const payloadId = `payload-${exportSuffix}`;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'performance-export-test-'));
  const artifactPath = path.join(temporaryDirectory, 'artifact.enc');
  await writeFile(artifactPath, Buffer.from('encrypted-artifact'));
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const exportUser = await tx.user.create({ data: { email: `${exportSuffix}@example.invalid`, username: exportSuffix, password: 'not-used', firstName: 'عامل', lastName: 'خروجی' } });
      const cleanupAt = new Date();
      let retentionPolicy = await tx.performancePolicyVersion.findFirst({
        where: { policyKind: 'RETENTION', lifecycle: 'ACTIVE', effectiveFrom: { lte: cleanupAt } },
      });
      if (!retentionPolicy) {
        const policyAt = new Date(cleanupAt.getTime() - 10_000);
        const policyId = `retention-${exportSuffix}`;
        const previewId = `retention-preview-${exportSuffix}`;
        const previewPayloadId = `retention-preview-payload-${exportSuffix}`;
        const resultHash = 'e'.repeat(64);
        const latestRetention = await tx.performancePolicyVersion.findFirst({ where: { policyKind: 'RETENTION' }, orderBy: { version: 'desc' } });
        await tx.performancePolicyVersion.create({ data: {
          id: policyId, policyKind: 'RETENTION', version: (latestRetention?.version ?? 0) + 1,
          predecessorId: latestRetention?.id, contentHash: 'retention-policy-v1', createdByUserId: exportUser.id,
        } });
        await tx.performanceEncryptedPayload.create({ data: {
          id: previewPayloadId, aggregateType: 'POLICY_ACTIVATION_PREVIEW', aggregateId: previewId, payloadKind: 'POPULATION_RESULT', schemaVersion: 1,
          format: 'sabalan-personnel-performance', formatVersion: 1, cipher: 'aes-256-gcm', keyId: 'test-v1',
          iv: Buffer.alloc(12), authTag: Buffer.alloc(16), ciphertext: Buffer.from('encrypted'), plaintextHash: resultHash, aadHash: 'f'.repeat(64),
        } });
        await tx.performancePolicyActivationPreview.create({ data: {
          id: previewId, policyVersionId: policyId, policyContentHash: 'retention-policy-v1', populationHash: resultHash,
          encryptedPayloadId: previewPayloadId, eligibleSubjectCount: 0, evaluatedSubjectCount: 0, increasedCount: 0,
          decreasedCount: 0, unchangedCount: 0, expiredCount: 0, needsNewEvaluationCount: 0, errorCount: 0,
          resultHash, generatedAt: policyAt, confirmedAt: policyAt, confirmedByUserId: exportUser.id,
        } });
        await tx.performancePolicyVersion.update({ where: { id: policyId }, data: {
          lifecycle: 'SCHEDULED', effectiveFrom: policyAt, publicationReason: 'آزمون پاک‌سازی خروجی',
          publishedByUserId: exportUser.id, publishedAt: policyAt, activationPreviewId: previewId,
          activationPreviewHash: resultHash, activationConfirmedAt: policyAt,
        } });
        retentionPolicy = await tx.performancePolicyVersion.update({ where: { id: policyId }, data: { lifecycle: 'ACTIVE' } });
      }
      assert.ok(retentionPolicy, 'cleanup requires an active retention policy');
      await tx.performanceEncryptedPayload.create({ data: {
        id: payloadId, aggregateType: 'PERFORMANCE_EXPORT', aggregateId: exportId, payloadKind: 'SCOPE_SNAPSHOT', schemaVersion: 1,
        format: 'sabalan-personnel-performance', formatVersion: 1, cipher: 'aes-256-gcm', keyId: 'test-v1',
        iv: Buffer.alloc(12), authTag: Buffer.alloc(16), ciphertext: Buffer.from('encrypted'), plaintextHash: 'c'.repeat(64), aadHash: 'd'.repeat(64),
      } });
      await tx.performanceExportReceipt.create({ data: {
        id: exportId, requestedByUserId: exportUser.id, exportKind: 'XLSX', scopeHash: 'scope', permissionHash: 'permission',
        status: 'QUEUED', encryptedPayloadId: payloadId, artifactPath, artifactHash: 'artifact-hash', expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      } });
      assert.equal(await cleanupExpiredPerformanceExports(tx, cleanupAt), 1);
      await assert.rejects(() => access(artifactPath));
      const cleaned = await tx.performanceExportReceipt.findUniqueOrThrow({ where: { id: exportId } });
      assert.equal(cleaned.status, 'DELETED');
      assert.equal(cleaned.encryptedPayloadId, null, 'full report payload must be redacted at cleanup');
      assert.equal(await tx.performanceEncryptedPayload.findUnique({ where: { id: payloadId } }), null);
      assert.ok(await tx.performanceDeletionReceipt.findFirst({ where: { deletedPayloadId: payloadId, reasonCode: 'PERFORMANCE_EXPORT_TTL_CLEANUP' } }));
      assert.ok(await tx.performanceAuditEvent.findFirst({ where: { aggregateId: exportId, eventType: 'PERFORMANCE_EXPORT_CLEANED_UP' } }));
      throw new Error('ROLLBACK_EXPORT_CLEANUP_TEST');
    }), /ROLLBACK_EXPORT_CLEANUP_TEST/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  console.log('Personnel performance disclosure integration tests passed.');
};

main().finally(() => prisma.$disconnect());
