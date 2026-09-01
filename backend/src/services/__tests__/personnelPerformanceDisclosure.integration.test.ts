import assert from 'node:assert/strict';
import { prisma } from '../../lib/prisma';

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
  console.log('Personnel performance disclosure integration tests passed.');
};

main().finally(() => prisma.$disconnect());
