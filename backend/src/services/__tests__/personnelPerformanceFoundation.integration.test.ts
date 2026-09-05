import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';

const rollback = Symbol('rollback');
const aggregateHash = (value: string) => createHash('sha256').update(value).digest('hex');

const runRolledBack = async (test: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>) => {
  try {
    await prisma.$transaction(async (tx) => {
      await test(tx as any);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
};

const main = async () => {
await runRolledBack(async (tx) => {
  const actor = await tx.user.create({
    data: {
      email: 'performance-foundation@example.invalid',
      username: 'performance_foundation_test',
      password: 'not-used',
      firstName: 'عامل',
      lastName: 'آزمون',
    },
  });
  const personnel = await tx.personnel.create({ data: { firstName: 'آزمون', lastName: 'بنیاد عملکرد' } });
  const relationship = await tx.hrEmploymentRelationship.create({
    data: {
      personnelId: personnel.id,
      status: 'ACTIVE',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdBy: 'performance-foundation-test',
    },
  });

  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_subjects" ("id", "stableKey", "nonDisplayKey", "personnelId", "employmentRelationshipId", "createdByUserId") VALUES ($1, $2, $3, $4, $5, $6)`,
    'performance-subject-1', 'subject-stable-1', 'opaque-subject-1', personnel.id, relationship.id, actor.id,
  );

  await assert.rejects(
    tx.$executeRawUnsafe(
      `DELETE FROM "hr_employment_relationships" WHERE "id" = $1`,
      relationship.id,
    ),
    /foreign key constraint/i,
    'performance evidence must restrict deletion of its employment relationship',
  );
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-identity@example.invalid', username: 'performance_identity_test', password: 'not-used', firstName: 'عامل', lastName: 'هویت',
  } });
  const first = await tx.personnel.create({ data: { firstName: 'موضوع', lastName: 'نخست' } });
  const second = await tx.personnel.create({ data: { firstName: 'موضوع', lastName: 'دوم' } });
  const secondRelationship = await tx.hrEmploymentRelationship.create({ data: {
    personnelId: second.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
  } });
  await assert.rejects(tx.$executeRawUnsafe(
    `INSERT INTO "performance_subjects" ("id", "stableKey", "nonDisplayKey", "personnelId", "employmentRelationshipId", "createdByUserId") VALUES ($1, $2, $3, $4, $5, $6)`,
    'performance-subject-mismatch', 'subject-stable-mismatch', 'opaque-subject-mismatch', first.id, secondRelationship.id, actor.id,
  ), /foreign key constraint/i, 'a performance subject cannot pair one Personnel with another Personnel employment relationship');
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-detach@example.invalid', username: 'performance_detach_test', password: 'not-used', firstName: 'عامل', lastName: 'جداسازی',
  } });
  const personnel = await tx.personnel.create({ data: { firstName: 'موضوع', lastName: 'قابل جداسازی' } });
  const relationship = await tx.hrEmploymentRelationship.create({ data: {
    personnelId: personnel.id, status: 'ENDED', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), effectiveTo: new Date('2025-12-31T00:00:00.000Z'), createdBy: actor.id,
  } });
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_subjects" ("id", "stableKey", "nonDisplayKey", "personnelId", "employmentRelationshipId", "createdByUserId") VALUES ($1, $2, $3, $4, $5, $6)`,
    'performance-subject-detach', 'subject-stable-detach', 'opaque-subject-detach', personnel.id, relationship.id, actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_policy_versions" ("id","policyKind","version","contentHash","createdByUserId") VALUES ($1,$2::"PerformancePolicyKind",$3,$4,$5)`,
    'retention-policy-v1', 'RETENTION', 1, 'retention-content-hash', actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_deletion_receipts" ("id", "deletedTableName", "deletedRecordId", "aggregateType", "aggregateIdHash", "scopeHash", "policyVersionId", "reasonCode", "reason", "recordCount", "dependencyEffectHash", "actorUserId", "authorityHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    'identity-detachment-receipt', 'performance_subjects', 'performance-subject-detach', 'PERFORMANCE_SUBJECT', aggregateHash('performance-subject-detach'), 'scope-hash', 'retention-policy-v1', 'AUTHORIZED_IDENTITY_ERASURE', 'حذف مجاز هویت مستقیم', 1, 'dependency-hash', actor.id, 'authority-hash',
  );
  await tx.$executeRawUnsafe(
    `UPDATE "performance_subjects" SET "personnelId" = NULL, "employmentRelationshipId" = NULL, "identityDetachedAt" = $1, "identityDetachedByUserId" = $2, "identityDetachmentReceiptId" = $3 WHERE "id" = $4`,
    new Date('2026-08-31T00:00:00.000Z'), actor.id, 'identity-detachment-receipt', 'performance-subject-detach',
  );
  const rows = await tx.$queryRawUnsafe<Array<{ nonDisplayKey: string; personnelId: string | null }>>(
    `SELECT "nonDisplayKey", "personnelId" FROM "performance_subjects" WHERE "id" = $1`, 'performance-subject-detach',
  );
  assert.deepEqual(rows, [{ nonDisplayKey: 'opaque-subject-detach', personnelId: null }]);
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-retention@example.invalid', username: 'performance_retention_test', password: 'not-used', firstName: 'عامل', lastName: 'نگهداری',
  } });
  const payloadValues = [
    'payload-retention-1', 'SUBMISSION', 'submission-retention-1', 'SUPERVISOR_JUDGMENT', 1,
    'sabalan-personnel-performance', 1, 'aes-256-gcm', 'key-v1', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('ciphertext'), 'a'.repeat(64), 'b'.repeat(64),
  ];
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_encrypted_payloads" ("id","aggregateType","aggregateId","payloadKind","schemaVersion","format","formatVersion","cipher","keyId","iv","authTag","ciphertext","plaintextHash","aadHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    ...payloadValues,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_policy_versions" ("id","policyKind","version","contentHash","createdByUserId") VALUES ($1,$2::"PerformancePolicyKind",$3,$4,$5)`,
    'retention-policy-v1', 'RETENTION', 1, 'retention-content-hash', actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_deletion_receipts" ("id", "deletedTableName", "deletedRecordId", "deletedPayloadId", "aggregateType", "aggregateIdHash", "scopeHash", "policyVersionId", "reasonCode", "reason", "recordCount", "dependencyEffectHash", "actorUserId", "authorityHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    'payload-deletion-receipt', 'performance_encrypted_payloads', 'payload-retention-1', 'payload-retention-1', 'SUBMISSION', aggregateHash('submission-retention-1'), 'scope-hash', 'retention-policy-v1', 'RETENTION_EXPIRED', 'پایان نگهداری محتوای محرمانه', 1, 'dependency-hash', actor.id, 'authority-hash',
  );
  assert.equal(await tx.$executeRawUnsafe(`DELETE FROM "performance_encrypted_payloads" WHERE "id" = $1`, 'payload-retention-1'), 1);
});

