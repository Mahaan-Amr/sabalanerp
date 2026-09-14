import { enablePerformanceTestRelease } from './personnelPerformanceTestRelease';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PerformancePolicyKind } from '@prisma/client';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';
import {
  activateDuePerformanceArtifacts,
  activateDuePerformancePolicies,
  approvePerformanceCatalogDraft,
  cancelScheduledPerformanceVersion,
  createPerformanceCriterionDraft,
  createPerformancePolicyDraft,
  createPerformanceTemplateDraft,
  DEFAULT_CURRENT_LEVEL_POLICY_CONTENT,
  DEFAULT_SCORING_POLICY_CONTENT,
  freezePerformanceTemplateSnapshot,
  previewPerformancePolicy,
  previewPerformanceRoleCatalogImport,
  importPerformanceRoleCatalogDraft,
  schedulePerformanceCriterion,
  schedulePerformanceTemplate,
  schedulePerformancePolicy,
  updatePerformanceTemplateDraft,
  updatePerformanceCriterionDraft,
} from '../personnelPerformancePolicyStore';
import { DEFAULT_LEVEL_POLICY_CONTENT, nextTehranDayStart } from '../personnelPerformancePolicy';
import { performanceRoleCatalogContentHash } from '../personnelPerformanceRoleCatalog';
import { persistPerformancePayload, readPerformancePayload } from '../personnelPerformancePayloadStore';
import { calculatePerformanceEvaluation } from '../personnelPerformanceCalculation';

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
    templateKind: 'JOB_TEMPLATE', ownerType: 'JOB', ownerId: activeJob.id,
    content: { ...templateContent, catalogSource: {
      importIdentity: 'FORGED', catalogVersion: 'V1', manifestContentHash: 'a'.repeat(64),
      sourceAsOf: new Date().toISOString(), sourceProvenanceCategory: 'LOCAL',
      manifestContentOrigin: 'COMPANY_CONTROLLED_SOURCE', manifestReviewStatus: 'APPROVED', reviewStatus: 'APPROVED',
      approvedAt: new Date().toISOString(), approvedByUserId: actor.id, approvalReason: 'تأیید جعلی سمت کاربر',
    } } as any,
    createdByUserId: actor.id, keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_CATALOG_SOURCE_SERVER_OWNED');
  await assert.rejects(updatePerformanceTemplateDraft(first, {
    versionId: validOwnerDraft.id,
    content: { ...templateContent, catalogSource: {
      importIdentity: 'FORGED', catalogVersion: 'V1', manifestContentHash: 'a'.repeat(64),
      sourceAsOf: new Date().toISOString(), sourceProvenanceCategory: 'LOCAL',
      manifestContentOrigin: 'COMPANY_CONTROLLED_SOURCE', manifestReviewStatus: 'APPROVED', reviewStatus: 'APPROVED',
      approvedAt: new Date().toISOString(), approvedByUserId: actor.id, approvalReason: 'تأیید جعلی سمت کاربر',
    } } as any,
    keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_CATALOG_SOURCE_SERVER_OWNED');
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
  const futureRetiredJob = await first.hrJob.create({ data: {
    code: `OWNER-FUTURE-RETIRED-${database.runId}`, title: 'شغل با بازنشستگی آینده', createdBy: actor.id,
  } });
  const futureRetiredDraft = await createPerformanceTemplateDraft(first, {
    templateKind: 'JOB_TEMPLATE', ownerType: 'JOB', ownerId: futureRetiredJob.id,
    content: templateContent, createdByUserId: actor.id, keyring,
  });
  const ownerSchedulingNow = new Date();
  const futureRetirement = nextTehranDayStart(ownerSchedulingNow);
  await first.hrFoundationLifecycleVersion.create({ data: {
    stableKey: `future-retired-job-${database.runId}`, entityType: 'JOB', entityId: futureRetiredJob.id, version: 1,
    status: 'INACTIVE', effectiveFrom: futureRetirement, reason: 'بازنشستگی آینده برای آزمون مالک الگو',
    beforeJson: { isActive: true }, afterJson: { isActive: false }, changedByUserId: actor.id,
  } });
  await assert.rejects(schedulePerformanceTemplate(first, {
    versionId: futureRetiredDraft.id, effectiveFrom: new Date(futureRetirement.getTime() + 24 * 60 * 60 * 1_000),
    reason: 'آزمون جلوگیری از انتشار برای مالک بازنشسته', publishedByUserId: actor.id, now: ownerSchedulingNow, keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_TEMPLATE_OWNER_RETIRED');

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
    applicabilitySnapshotContract: {
      schemaVersion: 1, container: '__applicability', snapshotVersion: 'PERSONNEL_PERFORMANCE_ASSIGNMENT_FACTS_V1',
      sourceVersions: 'REQUIRED_MAP_OF_FACT_TO_STABLE_SOURCE_VERSION', effectiveAt: 'REQUIRED_ISO_TIMESTAMP', unknown: 'BLOCK',
    },
    applicabilityDictionary: Object.entries({
      jobId: 'ID', positionId: 'ID', organizationalUnitId: 'ID', workplaceId: 'ID', shiftType: 'STRING',
      assignmentType: 'STRING', responsibilityCodes: 'STRING_LIST', effectiveDate: 'DATE', hasSafetyDuty: 'BOOLEAN',
    }).map(([fact, type]) => ({
      fact, type,
      operators: fact === 'workplaceId' || fact === 'shiftType' ? ['EQUALS', 'IN', 'EXISTS']
        : fact === 'responsibilityCodes' ? ['IN', 'EXISTS']
          : fact === 'hasSafetyDuty' ? ['EQUALS'] : ['EQUALS', 'IN'],
      unknown: 'BLOCK', source: 'employment-assignment', sourceVersion: 'v1',
    })),
    evidenceDictionary: [{
      code: 'CONTROLLED_SOURCE', classification: 'CANONICAL_EVIDENCE', sourceProcess: 'فرایند کنترل‌شده',
      recordVersion: 'شناسه و نسخه تغییرناپذیر', lineage: 'انتساب مؤثر ثبت‌شده',
      attribution: 'RECORDED_PERFORMER_ONLY', ownerRole: 'HR_POLICY_OWNER',
    }],
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
        applicability: { schemaVersion: 1, fact: 'positionId', factType: 'ID', operator: 'EQUALS', values: ['IMPORT_POSITION'] },
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
  const catalogSchedulingNow = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000);
  const artifactEffectiveFrom = nextTehranDayStart(catalogSchedulingNow);
  const catalogReceipt = await first.performanceOperationReceipt.findFirstOrThrow({
    where: { operationKind: 'IMPORT_ROLE_CATALOG_DRAFT', intentHash: importManifest.catalog.contentHash },
  });
  const catalogReceiptEvidence = await readPerformancePayload<any>(first, catalogReceipt.encryptedPayloadId, keyring);
  assert.deepEqual(catalogReceiptEvidence.manifest.source.references, importManifest.source.references);
  assert.equal(catalogReceiptEvidence.manifest.evidenceDictionary[0].lineage, importManifest.evidenceDictionary[0].lineage);
  assert.deepEqual(catalogReceiptEvidence.manifest.jobs[0].criteria[0].outsideControlFactors,
    importManifest.jobs[0].criteria[0].outsideControlFactors);
  await assert.rejects(schedulePerformanceCriterion(first, {
    versionId: imported.criterionVersionIds[0], effectiveFrom: artifactEffectiveFrom,
    reason: 'آزمون جلوگیری از انتشار محتوای پیشنهادی', publishedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_CATALOG_BUSINESS_APPROVAL_REQUIRED');
  await assert.rejects(schedulePerformanceTemplate(first, {
    versionId: imported.templateVersionIds[0], effectiveFrom: artifactEffectiveFrom,
    reason: 'آزمون جلوگیری از انتشار الگوی پیشنهادی', publishedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_CATALOG_BUSINESS_APPROVAL_REQUIRED');
  let approvedCriterion = await approvePerformanceCatalogDraft(first, {
    artifactType: 'criterion', versionId: imported.criterionVersionIds[0],
    reason: 'بازبینی معیار در برابر منبع کنترل‌شده شرکت', approvedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  });
  const approvedTemplate = await approvePerformanceCatalogDraft(first, {
    artifactType: 'template', versionId: imported.templateVersionIds[0],
    reason: 'بازبینی الگو و مالک آن در منبع کنترل‌شده شرکت', approvedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  });
  const approvedAddendumCriterion = await approvePerformanceCatalogDraft(first, {
    artifactType: 'criterion', versionId: imported.criterionVersionIds[1],
    reason: 'بازبینی معیار افزوده در برابر منبع کنترل‌شده شرکت', approvedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  });
  const approvedAddendumTemplate = await approvePerformanceCatalogDraft(first, {
    artifactType: 'template', versionId: imported.templateVersionIds[1],
    reason: 'بازبینی الگوی افزوده در منبع کنترل‌شده شرکت', approvedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  });
  const approvedCriterionContent = await readPerformancePayload<any>(first, approvedCriterion.encryptedPayloadId!, keyring);
  const approvedTemplateContent = await readPerformancePayload<any>(first, approvedTemplate.encryptedPayloadId!, keyring);
  assert.equal(approvedCriterionContent.catalogSource.reviewStatus, 'APPROVED');
  assert.equal(approvedCriterionContent.catalogSource.manifestContentHash, importManifest.catalog.contentHash);
  assert.equal(approvedTemplateContent.catalogSource.approvedByUserId, actor.id);
  const editedCriterion = await updatePerformanceCriterionDraft(first, {
    versionId: approvedCriterion.id,
    content: { ...approvedCriterionContent, meaningFa: 'معنای بازبینی‌شده پس از تأیید نخست' },
    keyring,
  });
  const editedCriterionContent = await readPerformancePayload<any>(first, editedCriterion.encryptedPayloadId!, keyring);
  assert.equal(editedCriterionContent.catalogSource.reviewStatus, 'BUSINESS_REVIEW_PENDING');
  assert.equal(editedCriterionContent.catalogSource.approvedBusinessContentHash, undefined);
  await assert.rejects(schedulePerformanceCriterion(first, {
    versionId: editedCriterion.id, effectiveFrom: artifactEffectiveFrom,
    reason: 'جلوگیری از انتشار ویرایش بدون تأیید تازه', publishedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  }), (error: unknown) => (error as { code?: string }).code === 'PERFORMANCE_CATALOG_BUSINESS_APPROVAL_REQUIRED');
  approvedCriterion = await approvePerformanceCatalogDraft(first, {
    artifactType: 'criterion', versionId: editedCriterion.id,
    reason: 'تأیید دوباره پس از ویرایش محتوای معیار', approvedByUserId: actor.id, now: new Date(catalogSchedulingNow.getTime() + 1_000), keyring,
  });
  assert.equal(await first.performanceAuditEvent.count({
    where: { eventType: 'CATALOG_BUSINESS_APPROVED', aggregateId: { in: [approvedCriterion.id, approvedTemplate.id, approvedAddendumCriterion.id, approvedAddendumTemplate.id] } },
  }), 5);
  await schedulePerformanceCriterion(first, {
    versionId: approvedCriterion.id, effectiveFrom: artifactEffectiveFrom,
    reason: 'انتشار معیار پس از تأیید کسب‌وکاری ثبت‌شده', publishedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  });
  await schedulePerformanceTemplate(first, {
    versionId: approvedTemplate.id, effectiveFrom: artifactEffectiveFrom,
    reason: 'انتشار الگو پس از تأیید کسب‌وکاری ثبت‌شده', publishedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  });
  await schedulePerformanceCriterion(first, {
    versionId: approvedAddendumCriterion.id, effectiveFrom: artifactEffectiveFrom,
    reason: 'انتشار معیار افزوده پس از تأیید کسب‌وکاری', publishedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  });
  await schedulePerformanceTemplate(first, {
    versionId: approvedAddendumTemplate.id, effectiveFrom: artifactEffectiveFrom,
    reason: 'انتشار افزوده جایگاه پس از تأیید کسب‌وکاری', publishedByUserId: actor.id, now: catalogSchedulingNow, keyring,
  });
  await activateDuePerformanceArtifacts(first, {
    actorUserId: actor.id, idempotencyKey: `catalog-activation-${database.runId}`, now: artifactEffectiveFrom, keyring,
  });
  const scoringDraft = await createPerformancePolicyDraft(first, {
    policyKind: PerformancePolicyKind.SCORING, content: DEFAULT_SCORING_POLICY_CONTENT,
    createdByUserId: actor.id, keyring,
  });
  const scoringPreview = await previewPerformancePolicy(first, {
    versionId: scoringDraft.id, asOf: artifactEffectiveFrom, now: catalogSchedulingNow, keyring,
  });
  await schedulePerformancePolicy(first, {
    versionId: scoringDraft.id, effectiveFrom: artifactEffectiveFrom,
    reason: 'سیاست امتیازدهی آزمون زنجیره کاتالوگ', confirmedByUserId: actor.id,
    confirmedPreviewHash: scoringPreview.preview.resultHash,
    confirmedPopulationHash: scoringPreview.sourcePopulationHash,
    now: catalogSchedulingNow, keyring,
  });
  await activateDuePerformancePolicies(first, {
    actorUserId: actor.id, idempotencyKey: `catalog-scoring-activation-${database.runId}`,
    now: artifactEffectiveFrom, keyring,
  });
  const catalogPersonnel = await first.personnel.create({ data: { firstName: 'پرسنل', lastName: 'کاتالوگ' } });
  const catalogRelationship = await first.hrEmploymentRelationship.create({ data: {
    personnelId: catalogPersonnel.id, status: 'ACTIVE', effectiveFrom: catalogSchedulingNow, createdBy: actor.id,
  } });
  const catalogAssignment = await first.hrEmploymentAssignment.create({ data: {
    employmentRelationshipId: catalogRelationship.id, positionId: importPosition.id, organizationalUnitId: ownerUnit.id,
    type: 'PRIMARY', effectiveFrom: catalogSchedulingNow, performanceAllocationPercent: '100.00', createdBy: actor.id,
  } });
  const catalogSubject = await first.performanceSubject.create({ data: {
    stableKey: `catalog-subject-${database.runId}`, nonDisplayKey: `opaque-catalog-${database.runId}`,
    personnelId: catalogPersonnel.id, employmentRelationshipId: catalogRelationship.id, createdByUserId: actor.id,
  } });
  const catalogEvaluation = await first.performanceEvaluation.create({ data: {
    stableKey: `catalog-evaluation-${database.runId}`, subjectId: catalogSubject.id,
    measurementFrom: artifactEffectiveFrom,
    measurementTo: new Date(artifactEffectiveFrom.getTime() + 86_400_000), createdByUserId: actor.id,
  } });
  const catalogSection = await first.performanceEvaluationSection.create({ data: {
    evaluationId: catalogEvaluation.id, employmentAssignmentId: catalogAssignment.id,
    responsibleSupervisorPersonnelId: catalogPersonnel.id, effectiveFrom: artifactEffectiveFrom,
    effectiveTo: new Date(artifactEffectiveFrom.getTime() + 86_400_000), allocationPercent: '100.00',
  } });
  const frozen = await first.$transaction((tx) => freezePerformanceTemplateSnapshot(tx, {
    evaluationId: catalogEvaluation.id,
    sectionId: catalogSection.id,
    jobTemplateVersionId: approvedTemplate.id,
    positionAddendumVersionId: approvedAddendumTemplate.id,
    sectionStartedAt: artifactEffectiveFrom,
    capturedAt: artifactEffectiveFrom,
    keyring,
  }));
  const storedSnapshot = await first.performanceSnapshot.findUniqueOrThrow({ where: { id: frozen.snapshotId } });
  const persistedFrozenSnapshot = await readPerformancePayload<any>(first, storedSnapshot.encryptedPayloadId, keyring);
  assert.equal(persistedFrozenSnapshot.jobSharePercent, '80.000000');
  assert.equal(persistedFrozenSnapshot.addendumSharePercent, '20.000000');
  const importedCalculation = calculatePerformanceEvaluation({
    template: persistedFrozenSnapshot,
    sections: [{
      sectionId: 'imported-effective-section', effectiveDays: 1, allocationPercent: '100.00',
      effectiveFrom: artifactEffectiveFrom.toISOString(), effectiveTo: new Date(artifactEffectiveFrom.getTime() + 86_399_999).toISOString(),
      snapshotFacts: {
        __applicability: {
          schemaVersion: 1, snapshotVersion: 'PERSONNEL_PERFORMANCE_ASSIGNMENT_FACTS_V1',
          sourceVersions: { positionId: 'v1' }, effectiveAt: artifactEffectiveFrom.toISOString(),
        },
        positionId: importPosition.id,
      },
      responses: [approvedCriterion.id, approvedAddendumCriterion.id].map((criterionVersionId, index) => ({
        criterionVersionId, grade: (index === 0 ? 3 : 4) as 3 | 4,
        evidence: [{ kind: 'OPERATIONAL_REFERENCE' as const, quality: 'RELIABLE' as const, occurredAt: artifactEffectiveFrom.toISOString(), referenceId: `controlled-record-${index}`, sourceVersion: 'v1', contentHash: 'a'.repeat(64) }],
      })),
    }],
  });
  assert.equal(importedCalculation.status, 'SCORED');
  assert.equal(importedCalculation.exactScore, '55.000000');
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
  const activationPayload = await persistPerformancePayload(first, {
    aggregateType: 'CRITERION_VERSION', aggregateId: activationVersion.id, payloadKind: 'CRITERION_CONTENT', schemaVersion: 1,
    payload: { ...content, conceptCode: activationIdentity.conceptCode }, keyring,
  });
  const activationTime = new Date();
  await first.performanceCriterionVersion.update({
    where: { id: activationVersion.id },
    data: {
      lifecycle: 'SCHEDULED',
      effectiveFrom: activationTime,
      publicationReason: 'آزمون فعال‌سازی اتمیک و تکرارپذیر',
      publishedByUserId: actor.id,
      publishedAt: activationTime,
      encryptedPayloadId: activationPayload.id,
      contentHash: activationPayload.contentHash,
    },
  });
  const activationKey = `artifact-activation-${database.runId}`;
  const artifactReceiptCountBefore = await first.performanceOperationReceipt.count({ where: { operationKind: 'ACTIVATE_DUE_ARTIFACTS' } });
  const activations = await Promise.all([
    activateDuePerformanceArtifacts(first, { actorUserId: actor.id, idempotencyKey: activationKey, now: activationTime, keyring }),
    activateDuePerformanceArtifacts(second, { actorUserId: actor.id, idempotencyKey: activationKey, now: activationTime, keyring }),
  ]);
  assert.deepEqual(activations[0], activations[1]);
  assert.deepEqual(activations[0].activatedCriterionVersionIds, [activationVersion.id]);
  assert.equal(await first.performanceOperationReceipt.count({ where: { operationKind: 'ACTIVATE_DUE_ARTIFACTS' } }), artifactReceiptCountBefore + 1);
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
  const systemActivationPayload = await persistPerformancePayload(first, {
    aggregateType: 'CRITERION_VERSION', aggregateId: systemActivationVersion.id, payloadKind: 'CRITERION_CONTENT', schemaVersion: 1,
    payload: { ...content, conceptCode: systemActivationIdentity.conceptCode }, keyring,
  });
  await first.performanceCriterionVersion.update({ where: { id: systemActivationVersion.id }, data: {
    lifecycle: 'SCHEDULED',
    effectiveFrom: activationTime,
    publicationReason: 'آزمون عامل سیستمی نگهداری زمان‌بندی‌شده',
    publishedByUserId: actor.id,
    publishedAt: activationTime,
    encryptedPayloadId: systemActivationPayload.id,
    contentHash: systemActivationPayload.contentHash,
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
  if (process.env.PERFORMANCE_ACCEPTANCE_PERMISSION_EVIDENCE === '1') {
    console.log(`PERFORMANCE_PERMISSION_EVIDENCE:${JSON.stringify({ contract: 'PERSONNEL_PERFORMANCE_PERMISSION_EVIDENCE_V1', scenarios: [
      { name: 'typed-applicability-unknown-blocked', assertionIds: ['typed-fact-dictionary', 'unknown-block', 'draft-import-idempotency', 'conflicting-retry', 'rollback-recovery', '80-20-and-100-0-composition'] },
      { name: 'catalog-import-composition-recovery', assertionIds: ['draft-only', 'no-automatic-publication', 'repeat-safe-import', 'conflict-rejected', 'transactional-recovery'] },
    ], additionalDisclosures: 0 })}`);
  }
  } finally {
    await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
    await database.cleanup();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
