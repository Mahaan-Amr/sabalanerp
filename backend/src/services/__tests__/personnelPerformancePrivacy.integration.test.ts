import { enablePerformanceTestRelease, enrollPerformanceTestCohort, publishPerformanceTestRetentionPolicy } from './personnelPerformanceTestRelease';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { restrictPerformanceEvidence, activePerformanceRestrictionIds } from '../personnelPerformanceRestrictions';
import { placePerformanceLegalHold, decidePerformanceLegalHold } from '../personnelPerformanceLegalHoldStore';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claimPerformanceExportDownload, encryptPerformanceExportArtifact, getPerformanceConsequenceHandoff } from '../personnelPerformanceDisclosureStore';
import { persistPerformancePayload, performanceVaultKeyFromEnvironment } from '../personnelPerformancePayloadStore';
import { assessPerformanceEvaluationRetention } from '../personnelPerformanceRetentionStore';
import { prisma } from '../../lib/prisma';
import { requestPerformancePrivacy, getPerformancePrivacyCase, actOnPerformancePrivacyCase, listPerformancePrivacyQueue, runPerformancePrivacyDeadlineNotifications } from '../personnelPerformancePrivacyStore';

const rollback = Symbol('privacy-test');
const main = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-privacy-'));
  try {
    await prisma.$transaction(async (tx) => {
      const suffix = randomUUID();
      const person = await tx.personnel.create({ data: { firstName: 'آزمون', lastName: 'حریم خصوصی' } });
      const actor = await tx.user.create({ data: { email: `${suffix}@example.invalid`, username: suffix, password: 'not-used', firstName: 'آزمون', lastName: 'درخواست', personnelId: person.id } });
  await enablePerformanceTestRelease(tx, actor.id);
      const other = await tx.user.create({ data: { email: `${suffix}-other@example.invalid`, username: `${suffix}-other`, password: 'not-used', firstName: 'عامل', lastName: 'دیگر' } });
      const relationship = await tx.hrEmploymentRelationship.create({ data: { personnelId: person.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01Z'), createdBy: actor.id } });
      const subject = await tx.performanceSubject.create({ data: { stableKey: suffix, nonDisplayKey: suffix, personnelId: person.id, employmentRelationshipId: relationship.id, createdByUserId: actor.id } });
      const request = await requestPerformancePrivacy(tx, { actorUserId: actor.id, subjectId: subject.id, requestKind: 'ACCESS', evaluationIds: [], reason: 'درخواست دسترسی به سابقه شخصی', now: new Date('2026-09-05T08:00:00Z') });
      assert.equal(request.status, 'RECEIVED');
      assert.ok(await tx.notificationEvent.findUnique({ where: { deduplicationKey: `performance-privacy-request:${request.id}` } }),
        'privacy intake must notify the subject through the durable outbox');
      const own = await getPerformancePrivacyCase(tx, actor.id, request.id);
      assert.equal(own.requestKind, 'ACCESS');
      assert.equal(own.response, null);
      assert.equal(typeof own.disclosureReceiptId, 'string', 'authorized case reads return their audit receipt');
      await assert.rejects(() => getPerformancePrivacyCase(tx, other.id, request.id), (error: { code?: string }) => error.code === 'PERFORMANCE_PRIVACY_UNAVAILABLE');
      await assert.rejects(() => actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: request.id, expectedVersion: 1, action: 'ACKNOWLEDGE', reasonCode: 'REQUEST_RECEIVED' }));
      for (const featureCode of ['ACKNOWLEDGE_PERFORMANCE_PRIVACY_CASE','VERIFY_PERFORMANCE_PRIVACY_IDENTITY','DECIDE_PERFORMANCE_PRIVACY_ACCESS','RESTRICT_PERFORMANCE_EVIDENCE','VIEW_PERFORMANCE_PRIVACY_CASE','DECIDE_PERFORMANCE_ERASURE','MANAGE_PERFORMANCE_RETENTION','DECIDE_PERFORMANCE_PRIVACY_CORRECTION']) {
        await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:${featureCode}`, userId: other.id, featureCode, level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated privacy test' } });
      }
      await assert.rejects(() => listPerformancePrivacyQueue(tx, { actorUserId: actor.id }),
        (error: { code?: string }) => error.code === 'PERFORMANCE_PRIVACY_UNAVAILABLE', 'subject ownership does not grant the reviewer work queue');
      const queue = await listPerformancePrivacyQueue(tx, { actorUserId: other.id });
      assert.ok(queue.items.some((item) => item.id === request.id && item.nextAction === 'ACKNOWLEDGE'));
      assert.equal('request' in queue.items[0], false, 'queue does not duplicate confidential request payloads');
      assert.equal(typeof queue.disclosureReceiptId, 'string');
      const deadlineNotices = await runPerformancePrivacyDeadlineNotifications(tx, new Date('2026-09-08T08:00:00Z'));
      assert.equal(deadlineNotices.cases, 1);
      assert.ok(deadlineNotices.notifications >= 1);
      await assert.rejects(() => requestPerformancePrivacy(tx, { actorUserId: other.id, subjectId: subject.id, requestKind: 'ACCESS', evaluationIds: [], reason: 'درخواست بدون اختیار ثبت' }));
      const acknowledged = await actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: request.id, expectedVersion: 1, action: 'ACKNOWLEDGE', reasonCode: 'REQUEST_RECEIVED' });
      assert.equal(acknowledged.status, 'ACKNOWLEDGED');
      const verified = await actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: request.id, expectedVersion: 2, action: 'VERIFY', reasonCode: 'IDENTITY_AND_SCOPE_VERIFIED' });
      assert.equal(verified.status, 'VERIFIED');
      const extended = await actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: request.id, expectedVersion: 3, action: 'EXTEND', reasonCode: 'ADDITIONAL_SCOPE_REVIEW' });
      assert.equal(extended.extensionCount, 1);
      await assert.rejects(() => actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: request.id, expectedVersion: 4, action: 'EXTEND', reasonCode: 'ADDITIONAL_SCOPE_REVIEW' }), (error: { code?: string }) => error.code === 'PERFORMANCE_PRIVACY_TRANSITION_INVALID');
      await actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: request.id, expectedVersion: 4, action: 'RESPOND', reasonCode: 'ACCESS_STRUCTURED_RESPONSE' });
      const answered = await getPerformancePrivacyCase(tx, actor.id, request.id);
      assert.equal(answered.status, 'RESPONDED');
      assert.deepEqual(answered.response, { schemaVersion: 1, purpose: 'PERSONNEL_PERFORMANCE_REVIEW', recipientCategories: ['AUTHORIZED_HUMAN_RESOURCES', 'ASSIGNED_SUPERVISORS'], levels: [], withheldCategories: ['THIRD_PARTY_INFORMATION','SUPERVISOR_NARRATIVE','CRITERION_SCORES','OTHER_PERSONNEL_RANKING','INTERNAL_REVIEW_NOTES'] });
      const evaluation = await tx.performanceEvaluation.create({ data: { stableKey: `${suffix}-evaluation`, subjectId: subject.id, measurementFrom: new Date('2026-01-01Z'), measurementTo: new Date('2026-03-31Z'), createdByUserId: actor.id } });
      await publishPerformanceTestRetentionPolicy(tx, actor.id);
      const erasure = await requestPerformancePrivacy(tx, { actorUserId: actor.id, subjectId: subject.id, requestKind: 'ERASURE', evaluationIds: [evaluation.id], reason: 'بررسی حذف سابقه شخصی' });
      await actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: erasure.id, expectedVersion: 1, action: 'ACKNOWLEDGE', reasonCode: 'REQUEST_RECEIVED' });
      await actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: erasure.id, expectedVersion: 2, action: 'VERIFY', reasonCode: 'IDENTITY_AND_SCOPE_VERIFIED' });
      await actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: erasure.id, expectedVersion: 3, action: 'RESPOND', reasonCode: 'RETENTION_DECISION_RECORDED' });
      const erasureResponse = await getPerformancePrivacyCase(tx, actor.id, erasure.id);
      assert.equal((erasureResponse.response as { decision: string }).decision, 'RETAINED_UNDER_POLICY');
      assert.equal((erasureResponse.response as { deletionCompleted: boolean }).deletionCompleted, false);
      assert.equal(await tx.performanceEvaluation.count({ where: { id: evaluation.id } }), 1);
      await actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: erasure.id, expectedVersion: 4, action: 'CLOSE', reasonCode: 'RESPONSE_DELIVERED' });
      const closedAssessment = await assessPerformanceEvaluationRetention(tx, { actorUserId: other.id, evaluationId: evaluation.id });
      assert.equal(closedAssessment.status, 'REQUIRES_RETENTION_DECISION', 'closing a request never invents a draft closure date');
      const correctionRequest = await requestPerformancePrivacy(tx, { actorUserId: actor.id, subjectId: subject.id, requestKind: 'CORRECTION', evaluationIds: [evaluation.id], reason: 'درخواست بررسی اصلاح سابقه' });
      await actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: correctionRequest.id, expectedVersion: 1, action: 'ACKNOWLEDGE', reasonCode: 'REQUEST_RECEIVED' });
      await actOnPerformancePrivacyCase(tx, { actorUserId: other.id, caseId: correctionRequest.id, expectedVersion: 2, action: 'VERIFY', reasonCode: 'IDENTITY_AND_SCOPE_VERIFIED' });
      assert.equal((await listPerformancePrivacyQueue(tx, { actorUserId: other.id })).items.find(({ id }) => id === correctionRequest.id)?.nextAction, 'OPEN_CORRECTION');

      await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:destination-reader`, userId: other.id, featureCode: 'VIEW_ASSIGNED_PERFORMANCE_CONSEQUENCE_HANDOFF', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated package restriction test' } });
      const responsibilityType = await tx.hrResponsibilityTypeCatalog.create({ data: { code: `TEST-${suffix}`, displayName: 'آزمون مقصد' } });
      const destination = await tx.hrNamedResponsibility.create({ data: { stableKey: `${suffix}:destination`, responsibilityTypeCode: responsibilityType.code, scopeType: 'PERSONNEL', scopeId: person.id, assignedUserId: other.id, effectiveFrom: new Date('2020-01-01Z'), createdByUserId: actor.id } });
      const handoffId = randomUUID();
      const packagePayload = await persistPerformancePayload(tx, { aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: handoffId, payloadKind: 'IMMUTABLE_HANDOFF', schemaVersion: 1,
        payload: { currentProjection: { state: 'LEVEL' } }, keyring: performanceVaultKeyFromEnvironment() });
      const packageRecord = await tx.performanceConsequencePackage.create({ data: { encryptedPayloadId: packagePayload.id, snapshotHash: packagePayload.contentHash,
        destinationResponsibilityId: destination.id, destinationWorkspaceCode: 'HUMAN_RESOURCES', destinationQueueCode: 'TEST', destinationVersion: 1, assignedDestinationUserId: other.id } });
      await tx.performanceConsequenceHandoff.create({ data: { id: handoffId, subjectId: subject.id, personnelId: person.id, employmentRelationshipId: relationship.id,
        consequenceType: 'COMPENSATION_REVIEW', policyCycleKey: suffix, packageId: packageRecord.id, snapshotHash: packagePayload.contentHash, createdByUserId: actor.id } });
      assert.ok((await getPerformanceConsequenceHandoff(tx, { handoffId, actorUserId: other.id })).package);
      await restrictPerformanceEvidence(tx, { actorUserId: other.id, evaluationId: evaluation.id, reasonCode: 'EVIDENCE_DISPUTED' });
      await assert.rejects(() => getPerformanceConsequenceHandoff(tx, { handoffId, actorUserId: other.id }), (error: { code?: string }) => error.code === 'PERFORMANCE_HANDOFF_SUSPENDED');
      assert.deepEqual(await activePerformanceRestrictionIds(tx, [evaluation.id]), [evaluation.id]);
      assert.equal((await assessPerformanceEvaluationRetention(tx, { actorUserId: other.id, evaluationId: evaluation.id })).status, 'DEPENDENCY_OPEN', 'a standalone active restriction preserves its scope');
      for (const featureCode of ['REQUEST_PERFORMANCE_EXPORT','VIEW_PERFORMANCE_ANALYTICS']) await tx.hrFeatureAccessGrant.create({ data: {
        stableKey: `${suffix}:${featureCode}`, userId: other.id, featureCode, level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated export restriction test',
      } });
      for (const userId of [actor.id, other.id]) for (const featureCode of ['PLACE_PERFORMANCE_LEGAL_HOLD','RELEASE_PERFORMANCE_LEGAL_HOLD']) await tx.hrFeatureAccessGrant.create({ data: {
        stableKey: `${suffix}:${userId}:${featureCode}`, userId, featureCode, level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated hold test',
      } });
      const hold = await placePerformanceLegalHold(tx, { actorUserId: actor.id, aggregateType: 'EVALUATION', aggregateId: evaluation.id, reasonCode: 'OPEN_LEGAL_PROCEEDING' });
      assert.ok(await tx.notificationEvent.findUnique({ where: { deduplicationKey: `performance-legal-hold:${hold.id}:placed` } }),
        'the subject is notified of a scoped hold without confidential reasons');
      assert.equal((await assessPerformanceEvaluationRetention(tx, { actorUserId: other.id, evaluationId: evaluation.id })).status, 'LEGAL_HOLD');
      const pendingRelease = await decidePerformanceLegalHold(tx, { actorUserId: actor.id, holdId: hold.id, action: 'APPROVE_RELEASE', reasonCode: 'LEGAL_PROCEEDING_CLOSED' });
      assert.equal(pendingRelease.status, 'ACTIVE');
      const duplicateRelease = await decidePerformanceLegalHold(tx, { actorUserId: actor.id, holdId: hold.id, action: 'APPROVE_RELEASE', reasonCode: 'LEGAL_PROCEEDING_CLOSED' });
      assert.equal(duplicateRelease.status, 'ACTIVE');
      const releasedHold = await decidePerformanceLegalHold(tx, { actorUserId: other.id, holdId: hold.id, action: 'APPROVE_RELEASE', reasonCode: 'LEGAL_PROCEEDING_CLOSED' });
      assert.equal(releasedHold.status, 'RELEASED');
      const cohort = await enrollPerformanceTestCohort(tx, actor.id, [subject.id]);
      const [{ revision }] = await tx.$queryRaw<Array<{ revision: bigint }>>`SELECT revision FROM performance_disclosure_revision WHERE id = 1`;
      const exportIds: string[] = [];
      const bytes = Buffer.from('isolated confidential export');
      for (let index = 0; index < 3; index++) {
        const exportId = randomUUID(); exportIds.push(exportId);
        const artifactPath = path.join(directory, exportId);
        await writeFile(artifactPath, encryptPerformanceExportArtifact(bytes, createHash('sha256').update('sabalan-local-performance-export-key').digest()));
        const payload = await persistPerformancePayload(tx, { aggregateType: 'PERFORMANCE_EXPORT', aggregateId: exportId, payloadKind: 'SCOPE_SNAPSHOT', schemaVersion: 1,
          payload: { scope: { reportKind: 'AGGREGATE', evidenceRevision: String(revision) } }, keyring: performanceVaultKeyFromEnvironment() });
        await tx.performanceExportReceipt.create({ data: { id: exportId, requestedByUserId: other.id, exportKind: 'XLSX', scopeHash: 'test-scope', permissionHash: 'test-permission', encryptedPayloadId: payload.id, downloadTokenHash: createHash('sha256').update(exportId).digest('hex'), expiresAt: new Date(Date.now() + 60_000) } });
        await tx.performanceExportReceipt.update({ where: { id: exportId }, data: { status: 'RUNNING', startedAt: new Date(), attemptCount: 1 } });
        await tx.performanceExportReceipt.update({ where: { id: exportId }, data: { status: 'READY', readyAt: new Date(), artifactPath, artifactKeyId: 'local-export-v1', artifactHash: createHash('sha256').update(bytes).digest('hex'), artifactSize: bytes.length, downloadTokenExpiresAt: new Date(Date.now() + 60_000) } });
      }
      const downloaded = await claimPerformanceExportDownload(tx, { exportId: exportIds[0], actorUserId: other.id, token: exportIds[0] });
      assert.deepEqual(downloaded.bytes, bytes);
      await assert.rejects(() => claimPerformanceExportDownload(tx, { exportId: exportIds[0], actorUserId: other.id, token: exportIds[0] }),
        (error: { code?: string }) => error.code === 'PERFORMANCE_EXPORT_LINK_EXPIRED');
      await tx.$executeRawUnsafe('SAVEPOINT cohort_retirement');
      await tx.performanceCohortVersion.update({ where: { id: cohort.id }, data: { lifecycle: 'RETIRED' } });
      await assert.rejects(() => claimPerformanceExportDownload(tx, { exportId: exportIds[2], actorUserId: other.id, token: exportIds[2] }),
        (error: { code?: string }) => error.code === 'PERFORMANCE_EXPORT_EVIDENCE_CHANGED', 'retiring the cohort must invalidate an existing export');
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT cohort_retirement');
      await placePerformanceLegalHold(tx, { actorUserId: actor.id, aggregateType: 'EVALUATION', aggregateId: evaluation.id, reasonCode: 'NEW_LEGAL_PROCEEDING' });
      await assert.rejects(() => claimPerformanceExportDownload(tx, { exportId: exportIds[1], actorUserId: other.id, token: exportIds[1] }),
        (error: { code?: string }) => error.code === 'PERFORMANCE_EXPORT_EVIDENCE_CHANGED');
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; } finally { await rm(directory, { recursive: true, force: true }); }
};
main().finally(() => prisma.$disconnect());