await runRolledBack(async (tx) => {
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_encrypted_payloads" ("id","aggregateType","aggregateId","payloadKind","schemaVersion","format","formatVersion","cipher","keyId","iv","authTag","ciphertext","plaintextHash","aadHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    'payload-without-receipt', 'SUBMISSION', 'submission-without-receipt', 'SUPERVISOR_JUDGMENT', 1,
    'sabalan-personnel-performance', 1, 'aes-256-gcm', 'key-v1', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('ciphertext'), 'c'.repeat(64), 'd'.repeat(64),
  );
  await assert.rejects(
    tx.$executeRawUnsafe(`DELETE FROM "performance_encrypted_payloads" WHERE "id" = $1`, 'payload-without-receipt'),
    /requires a matching deletion receipt/i,
    'encrypted evidence deletion must fail closed without a matching receipt',
  );
});

await assert.rejects(
  prisma.$transaction(async (tx) => {
    const actor = await tx.user.create({ data: {
      email: 'performance-stale-receipt@example.invalid', username: 'performance_stale_receipt_test', password: 'not-used', firstName: 'عامل', lastName: 'رسید ناتمام',
    } });
    await tx.$executeRawUnsafe(
      `INSERT INTO "performance_policy_versions" ("id","policyKind","version","contentHash","createdByUserId") VALUES ($1,$2::"PerformancePolicyKind",$3,$4,$5)`,
      'stale-receipt-policy-v1', 'RETENTION', 1, 'stale-receipt-policy-hash', actor.id,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "performance_encrypted_payloads" ("id","aggregateType","aggregateId","payloadKind","schemaVersion","format","formatVersion","cipher","keyId","iv","authTag","ciphertext","plaintextHash","aadHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      'payload-stale-receipt', 'SUBMISSION', 'submission-stale-receipt', 'SUPERVISOR_JUDGMENT', 1,
      'sabalan-personnel-performance', 1, 'aes-256-gcm', 'key-v1', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('ciphertext'), 'e'.repeat(64), 'f'.repeat(64),
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "performance_deletion_receipts" ("id", "deletedTableName", "deletedRecordId", "deletedPayloadId", "aggregateType", "aggregateIdHash", "scopeHash", "policyVersionId", "reasonCode", "reason", "recordCount", "dependencyEffectHash", "actorUserId", "authorityHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      'stale-deletion-receipt', 'performance_encrypted_payloads', 'payload-stale-receipt', 'payload-stale-receipt', 'SUBMISSION', aggregateHash('submission-stale-receipt'), 'scope-hash', 'stale-receipt-policy-v1', 'RETENTION_EXPIRED', 'حذف اجرانشده', 1, 'dependency-hash', actor.id, 'authority-hash',
    );
    await tx.$executeRawUnsafe('SET CONSTRAINTS performance_deletion_receipt_completion IMMEDIATE');
  }),
  /cannot commit before deletion completes/i,
  'a deletion receipt cannot commit unless the governed deletion completed atomically',
);

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-overlap@example.invalid', username: 'performance_overlap_test', password: 'not-used', firstName: 'عامل', lastName: 'همپوشانی',
  } });
  const personnel = await tx.personnel.create({ data: { firstName: 'موضوع', lastName: 'بازه' } });
  const relationship = await tx.hrEmploymentRelationship.create({ data: {
    personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
  } });
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_subjects" ("id", "stableKey", "nonDisplayKey", "personnelId", "employmentRelationshipId", "createdByUserId") VALUES ($1, $2, $3, $4, $5, $6)`,
    'performance-subject-overlap', 'subject-stable-overlap', 'opaque-subject-overlap', personnel.id, relationship.id, actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_evaluations" ("id","stableKey","subjectId","measurementFrom","measurementTo","createdByUserId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`,
    'performance-evaluation-first', 'evaluation-stable-first', 'performance-subject-overlap', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-04-01T00:00:00.000Z'), actor.id,
  );
  await assert.rejects(
    tx.$executeRawUnsafe(
      `INSERT INTO "performance_evaluations" ("id","stableKey","subjectId","measurementFrom","measurementTo","createdByUserId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`,
      'performance-evaluation-overlap', 'evaluation-stable-overlap', 'performance-subject-overlap', new Date('2026-03-01T00:00:00.000Z'), new Date('2026-05-01T00:00:00.000Z'), actor.id,
    ),
    /performance_evaluations_no_active_overlap/i,
    'active evaluation measurement windows must not overlap for the same subject',
  );
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-lifecycle@example.invalid', username: 'performance_lifecycle_test', password: 'not-used', firstName: 'عامل', lastName: 'چرخه',
  } });
  const personnel = await tx.personnel.create({ data: { firstName: 'موضوع', lastName: 'چرخه' } });
  const relationship = await tx.hrEmploymentRelationship.create({ data: {
    personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
  } });
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_subjects" ("id", "stableKey", "nonDisplayKey", "personnelId", "employmentRelationshipId", "createdByUserId") VALUES ($1, $2, $3, $4, $5, $6)`,
    'performance-subject-lifecycle', 'subject-stable-lifecycle', 'opaque-subject-lifecycle', personnel.id, relationship.id, actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_evaluations" ("id","stableKey","subjectId","measurementFrom","measurementTo","createdByUserId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`,
    'performance-evaluation-lifecycle', 'evaluation-stable-lifecycle', 'performance-subject-lifecycle', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-04-01T00:00:00.000Z'), actor.id,
  );
  await assert.rejects(
    tx.$executeRawUnsafe(`UPDATE "performance_evaluations" SET "status" = 'ACCEPTED' WHERE "id" = $1`, 'performance-evaluation-lifecycle'),
    /invalid performance evaluation lifecycle transition/i,
    'an evaluation cannot skip directly from draft to accepted',
  );
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-result-lock@example.invalid', username: 'performance_result_lock_test', password: 'not-used', firstName: 'عامل', lastName: 'نتیجه',
  } });
  const personnel = await tx.personnel.create({ data: { firstName: 'موضوع', lastName: 'نتیجه' } });
  const relationship = await tx.hrEmploymentRelationship.create({ data: {
    personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
  } });
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_subjects" ("id", "stableKey", "nonDisplayKey", "personnelId", "employmentRelationshipId", "createdByUserId") VALUES ($1, $2, $3, $4, $5, $6)`,
    'performance-subject-result', 'subject-stable-result', 'opaque-subject-result', personnel.id, relationship.id, actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_evaluations" ("id","stableKey","subjectId","measurementFrom","measurementTo","createdByUserId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`,
    'performance-evaluation-result', 'evaluation-stable-result', 'performance-subject-result', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-04-01T00:00:00.000Z'), actor.id,
  );
  for (const [id, aggregateType, aggregateId, payloadKind] of [
    ['payload-result-trace', 'EVALUATION', 'performance-evaluation-result', 'CALCULATION_TRACE'],
    ['payload-accepted-result', 'RESULT', 'performance-result-v1', 'ACCEPTED_RESULT'],
  ]) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "performance_encrypted_payloads" ("id","aggregateType","aggregateId","payloadKind","schemaVersion","format","formatVersion","cipher","keyId","iv","authTag","ciphertext","plaintextHash","aadHash") VALUES ($1,$2,$3,$4,1,$5,1,$6,$7,$8,$9,$10,$11,$12)`,
      id, aggregateType, aggregateId, payloadKind, 'sabalan-personnel-performance', 'aes-256-gcm', 'key-v1', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('ciphertext'), aggregateHash(`${id}-plaintext`), aggregateHash(`${id}-aad`),
    );
  }
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_calculation_traces" ("id","evaluationId","traceVersion","contentHash","encryptedPayloadId") VALUES ($1,$2,1,$3,$4)`,
    'performance-trace-v1', 'performance-evaluation-result', 'trace-content-hash', 'payload-result-trace',
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_policy_versions" ("id","policyKind","version","contentHash","createdByUserId") VALUES ($1,'LEVEL_CLASSIFICATION',1,$2,$3)`,
    'level-policy-result-v1', 'level-policy-content-hash', actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_accepted_results" ("id","evaluationId","version","calculationTraceId","encryptedPayloadId","exactScoreHash","levelCode","levelPolicyVersionId","acceptedByUserId","expiresAt") VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9)`,
    'performance-result-v1', 'performance-evaluation-result', 'performance-trace-v1', 'payload-accepted-result', 'exact-score-hash', 'MEETS_EXPECTATIONS', 'level-policy-result-v1', actor.id, new Date('2027-01-01T00:00:00.000Z'),
  );
  await assert.rejects(
    tx.$executeRawUnsafe(`UPDATE "performance_accepted_results" SET "levelCode" = $1 WHERE "id" = $2`, 'OUTSTANDING', 'performance-result-v1'),
    /result evidence is immutable/i,
    'accepted result content remains immutable while lifecycle status may advance',
  );
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-policy-lock@example.invalid', username: 'performance_policy_lock_test', password: 'not-used', firstName: 'عامل', lastName: 'سیاست',
  } });
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_policy_versions" ("id","policyKind","version","contentHash","createdByUserId") VALUES ($1,$2::"PerformancePolicyKind",$3,$4,$5)`,
    'locked-policy-v1', 'SCORING', 1, 'content-hash-v1', actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_encrypted_payloads" ("id","aggregateType","aggregateId","payloadKind","schemaVersion","format","formatVersion","cipher","keyId","iv","authTag","ciphertext","plaintextHash","aadHash") VALUES ($1,'POLICY_ACTIVATION_PREVIEW',$2,'POLICY_ACTIVATION_PREVIEW_RESULT',1,$3,1,$4,$5,$6,$7,$8,$9,$10)`,
    'locked-policy-preview-payload', 'locked-policy-preview-v1', 'sabalan-personnel-performance', 'aes-256-gcm', 'key-v1', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('ciphertext'), aggregateHash('locked-policy-preview-result'), aggregateHash('locked-policy-preview-aad'),
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_policy_activation_previews" ("id","policyVersionId","policyContentHash","populationHash","encryptedPayloadId","eligibleSubjectCount","evaluatedSubjectCount","increasedCount","decreasedCount","unchangedCount","expiredCount","needsNewEvaluationCount","errorCount","resultHash","generatedAt","confirmedAt","confirmedByUserId") VALUES ($1,$2,$3,$4,$5,25,25,5,4,10,3,3,0,$6,CURRENT_TIMESTAMP - INTERVAL '1 millisecond',CURRENT_TIMESTAMP - INTERVAL '1 millisecond',$7)`,
    'locked-policy-preview-v1', 'locked-policy-v1', 'content-hash-v1', 'population-hash', 'locked-policy-preview-payload', aggregateHash('locked-policy-preview-result'), actor.id,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "performance_policy_versions" SET "lifecycle" = 'SCHEDULED', "effectiveFrom" = CURRENT_TIMESTAMP - INTERVAL '1 millisecond', "publicationReason" = $1, "publishedByUserId" = $2, "publishedAt" = CURRENT_TIMESTAMP - INTERVAL '1 millisecond', "activationPreviewId" = $3, "activationPreviewHash" = $4, "activationConfirmedAt" = CURRENT_TIMESTAMP - INTERVAL '1 millisecond' WHERE "id" = $5`,
    'انتشار آزمون', actor.id, 'locked-policy-preview-v1', aggregateHash('locked-policy-preview-result'), 'locked-policy-v1',
  );
  await tx.$executeRawUnsafe(
    `UPDATE "performance_policy_versions" SET "lifecycle" = 'ACTIVE' WHERE "id" = $1`,
    'locked-policy-v1',
  );
  await assert.rejects(
    tx.$executeRawUnsafe(`UPDATE "performance_policy_versions" SET "contentHash" = $1 WHERE "id" = $2`, 'rewritten-content', 'locked-policy-v1'),
    /published performance version is immutable/i,
  );
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-policy-path@example.invalid', username: 'performance_policy_path_test', password: 'not-used', firstName: 'عامل', lastName: 'انتشار',
  } });
  await assert.rejects(
    tx.$executeRawUnsafe(
      `INSERT INTO "performance_policy_versions" ("id","policyKind","version","lifecycle","effectiveFrom","contentHash","publicationReason","publishedByUserId","publishedAt","activationPreviewHash","activationConfirmedAt","createdByUserId") VALUES ($1,'SCORING',1,'ACTIVE',$2,$3,$4,$5,$2,$6,$2,$5)`,
      'policy-invalid-direct-active', new Date('2026-08-30T00:00:00.000Z'), 'content-hash', 'نشر مستقیم', actor.id, 'preview-hash',
    ),
    /must begin as drafts/i,
    'published policies cannot bypass draft, preview, and scheduling',
  );
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-policy-retroactive@example.invalid', username: 'performance_policy_retroactive_test', password: 'not-used', firstName: 'عامل', lastName: 'اثر سیاست',
  } });
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_policy_versions" ("id","policyKind","version","contentHash","createdByUserId") VALUES ($1,'LEVEL_CLASSIFICATION',1,$2,$3)`,
    'retroactive-policy-v1', 'retroactive-content-hash', actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_encrypted_payloads" ("id","aggregateType","aggregateId","payloadKind","schemaVersion","format","formatVersion","cipher","keyId","iv","authTag","ciphertext","plaintextHash","aadHash") VALUES ($1,'POLICY_ACTIVATION_PREVIEW',$2,'POLICY_ACTIVATION_PREVIEW_RESULT',1,$3,1,$4,$5,$6,$7,$8,$9,$10)`,
    'retroactive-policy-preview-payload', 'retroactive-policy-preview-v1', 'sabalan-personnel-performance', 'aes-256-gcm', 'key-v1', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('ciphertext'), aggregateHash('retroactive-policy-preview-result'), aggregateHash('retroactive-policy-preview-aad'),
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_policy_activation_previews" ("id","policyVersionId","policyContentHash","populationHash","encryptedPayloadId","eligibleSubjectCount","evaluatedSubjectCount","increasedCount","decreasedCount","unchangedCount","expiredCount","needsNewEvaluationCount","errorCount","resultHash","generatedAt","confirmedAt","confirmedByUserId") VALUES ($1,$2,$3,$4,$5,10,10,2,2,4,1,1,0,$6,CURRENT_TIMESTAMP - INTERVAL '2 minutes',CURRENT_TIMESTAMP - INTERVAL '2 minutes',$7)`,
    'retroactive-policy-preview-v1', 'retroactive-policy-v1', 'retroactive-content-hash', 'population-hash', 'retroactive-policy-preview-payload', aggregateHash('retroactive-policy-preview-result'), actor.id,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "performance_policy_versions" SET "lifecycle" = 'SCHEDULED', "effectiveFrom" = CURRENT_TIMESTAMP - INTERVAL '2 minutes', "publicationReason" = $1, "publishedByUserId" = $2, "publishedAt" = CURRENT_TIMESTAMP - INTERVAL '2 minutes', "activationPreviewId" = $3, "activationPreviewHash" = $4, "activationConfirmedAt" = CURRENT_TIMESTAMP - INTERVAL '2 minutes' WHERE "id" = $5`,
    'آزمون اثر عقب‌گرد', actor.id, 'retroactive-policy-preview-v1', aggregateHash('retroactive-policy-preview-result'), 'retroactive-policy-v1',
  );
  await tx.$executeRawUnsafe(
    `UPDATE "performance_policy_versions" SET "lifecycle" = 'ACTIVE' WHERE "id" = $1`,
    'retroactive-policy-v1',
  );
  const activated = await tx.performancePolicyVersion.findUniqueOrThrow({ where: { id: 'retroactive-policy-v1' } });
  assert.equal(
    activated.lifecycle,
    'ACTIVE',
    'a due policy remains activatable after the bounded tolerance so maintenance can recover a missed activation',
  );
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-positive-version@example.invalid', username: 'performance_positive_version_test', password: 'not-used', firstName: 'عامل', lastName: 'نسخه',
  } });
  await assert.rejects(
    tx.$executeRawUnsafe(
      `INSERT INTO "performance_policy_versions" ("id","policyKind","version","contentHash","createdByUserId") VALUES ($1,'SCORING',0,$2,$3)`,
      'policy-version-zero', 'content-hash', actor.id,
    ),
    /version must be positive/i,
    'version lineage cannot start at zero or a negative number',
  );
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-lineage@example.invalid', username: 'performance_lineage_test', password: 'not-used', firstName: 'عامل', lastName: 'تبار',
  } });
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_policy_versions" ("id","policyKind","version","contentHash","createdByUserId") VALUES ($1,$2::"PerformancePolicyKind",$3,$4,$5)`,
    'lineage-policy-v1', 'SCORING', 1, 'lineage-content-v1', actor.id,
  );
  await assert.rejects(
    tx.$executeRawUnsafe(
      `INSERT INTO "performance_policy_versions" ("id","policyKind","version","predecessorId","contentHash","createdByUserId") VALUES ($1,$2::"PerformancePolicyKind",$3,$4,$5,$6)`,
      'lineage-policy-v3', 'SCORING', 3, 'lineage-policy-v1', 'lineage-content-v3', actor.id,
    ),
    /immediately previous version/i,
    'version lineage cannot skip a version or form an unordered chain',
  );
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-legal-hold@example.invalid', username: 'performance_legal_hold_test', password: 'not-used', firstName: 'عامل', lastName: 'توقف حقوقی',
  } });
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_policy_versions" ("id","policyKind","version","contentHash","createdByUserId") VALUES ($1,$2::"PerformancePolicyKind",$3,$4,$5)`,
    'retention-policy-v1', 'RETENTION', 1, 'retention-content-hash', actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_legal_holds" ("id","aggregateType","aggregateId","aggregateIdHash","version","status","reason","placedByUserId") VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7)`,
    'legal-hold-1', 'SUBMISSION', 'submission-1', 'held-aggregate-hash', 1, 'رسیدگی حقوقی فعال', actor.id,
  );
  await assert.rejects(tx.$executeRawUnsafe(
    `INSERT INTO "performance_deletion_receipts" ("id", "deletedTableName", "deletedRecordId", "aggregateType", "aggregateIdHash", "scopeHash", "policyVersionId", "reasonCode", "reason", "recordCount", "dependencyEffectHash", "actorUserId", "authorityHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    'blocked-deletion-receipt', 'performance_submissions', 'submission-1', 'SUBMISSION', 'held-aggregate-hash', 'scope-hash', 'retention-policy-v1', 'RETENTION_EXPIRED', 'پایان نگهداری', 1, 'dependency-hash', actor.id, 'authority-hash',
  ), /active legal hold/i, 'an active legal hold must fail closed before a deletion receipt can authorize removal');
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-late-hold@example.invalid', username: 'performance_late_hold_test', password: 'not-used', firstName: 'عامل', lastName: 'توقف مؤخر',
  } });
  const aggregateId = 'submission-late-hold';
  const hash = aggregateHash(aggregateId);
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_policy_versions" ("id","policyKind","version","contentHash","createdByUserId") VALUES ($1,$2::"PerformancePolicyKind",$3,$4,$5)`,
    'late-hold-policy-v1', 'RETENTION', 1, 'late-hold-policy-hash', actor.id,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_encrypted_payloads" ("id","aggregateType","aggregateId","payloadKind","schemaVersion","format","formatVersion","cipher","keyId","iv","authTag","ciphertext","plaintextHash","aadHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    'payload-late-hold', 'SUBMISSION', aggregateId, 'SUPERVISOR_JUDGMENT', 1,
    'sabalan-personnel-performance', 1, 'aes-256-gcm', 'key-v1', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('ciphertext'), '1'.repeat(64), '2'.repeat(64),
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_deletion_receipts" ("id", "deletedTableName", "deletedRecordId", "deletedPayloadId", "aggregateType", "aggregateIdHash", "scopeHash", "policyVersionId", "reasonCode", "reason", "recordCount", "dependencyEffectHash", "actorUserId", "authorityHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    'late-hold-receipt', 'performance_encrypted_payloads', 'payload-late-hold', 'payload-late-hold', 'SUBMISSION', hash, 'scope-hash', 'late-hold-policy-v1', 'RETENTION_EXPIRED', 'پایان نگهداری', 1, 'dependency-hash', actor.id, 'authority-hash',
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_legal_holds" ("id","aggregateType","aggregateId","aggregateIdHash","version","reason","placedByUserId") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    'late-legal-hold', 'SUBMISSION', aggregateId, hash, 1, 'توقف پس از صدور رسید', actor.id,
  );
  await assert.rejects(
    tx.$executeRawUnsafe(`DELETE FROM "performance_encrypted_payloads" WHERE "id" = $1`, 'payload-late-hold'),
    /active legal hold/i,
    'a legal hold created after a receipt still blocks the later deletion',
  );
});

