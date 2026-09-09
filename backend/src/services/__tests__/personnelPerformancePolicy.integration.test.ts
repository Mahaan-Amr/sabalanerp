import { enablePerformanceTestRelease } from './personnelPerformanceTestRelease';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PerformancePolicyKind } from '@prisma/client';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';
import {
  activateDuePerformanceArtifacts,
  activateDuePerformancePolicies,
  cancelScheduledPerformanceVersion,
  createPerformanceCriterionDraft,
  createPerformancePolicyDraft,
  createPerformanceTemplateDraft,
  DEFAULT_CURRENT_LEVEL_POLICY_CONTENT,
  previewPerformancePolicy,
  previewPerformanceRoleCatalogImport,
  importPerformanceRoleCatalogDraft,
  schedulePerformancePolicy,
} from '../personnelPerformancePolicyStore';
import { DEFAULT_LEVEL_POLICY_CONTENT, nextTehranDayStart } from '../personnelPerformancePolicy';
import { performanceRoleCatalogContentHash } from '../personnelPerformanceRoleCatalog';

const repositoryRoot = path.resolve(process.cwd(), '..');
const sourceDatabaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=4&pool_timeout=10';
const keyring = { keyId: 'policy-integration-v1', key: Buffer.from('0123456789abcdef0123456789abcdef') };