await runRolledBack(async (tx) => {
  const actor = await tx.user.create({ data: {
    email: 'performance-hold-scope@example.invalid', username: 'performance_hold_scope_test', password: 'not-used', firstName: 'عامل', lastName: 'دامنه توقف',
  } });
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_legal_holds" ("id","aggregateType","aggregateId","aggregateIdHash","version","reason","placedByUserId") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    'immutable-hold-scope', 'SUBMISSION', 'submission-protected', aggregateHash('submission-protected'), 1, 'توقف دامنه‌دار', actor.id,
  );
  await assert.rejects(
    tx.$executeRawUnsafe(`UPDATE "performance_legal_holds" SET "aggregateIdHash" = $1 WHERE "id" = $2`, aggregateHash('different-submission'), 'immutable-hold-scope'),
    /legal hold scope is immutable/i,
    'an active hold cannot be moved away from its protected evidence',
  );
});

await runRolledBack(async (tx) => {
  await tx.$executeRawUnsafe(
    `INSERT INTO "performance_audit_events" ("id", "aggregateType", "aggregateId", "eventType", "eventHash", "occurredAt") VALUES ($1, $2, $3, $4, $5, $6)`,
    'performance-audit-1', 'SUBJECT', 'subject-1', 'CREATED', 'audit-hash-1', new Date('2026-08-31T00:00:00.000Z'),
  );
  await assert.rejects(
    tx.$executeRawUnsafe(`UPDATE "performance_audit_events" SET "eventType" = $1 WHERE "id" = $2`, 'CHANGED', 'performance-audit-1'),
    /append-only/i,
    'performance audit rows must be append-only in PostgreSQL',
  );
});

console.log('Personnel performance foundation integration tests passed.');
};

main().finally(() => prisma.$disconnect());