const main = async () => {
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot, sourceDatabaseUrl });
  const first = database.client();
  const second = database.client();
  try {
  const actor = await first.user.create({ data: {
    email: `performance-policy-${database.runId}@example.invalid`,
    username: `performance_policy_${database.runId}`,
    password: 'not-used',
    firstName: 'عامل',
    lastName: 'سیاست',
  } });
  await enablePerformanceTestRelease(first, actor.id);
  const templateContent = {
    schemaVersion: 1 as const,
    titleFa: 'الگوی اعتبارسنجی مالک',
    categories: [{
      id: 'main', titleFa: 'اصلی', weightPercent: '100.00', required: true,
      criteria: [{ criterionVersionId: `owner-criterion-${database.runId}`, weightPercent: '100.00' }],
    }],
  };
  const ownerUnit = await first.hrOrganizationalUnit.create({ data: {
    code: `OWNER-UNIT-${database.runId}`, name: 'واحد مالک', type: 'DEPARTMENT', createdBy: actor.id,
  } });
  const activeJob = await first.hrJob.create({ data: {
    code: `OWNER-JOB-${database.runId}`, title: 'شغل فعال', createdBy: actor.id,
  } });
  const retiredJob = await first.hrJob.create({ data: {
    code: `OWNER-RETIRED-${database.runId}`, title: 'شغل بازنشسته', isActive: false, createdBy: actor.id,
  } });
  const activePosition = await first.hrPosition.create({ data: {
    code: `OWNER-POS-${database.runId}`, title: 'جایگاه فعال', jobId: activeJob.id,
    organizationalUnitId: ownerUnit.id, createdBy: actor.id,
  } });
  const validOwnerDraft = await createPerformanceTemplateDraft(first, {
    templateKind: 'JOB_TEMPLATE', ownerType: 'JOB', ownerId: activeJob.id,
    content: templateContent, createdByUserId: actor.id, keyring,
  });
  assert.equal(validOwnerDraft.ownerId, activeJob.id);
  await assert.rejects(createPerformanceTemplateDraft(first, {
    templateKind: 'JOB_TEMPLATE', ownerType: 'JOB', ownerId: 'missing-job',
    content: templateContent, createdByUserId: actor.id, keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_TEMPLATE_OWNER_UNAVAILABLE');
  await assert.rejects(createPerformanceTemplateDraft(first, {
    templateKind: 'JOB_TEMPLATE', ownerType: 'JOB', ownerId: retiredJob.id,
    content: templateContent, createdByUserId: actor.id, keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_TEMPLATE_OWNER_RETIRED');
  await assert.rejects(createPerformanceTemplateDraft(first, {
    templateKind: 'POSITION_ADDENDUM', ownerType: 'JOB', ownerId: activeJob.id,
    content: templateContent, createdByUserId: actor.id, keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_TEMPLATE_OWNER_TYPE_MISMATCH');
  const validPositionDraft = await createPerformanceTemplateDraft(first, {
    templateKind: 'POSITION_ADDENDUM', ownerType: 'POSITION', ownerId: activePosition.id,
    content: templateContent, createdByUserId: actor.id, keyring,
  });
  assert.equal(validPositionDraft.ownerId, activePosition.id);

  const importJob = await first.hrJob.create({ data: {
    code: `IMPORT-JOB-${database.runId}`, title: 'شغل درون‌ریزی', createdBy: actor.id,
  } });
  const importPosition = await first.hrPosition.create({ data: {
    code: `IMPORT-POS-${database.runId}`, title: 'جایگاه درون‌ریزی', jobId: importJob.id,
    organizationalUnitId: ownerUnit.id, createdBy: actor.id,
  } });
  const importManifest: any = {
    schemaVersion: 1,
    catalog: {
      stableKey: `PERF_IMPORT_${database.runId.toUpperCase()}`, versionCode: 'VERSION_1', lifecycle: 'DRAFT',
      importIdentity: `PERF-IMPORT:${database.runId}:V1`, contentHash: '0'.repeat(64),
      contentHashMethod: 'SHA256_CANONICAL_JSON_EXCLUDING_CATALOG_CONTENT_HASH',
    },
    source: { provenanceCategory: 'LOCAL', asOf: new Date().toISOString(), references: ['integration-controlled-source'], extractedFacts: true },
    review: { contentOrigin: 'COMPANY_CONTROLLED_SOURCE', status: 'BUSINESS_REVIEW_PENDING' },
    applicabilityDictionary: Object.entries({
      jobId: 'ID', positionId: 'ID', organizationalUnitId: 'ID', workplaceId: 'ID', shiftType: 'STRING',
      assignmentType: 'STRING', responsibilityCodes: 'STRING_LIST', effectiveDate: 'DATE', hasSafetyDuty: 'BOOLEAN',
    }).map(([fact, type]) => ({ fact, type, operators: type === 'STRING_LIST' ? ['IN', 'EXISTS'] : ['EQUALS', 'IN', 'EXISTS'], unknown: 'BLOCK', source: 'employment-assignment', sourceVersion: 'v1' })),
    evidenceDictionary: [{ code: 'CONTROLLED_SOURCE', classification: 'CANONICAL_EVIDENCE' }],
    jobs: [{
      reference: { code: 'IMPORT_JOB', id: importJob.id, synthetic: false }, titleFa: 'شغل درون‌ریزی',
      categories: [{ code: 'CORE', titleFa: 'اصلی', weight: 100 }],
      criteria: [{
        conceptCode: `IMPORT_QUALITY_${database.runId.toUpperCase()}`, versionCode: 'QUALITY_V1', titleFa: 'کیفیت درون‌ریزی', meaningFa: 'کیفیت ثبت‌شده در منبع کنترل‌شده',
        kind: 'JUDGMENT', categoryCode: 'CORE', weight: 100, applicability: null,
        anchorsFa: ['خیلی ضعیف', 'ضعیف', 'مطابق انتظار', 'خوب', 'برجسته'],
        evidencePolicy: { dictionaryCodes: ['CONTROLLED_SOURCE'], minimumReliableCount: 1, windowDays: 30, automaticGrade: false },
        outsideControlFactors: ['نبود داده ورودی'],
      }],
    }],
    positions: [{
      reference: { code: 'IMPORT_POSITION', id: importPosition.id, synthetic: false }, jobReferenceCode: 'IMPORT_JOB', titleFa: 'افزوده درون‌ریزی',
      composition: { jobWeight: 80, addendumWeight: 20 }, categories: [{ code: 'ADDENDUM', titleFa: 'افزوده', weight: 100 }],
      criteria: [{
        conceptCode: `IMPORT_ADDENDUM_${database.runId.toUpperCase()}`, versionCode: 'ADDENDUM_V1', titleFa: 'کنترل افزوده', meaningFa: 'انتظار ویژه جایگاه کنترل‌شده',
        kind: 'JUDGMENT', categoryCode: 'ADDENDUM', weight: 100,
        applicability: { fact: 'positionId', operator: 'EQUALS', values: ['IMPORT_POSITION'] },
        anchorsFa: ['خیلی ضعیف', 'ضعیف', 'مطابق انتظار', 'خوب', 'برجسته'],
        evidencePolicy: { dictionaryCodes: ['CONTROLLED_SOURCE'], minimumReliableCount: 1, windowDays: 30, automaticGrade: false },
        outsideControlFactors: ['نبود داده ورودی'],
      }],
    }],
  };
  importManifest.catalog.contentHash = performanceRoleCatalogContentHash(importManifest);
  const importPreview = await previewPerformanceRoleCatalogImport(first, importManifest);
  assert.equal(importPreview.importable, true);
  assert.deepEqual(importPreview.compositions.map(({ jobSharePercent, addendumSharePercent }) => ({ jobSharePercent, addendumSharePercent })), [
    { jobSharePercent: '80.00', addendumSharePercent: '20.00' },
  ]);
  const imported = await importPerformanceRoleCatalogDraft(first, {
    manifest: importManifest, createdByUserId: actor.id, keyring,
  });
  assert.equal(imported.publicationTriggered, false);
  assert.equal(imported.retried, false);
  assert.equal(imported.criterionVersionIds.length, 2);
  assert.equal(imported.templateVersionIds.length, 2);
  assert.equal(await first.performanceCriterionVersion.count({ where: { id: { in: imported.criterionVersionIds }, lifecycle: 'DRAFT' } }), 2);
  assert.equal(await first.performanceTemplateVersion.count({ where: { id: { in: imported.templateVersionIds }, lifecycle: 'DRAFT' } }), 2);
  const retriedImport = await importPerformanceRoleCatalogDraft(first, {
    manifest: importManifest, createdByUserId: actor.id, keyring,
  });
  assert.deepEqual(retriedImport.criterionVersionIds, imported.criterionVersionIds);
  assert.equal(retriedImport.retried, true);
  assert.equal(await first.performanceOperationReceipt.count({ where: { operationKind: 'IMPORT_ROLE_CATALOG_DRAFT' } }), 1);

  const conflictingImport = structuredClone(importManifest);
  conflictingImport.jobs[0].titleFa = 'عنوان متعارض';
  conflictingImport.catalog.contentHash = performanceRoleCatalogContentHash(conflictingImport);
  await assert.rejects(importPerformanceRoleCatalogDraft(first, {
    manifest: conflictingImport, createdByUserId: actor.id, keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_ROLE_CATALOG_IMPORT_CONFLICT');

  const recoverableImport = structuredClone(importManifest);
  const recoveryJob = await first.hrJob.create({ data: {
    code: `RECOVERY-JOB-${database.runId}`, title: 'شغل بازیابی', createdBy: actor.id,
  } });
  const recoveryPosition = await first.hrPosition.create({ data: {
    code: `RECOVERY-POS-${database.runId}`, title: 'جایگاه بازیابی', jobId: recoveryJob.id,
    organizationalUnitId: ownerUnit.id, createdBy: actor.id,
  } });
  recoverableImport.catalog.stableKey = `PERF_RECOVERY_${database.runId.toUpperCase()}`;
  recoverableImport.catalog.versionCode = 'RECOVERY_V1';
  recoverableImport.catalog.importIdentity = `PERF-RECOVERY:${database.runId}:V1`;
  recoverableImport.jobs[0].criteria[0].conceptCode = `RECOVERY_QUALITY_${database.runId.toUpperCase()}`;
  recoverableImport.jobs[0].reference.id = recoveryJob.id;
  recoverableImport.positions[0].criteria[0].conceptCode = `RECOVERY_ADDENDUM_${database.runId.toUpperCase()}`;
  recoverableImport.positions[0].reference.id = 'missing-position';
  recoverableImport.catalog.contentHash = performanceRoleCatalogContentHash(recoverableImport);
  const criterionCountBeforeRecovery = await first.performanceCriterionVersion.count();
  await assert.rejects(importPerformanceRoleCatalogDraft(first, {
    manifest: recoverableImport, createdByUserId: actor.id, keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_TEMPLATE_OWNER_UNAVAILABLE');
  assert.equal(await first.performanceCriterionVersion.count(), criterionCountBeforeRecovery, 'failed import must roll back every draft');
  recoverableImport.positions[0].reference.id = recoveryPosition.id;
  recoverableImport.catalog.contentHash = performanceRoleCatalogContentHash(recoverableImport);
  const recovered = await importPerformanceRoleCatalogDraft(first, {
    manifest: recoverableImport, createdByUserId: actor.id, keyring,
  });
  assert.equal(recovered.criterionVersionIds.length, 2);
  const content = {
    schemaVersion: 1 as const,
    conceptCode: `PERF-CONCURRENCY-${database.runId.toUpperCase()}`,
    titleFa: 'کیفیت هم‌زمانی',
    meaningFa: 'رفتار معیار را هنگام نوشتن هم‌زمان می‌سنجد.',
    kind: 'JUDGMENT' as const,
    anchorsFa: ['خیلی پایین', 'پایین', 'مطابق انتظار', 'بالاتر', 'برجسته'],
    applicability: null,
    evidence: { allowedKinds: ['STRUCTURED_OBSERVATION' as const], minimumReliableCount: 1, lookbackDays: 0, required: true },
  };
  const competingDrafts = await Promise.allSettled([
    createPerformanceCriterionDraft(first, { content, createdByUserId: actor.id, keyring }),
    createPerformanceCriterionDraft(second, { content, createdByUserId: actor.id, keyring }),
  ]);
  assert.equal(competingDrafts.filter((result) => result.status === 'fulfilled').length, 1);
  const identities = await first.performanceCriterionIdentity.findMany({ where: { conceptCode: content.conceptCode } });
  assert.equal(await first.performanceCriterionVersion.count({
    where: { criterionIdentityId: { in: identities.map(({ id }) => id) } },
  }), 1, 'concurrent creation retains one canonical draft writer');

  const activationIdentity = await first.performanceCriterionIdentity.create({ data: {
    stableKey: `activation-${database.runId}`,
    conceptCode: `PERF-ACTIVATION-${database.runId.toUpperCase()}`,
    createdByUserId: actor.id,
  } });
  const activationVersion = await first.performanceCriterionVersion.create({ data: {
    criterionIdentityId: activationIdentity.id,
    version: 1,
    contentHash: 'a'.repeat(64),
    createdByUserId: actor.id,
  } });
  const activationTime = new Date();
  await first.performanceCriterionVersion.update({
    where: { id: activationVersion.id },
    data: {
      lifecycle: 'SCHEDULED',
      effectiveFrom: activationTime,
      publicationReason: 'آزمون فعال‌سازی اتمیک و تکرارپذیر',
      publishedByUserId: actor.id,
      publishedAt: activationTime,
    },
  });
  const activationKey = `artifact-activation-${database.runId}`;
  const activations = await Promise.all([
    activateDuePerformanceArtifacts(first, { actorUserId: actor.id, idempotencyKey: activationKey, now: activationTime, keyring }),
    activateDuePerformanceArtifacts(second, { actorUserId: actor.id, idempotencyKey: activationKey, now: activationTime, keyring }),
  ]);
  assert.deepEqual(activations[0], activations[1]);
  assert.deepEqual(activations[0].activatedCriterionVersionIds, [activationVersion.id]);
  assert.equal(await first.performanceOperationReceipt.count({ where: { operationKind: 'ACTIVATE_DUE_ARTIFACTS' } }), 1);
  assert.equal(await first.performanceAuditEvent.count({
    where: { aggregateType: 'CRITERION_VERSION', aggregateId: activationVersion.id, eventType: 'ACTIVATED' },
  }), 1);

  const systemActivationIdentity = await first.performanceCriterionIdentity.create({ data: {
    stableKey: `system-activation-${database.runId}`,
    conceptCode: `PERF-SYSTEM-${database.runId.toUpperCase()}`,
    createdByUserId: actor.id,
  } });
  const systemActivationVersion = await first.performanceCriterionVersion.create({ data: {
    criterionIdentityId: systemActivationIdentity.id,
    version: 1,
    contentHash: 'b'.repeat(64),
    createdByUserId: actor.id,
  } });
  await first.performanceCriterionVersion.update({ where: { id: systemActivationVersion.id }, data: {
    lifecycle: 'SCHEDULED',
    effectiveFrom: activationTime,
    publicationReason: 'آزمون عامل سیستمی نگهداری زمان‌بندی‌شده',
    publishedByUserId: actor.id,
    publishedAt: activationTime,
  } });
  await activateDuePerformanceArtifacts(first, {
    actorUserId: null,
    idempotencyKey: `system-artifact-activation-${database.runId}`,
    now: activationTime,
    keyring,
  });
  const systemAudit = await first.performanceAuditEvent.findFirstOrThrow({ where: {
    aggregateType: 'CRITERION_VERSION', aggregateId: systemActivationVersion.id, eventType: 'ACTIVATED',
  } });
  assert.equal(systemAudit.actorUserId, null);
  assert.match(systemAudit.authorityHash ?? '', /^[a-f0-9]{64}$/);
  const receipt = await first.performanceOperationReceipt.findFirstOrThrow({ where: { operationKind: 'ACTIVATE_DUE_ARTIFACTS' } });
  await assert.rejects(
    first.performanceOperationReceipt.update({ where: { id: receipt.id }, data: { intentHash: 'rewritten' } }),
    /append-only/i,
  );

  const policy = await createPerformancePolicyDraft(first, {
    policyKind: PerformancePolicyKind.LEVEL_CLASSIFICATION,
    content: DEFAULT_LEVEL_POLICY_CONTENT,
    createdByUserId: actor.id,
    keyring,
  });
  const publicationNow = new Date();
  const effectiveFrom = nextTehranDayStart(publicationNow);
  const [previewOne, previewTwo] = await Promise.all([
    previewPerformancePolicy(first, { versionId: policy.id, asOf: effectiveFrom, keyring }),
    previewPerformancePolicy(second, { versionId: policy.id, asOf: effectiveFrom, keyring }),
  ]);
  assert.equal(previewOne.preview.resultHash, previewTwo.preview.resultHash);
  assert.equal(previewOne.sourcePopulationHash, previewTwo.sourcePopulationHash);
  const scheduled = await schedulePerformancePolicy(first, {
    versionId: policy.id,
    effectiveFrom,
    reason: 'انتشار آزمایشی سیاست سطح‌بندی برای جمعیت کامل',
    confirmedByUserId: actor.id,
    confirmedPreviewHash: previewOne.preview.resultHash,
    confirmedPopulationHash: previewOne.sourcePopulationHash,
    now: publicationNow,
    keyring,
  });
  assert.equal(scheduled.version.lifecycle, 'SCHEDULED');
  assert.equal(scheduled.preview.eligible, scheduled.preview.unchanged);
  await assert.rejects(cancelScheduledPerformanceVersion(first, {
    artifactType: 'policy',
    versionId: policy.id,
    reason: 'تلاش برای لغو پس از سررسید سیاست زمان‌بندی‌شده',
    actorUserId: actor.id,
    now: effectiveFrom,
    keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_VERSION_CANCELLATION_TOO_LATE');
  await cancelScheduledPerformanceVersion(first, {
    artifactType: 'policy',
    versionId: policy.id,
    reason: 'لغو آزمایشی پیش از تاریخ اثر و بدون استفاده در تصویر ثابت',
    actorUserId: actor.id,
    keyring,
  });
  assert.equal((await first.performancePolicyVersion.findUniqueOrThrow({ where: { id: policy.id } })).lifecycle, 'CANCELLED');
  assert.equal(await first.performanceAuditEvent.count({
    where: { aggregateType: 'POLICY_VERSION', aggregateId: policy.id, eventType: 'CANCELLED' },
  }), 1);

  const latePublicationNow = new Date(Date.now() - 3 * 86_400_000);
  const lateEffectiveFrom = nextTehranDayStart(latePublicationNow);
  await assert.rejects(() => createPerformancePolicyDraft(first, {
    policyKind: PerformancePolicyKind.CURRENT_LEVEL,
    content: { ...DEFAULT_CURRENT_LEVEL_POLICY_CONTENT, recencyWeightsPercent: ['25.000000', '25.000000', '25.000000', '25.000000'] },
    createdByUserId: actor.id,
    keyring,
  }), /۵۰، ۳۰، ۱۵ و ۵/);
  const latePolicy = await createPerformancePolicyDraft(first, {
    policyKind: PerformancePolicyKind.CURRENT_LEVEL,
    content: DEFAULT_CURRENT_LEVEL_POLICY_CONTENT,
    createdByUserId: actor.id,
    keyring,
  });
  const latePreview = await previewPerformancePolicy(first, { versionId: latePolicy.id, asOf: lateEffectiveFrom, keyring });
  await schedulePerformancePolicy(first, {
    versionId: latePolicy.id,
    effectiveFrom: lateEffectiveFrom,
    reason: 'انتشار آزمایشی برای بازیابی فعال‌سازی دیرهنگام بدون تغییر جمعیت',
    confirmedByUserId: actor.id,
    confirmedPreviewHash: latePreview.preview.resultHash,
    confirmedPopulationHash: latePreview.sourcePopulationHash,
    now: latePublicationNow,
    keyring,
  });
  const lateActivation = await activateDuePerformancePolicies(first, {
    actorUserId: actor.id,
    idempotencyKey: `late-policy-${database.runId}`,
    now: new Date(),
    keyring,
  });
  assert.deepEqual(lateActivation.activatedPolicyVersionIds, [latePolicy.id]);

  const stalePolicy = await createPerformancePolicyDraft(first, {
    policyKind: PerformancePolicyKind.LEVEL_CLASSIFICATION,
    content: DEFAULT_LEVEL_POLICY_CONTENT,
    createdByUserId: actor.id,
    keyring,
  });
  const stalePublicationNow = new Date(Date.now() - 3 * 86_400_000);
  const staleEffectiveFrom = nextTehranDayStart(stalePublicationNow);
  const stalePreview = await previewPerformancePolicy(first, { versionId: stalePolicy.id, asOf: staleEffectiveFrom, keyring });
  await schedulePerformancePolicy(first, {
    versionId: stalePolicy.id,
    effectiveFrom: staleEffectiveFrom,
    reason: 'انتشار آزمایشی برای آزمون تأیید دوباره پس از تغییر جمعیت',
    confirmedByUserId: actor.id,
    confirmedPreviewHash: stalePreview.preview.resultHash,
    confirmedPopulationHash: stalePreview.sourcePopulationHash,
    now: stalePublicationNow,
    keyring,
  });
  const firstPreviewId = (await first.performancePolicyVersion.findUniqueOrThrow({ where: { id: stalePolicy.id } })).activationPreviewId!;
  const existingSuccessorDraft = await createPerformancePolicyDraft(first, {
    policyKind: PerformancePolicyKind.LEVEL_CLASSIFICATION,
    content: DEFAULT_LEVEL_POLICY_CONTENT,
    createdByUserId: actor.id,
    keyring,
  });
  const addedPersonnel = await first.personnel.create({ data: { firstName: 'جمعیت', lastName: 'تغییرکرده' } });
  const addedRelationship = await first.hrEmploymentRelationship.create({ data: {
    personnelId: addedPersonnel.id,
    status: 'ACTIVE',
    effectiveFrom: staleEffectiveFrom,
    createdBy: actor.id,
  } });
  await first.performanceSubject.create({ data: {
    stableKey: `reconfirmation-${database.runId}`,
    nonDisplayKey: `opaque-reconfirmation-${database.runId}`,
    personnelId: addedPersonnel.id,
    employmentRelationshipId: addedRelationship.id,
    createdByUserId: actor.id,
  } });
  const overdueNow = new Date();
  const reconfirmedEffectiveFrom = nextTehranDayStart(overdueNow);
  const reconfirmPreview = await previewPerformancePolicy(first, {
    versionId: stalePolicy.id,
    asOf: reconfirmedEffectiveFrom,
    now: overdueNow,
    keyring,
  });
  const replacementSchedule = await schedulePerformancePolicy(first, {
    versionId: stalePolicy.id,
    effectiveFrom: reconfirmedEffectiveFrom,
    reason: 'بازپیش‌نمایش و تأیید دوباره پس از تغییر جمعیت',
    confirmedByUserId: actor.id,
    confirmedPreviewHash: reconfirmPreview.preview.resultHash,
    confirmedPopulationHash: reconfirmPreview.sourcePopulationHash,
    now: overdueNow,
    keyring,
  });
  const superseded = await first.performancePolicyVersion.findUniqueOrThrow({ where: { id: stalePolicy.id } });
  assert.equal(superseded.lifecycle, 'RETIRED');
  assert.equal(superseded.effectiveFrom?.toISOString(), staleEffectiveFrom.toISOString());
  assert.notEqual(replacementSchedule.version.id, stalePolicy.id);
  assert.equal(replacementSchedule.version.predecessorId, existingSuccessorDraft.id);
  assert.equal(replacementSchedule.version.version, existingSuccessorDraft.version + 1);
  assert.equal((await first.performancePolicyVersion.findUniqueOrThrow({ where: { id: existingSuccessorDraft.id } })).lifecycle, 'CANCELLED');
  assert.equal(await first.performancePolicyActivationPreview.count({ where: { policyVersionId: stalePolicy.id } }), 1);
  assert.equal(await first.performancePolicyActivationPreview.count({ where: { policyVersionId: replacementSchedule.version.id } }), 1);
  assert.equal((await first.performancePolicyActivationPreview.findUniqueOrThrow({
    where: { policyVersionId: stalePolicy.id },
  })).id, firstPreviewId);
  assert.equal(await first.performanceAuditEvent.count({
    where: { aggregateType: 'POLICY_VERSION', aggregateId: stalePolicy.id, eventType: 'OVERDUE_SUPERSEDED' },
  }), 1);

  console.log('Personnel performance policy integration and concurrency tests passed.');
  } finally {
    await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
    await database.cleanup();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
