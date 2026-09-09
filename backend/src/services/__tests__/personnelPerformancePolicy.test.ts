import assert from 'node:assert/strict';
import {
  buildDeterministicPolicyPreview,
  canonicalPerformanceHash,
  validateCriterionPolicyContent,
  validateLevelPolicyContent,
  validatePerformancePublication,
} from '../personnelPerformancePolicy';
import { validatePerformanceVaultEnvironment } from '../personnelPerformancePayloadStore';
import type { PerformanceCriterionPolicyContent } from '../personnelPerformancePolicy';
import {
  inspectPerformanceRoleCatalogManifest,
  performanceRoleCatalogContentHash,
} from '../personnelPerformanceRoleCatalog';

assert.throws(() => validatePerformanceVaultEnvironment({
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'production-v1',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: Buffer.alloc(16).toString('base64'),
}), /exact 32-byte/);
assert.equal(validatePerformanceVaultEnvironment({
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'production-v1',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
}).key.length, 32);

const criterion = {
  schemaVersion: 1 as const,
  conceptCode: 'PERF-QLT-014',
  titleFa: 'کیفیت اجرای مسئولیت',
  meaningFa: 'کیفیت پایدار خروجی را در متن مأموریت می‌سنجد.',
  kind: 'JUDGMENT' as const,
  anchorsFa: [
    'به‌طور جدی پایین‌تر از انتظار',
    'پایین‌تر از انتظار',
    'مطابق انتظار',
    'بالاتر از انتظار',
    'به‌طور استثنایی بالاتر از انتظار',
  ],
  applicability: { fact: 'jobId', operator: 'IN' as const, values: ['job-1'] },
  evidence: {
    allowedKinds: ['OPERATIONAL_REFERENCE' as const],
    minimumReliableCount: 1,
    lookbackDays: 30,
    required: true,
  },
};

assert.deepEqual(validateCriterionPolicyContent(criterion), []);
assert.ok(validateCriterionPolicyContent({
  ...criterion,
  applicability: { fact: 'personnelId', operator: 'IN', values: ['person-1'] },
}).some((message) => message.includes('واقعیت کنترل‌شده')));
assert.ok(validateCriterionPolicyContent({ ...criterion, anchorsFa: criterion.anchorsFa.slice(0, 4) })
  .some((message) => message.includes('پنج درجه')));

const typedCriterion: PerformanceCriterionPolicyContent = {
  ...criterion,
  applicability: {
    schemaVersion: 1 as const,
    fact: 'hasSafetyDuty',
    factType: 'BOOLEAN' as const,
    source: 'VERSIONED_DOCUMENTED_DUTY',
    sourceVersion: 'v1',
    operator: 'EQUALS' as const,
    values: [true],
  },
};
assert.deepEqual(validateCriterionPolicyContent(typedCriterion), []);
assert.ok(validateCriterionPolicyContent({
  ...typedCriterion,
  applicability: { ...typedCriterion.applicability, values: ['true'] },
} as PerformanceCriterionPolicyContent).some((message) => message.includes('نوع')));
assert.ok(validateCriterionPolicyContent({
  ...typedCriterion,
  applicability: { ...typedCriterion.applicability, fact: 'locationId', factType: 'ID' },
} as PerformanceCriterionPolicyContent).some((message) => message.includes('workplaceId')));
assert.ok(validateCriterionPolicyContent({
  ...typedCriterion,
  applicability: { ...typedCriterion.applicability, operator: 'EXISTS', values: [true] },
} as PerformanceCriterionPolicyContent).some((message) => message.includes('بدون مقدار')));
assert.ok(validateCriterionPolicyContent({
  ...typedCriterion,
  applicability: { ...typedCriterion.applicability, fact: 'responsibilityCodes', factType: 'STRING_LIST', operator: 'EQUALS' },
} as PerformanceCriterionPolicyContent).some((message) => message.includes('فهرستی')));
assert.ok(validateCriterionPolicyContent({
  ...typedCriterion,
  applicability: { ...typedCriterion.applicability, schemaVersion: 2 },
} as unknown as PerformanceCriterionPolicyContent).some((message) => message.includes('نسخه قاعده')));
assert.ok(validateCriterionPolicyContent({
  ...typedCriterion,
  applicability: { ...typedCriterion.applicability, operator: 'NOT_EQUALS' },
} as unknown as PerformanceCriterionPolicyContent).some((message) => message.includes('عملگر')));

const catalogManifest: any = {
  schemaVersion: 1,
  catalog: {
    stableKey: 'PERF_ROLE_CATALOG_TEST', versionCode: 'TEST_V1', lifecycle: 'DRAFT',
    importIdentity: 'PERF-ROLE-CATALOG:TEST:V1', contentHash: '0'.repeat(64),
    contentHashMethod: 'SHA256_CANONICAL_JSON_EXCLUDING_CATALOG_CONTENT_HASH',
  },
  source: { provenanceCategory: 'PRODUCTION', asOf: '2026-09-09T00:00:00.000Z', references: ['controlled-source-v1'], extractedFacts: true },
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
    reference: { code: 'JOB_ACCOUNTING', id: 'job-1', synthetic: false }, titleFa: 'کارشناس حسابداری',
    categories: [{ code: 'CORE', titleFa: 'اصلی', weight: 100 }],
    criteria: [{
      conceptCode: 'ACCOUNTING_QUALITY', versionCode: 'ACCOUNTING_QUALITY_V1', titleFa: 'کیفیت ثبت', meaningFa: 'ثبت دقیق و قابل پیگیری',
      kind: 'JUDGMENT', categoryCode: 'CORE', weight: 100, applicability: null,
      anchorsFa: ['خیلی ضعیف', 'ضعیف', 'مطابق انتظار', 'خوب', 'برجسته'],
      evidencePolicy: { dictionaryCodes: ['CONTROLLED_SOURCE'], minimumReliableCount: 1, windowDays: 30, automaticGrade: false },
      outsideControlFactors: ['نبود سند ورودی'],
    }],
  }],
  positions: [{
    reference: { code: 'POSITION_PAYABLES', id: 'position-1', synthetic: false }, jobReferenceCode: 'JOB_ACCOUNTING', titleFa: 'کارشناس پرداختنی',
    composition: { jobWeight: 80, addendumWeight: 20 }, categories: [{ code: 'ADDENDUM', titleFa: 'افزوده', weight: 100 }],
    criteria: [{
      conceptCode: 'PAYABLES_CONTROL', versionCode: 'PAYABLES_CONTROL_V1', titleFa: 'کنترل پرداخت', meaningFa: 'کنترل دقیق پرداختنی‌ها',
      kind: 'JUDGMENT', categoryCode: 'ADDENDUM', weight: 100,
      applicability: { schemaVersion: 1, fact: 'positionId', factType: 'ID', operator: 'EQUALS', values: ['POSITION_PAYABLES'] },
      anchorsFa: ['خیلی ضعیف', 'ضعیف', 'مطابق انتظار', 'خوب', 'برجسته'],
      evidencePolicy: { dictionaryCodes: ['CONTROLLED_SOURCE'], minimumReliableCount: 1, windowDays: 30, automaticGrade: false },
      outsideControlFactors: ['نبود سند ورودی'],
    }],
  }, {
    reference: { code: 'POSITION_ACCOUNTING', id: 'position-2', synthetic: false }, jobReferenceCode: 'JOB_ACCOUNTING', titleFa: 'کارشناس عمومی',
    composition: { jobWeight: 100, addendumWeight: 0 }, categories: [], criteria: [],
  }],
};
catalogManifest.catalog.contentHash = performanceRoleCatalogContentHash(catalogManifest);
const inspectedCatalog = inspectPerformanceRoleCatalogManifest(catalogManifest);
assert.deepEqual(inspectedCatalog.errors, []);
assert.equal(inspectedCatalog.plan?.importable, true);
assert.deepEqual(inspectedCatalog.plan?.compositions.map(({ jobSharePercent, addendumSharePercent, basis }) => ({ jobSharePercent, addendumSharePercent, basis })), [
  { jobSharePercent: '80.00', addendumSharePercent: '20.00', basis: 'JOB_WITH_POSITION_ADDENDUM' },
  { jobSharePercent: '100.00', addendumSharePercent: '0.00', basis: 'JOB_ONLY' },
]);
assert.deepEqual(inspectedCatalog.plan?.criteria[1].content.applicability, {
  schemaVersion: 1, fact: 'positionId', factType: 'ID', source: 'employment-assignment', sourceVersion: 'v1', operator: 'EQUALS', values: ['position-1'],
});
const nonBlockingUnknown = structuredClone(catalogManifest);
nonBlockingUnknown.applicabilityDictionary[0].unknown = 'NOT_APPLICABLE';
nonBlockingUnknown.catalog.contentHash = performanceRoleCatalogContentHash(nonBlockingUnknown);
assert.ok(inspectPerformanceRoleCatalogManifest(nonBlockingUnknown).errors.some((message) => message.includes('BLOCK')));
assert.doesNotThrow(() => inspectPerformanceRoleCatalogManifest({ ...catalogManifest, jobs: [null] }));
assert.ok(inspectPerformanceRoleCatalogManifest({ ...catalogManifest, jobs: [null] }).errors.some((message) => message.includes('ساختار کاتالوگ ناقص')));
const orphanCriterion = structuredClone(catalogManifest);
orphanCriterion.jobs[0].criteria[0].categoryCode = 'UNKNOWN_CATEGORY';
orphanCriterion.catalog.contentHash = performanceRoleCatalogContentHash(orphanCriterion);
assert.ok(inspectPerformanceRoleCatalogManifest(orphanCriterion).errors.some((message) => message.includes('دسته تعریف‌نشده')));
const unknownProvenance = structuredClone(catalogManifest);
unknownProvenance.source.provenanceCategory = 'TYPO_PROVENANCE';
unknownProvenance.catalog.contentHash = performanceRoleCatalogContentHash(unknownProvenance);
assert.ok(inspectPerformanceRoleCatalogManifest(unknownProvenance).errors.some((message) => message.includes('رده منشأ')));
const inconsistentSynthetic = structuredClone(catalogManifest);
inconsistentSynthetic.source.provenanceCategory = 'SYNTHETIC';
inconsistentSynthetic.source.extractedFacts = false;
inconsistentSynthetic.catalog.contentHash = performanceRoleCatalogContentHash(inconsistentSynthetic);
assert.ok(inspectPerformanceRoleCatalogManifest(inconsistentSynthetic).errors.some((message) => message.includes('منشأ ساختگی')));
const wrongOwnerType = structuredClone(catalogManifest);
wrongOwnerType.positions[0].criteria[0].applicability.fact = 'jobId';
wrongOwnerType.positions[0].criteria[0].applicability.values = ['POSITION_PAYABLES'];
wrongOwnerType.catalog.contentHash = performanceRoleCatalogContentHash(wrongOwnerType);
assert.ok(inspectPerformanceRoleCatalogManifest(wrongOwnerType).errors.some((message) => message.includes('نوع نادرست')));
const unresolvedOwnerReference = structuredClone(catalogManifest);
unresolvedOwnerReference.positions[0].criteria[0].applicability.values = ['POSITION_DOES_NOT_EXIST'];
unresolvedOwnerReference.catalog.contentHash = performanceRoleCatalogContentHash(unresolvedOwnerReference);
assert.ok(inspectPerformanceRoleCatalogManifest(unresolvedOwnerReference).errors.some((message) => message.includes('حل نشده')));
const unknownEvidence = structuredClone(catalogManifest);
unknownEvidence.evidenceDictionary[0].classification = 'BOGUS';
unknownEvidence.catalog.contentHash = performanceRoleCatalogContentHash(unknownEvidence);
assert.ok(inspectPerformanceRoleCatalogManifest(unknownEvidence).errors.some((message) => message.includes('طبقه‌بندی پشتیبانی‌شده')));
const malformedApplicability = structuredClone(catalogManifest);
delete malformedApplicability.positions[0].criteria[0].applicability.values;
assert.doesNotThrow(() => inspectPerformanceRoleCatalogManifest(malformedApplicability));
assert.ok(inspectPerformanceRoleCatalogManifest(malformedApplicability).errors.some((message) => message.includes('ساختار کاتالوگ ناقص')));
const malformedAnchor = structuredClone(catalogManifest);
malformedAnchor.jobs[0].criteria[0].anchorsFa[0] = null;
assert.doesNotThrow(() => inspectPerformanceRoleCatalogManifest(malformedAnchor));
assert.ok(inspectPerformanceRoleCatalogManifest(malformedAnchor).errors.some((message) => message.includes('ساختار کاتالوگ ناقص')));
const missingTypedSchema = structuredClone(catalogManifest);
delete missingTypedSchema.positions[0].criteria[0].applicability.schemaVersion;
missingTypedSchema.catalog.contentHash = performanceRoleCatalogContentHash(missingTypedSchema);
assert.ok(inspectPerformanceRoleCatalogManifest(missingTypedSchema).errors.some((message) => message.includes('نسخه یا نوع')));
const mismatchedTypedFact = structuredClone(catalogManifest);
mismatchedTypedFact.positions[0].criteria[0].applicability.factType = 'BOOLEAN';
mismatchedTypedFact.catalog.contentHash = performanceRoleCatalogContentHash(mismatchedTypedFact);
assert.ok(inspectPerformanceRoleCatalogManifest(mismatchedTypedFact).errors.some((message) => message.includes('نسخه یا نوع')));
const driftedDictionaryOperators = structuredClone(catalogManifest);
driftedDictionaryOperators.applicabilityDictionary.find((entry: any) => entry.fact === 'jobId').operators.push('EXISTS');
driftedDictionaryOperators.catalog.contentHash = performanceRoleCatalogContentHash(driftedDictionaryOperators);
assert.ok(inspectPerformanceRoleCatalogManifest(driftedDictionaryOperators).errors.some((message) => message.includes('عملگرهای فرهنگ')));
const excessivePrecision = structuredClone(catalogManifest);
excessivePrecision.jobs[0].categories[0].weight = 100.001;
excessivePrecision.catalog.contentHash = performanceRoleCatalogContentHash(excessivePrecision);
assert.ok(inspectPerformanceRoleCatalogManifest(excessivePrecision).errors.some((message) => message.includes('جمع وزن دسته‌ها')));
const malformedSource = structuredClone(catalogManifest);
malformedSource.applicabilityDictionary[0].source = 42;
malformedSource.catalog.contentHash = performanceRoleCatalogContentHash(malformedSource);
assert.doesNotThrow(() => inspectPerformanceRoleCatalogManifest(malformedSource));
assert.ok(inspectPerformanceRoleCatalogManifest(malformedSource).errors.some((message) => message.includes('منبع نسخه‌دار')));
const malformedWeights = structuredClone(catalogManifest);
malformedWeights.positions[0].composition.jobWeight = '80';
assert.doesNotThrow(() => inspectPerformanceRoleCatalogManifest(malformedWeights));
assert.ok(inspectPerformanceRoleCatalogManifest(malformedWeights).errors.some((message) => message.includes('ساختار کاتالوگ ناقص')));
const invalidCriterionPolicy = structuredClone(catalogManifest);
invalidCriterionPolicy.jobs[0].criteria[0].evidencePolicy.minimumReliableCount = 0;
invalidCriterionPolicy.jobs[0].criteria[0].evidencePolicy.automaticGrade = true;
invalidCriterionPolicy.jobs[0].criteria[0].outsideControlFactors = [];
invalidCriterionPolicy.catalog.contentHash = performanceRoleCatalogContentHash(invalidCriterionPolicy);
assert.equal(inspectPerformanceRoleCatalogManifest(invalidCriterionPolicy).plan, null,
  'preview must reject policy content that import would reject');
const selfApproved = structuredClone(catalogManifest);
selfApproved.review.status = 'APPROVED';
selfApproved.review.reviewerRole = 'UNASSIGNED';
selfApproved.review.reviewedAt = null;
selfApproved.catalog.contentHash = performanceRoleCatalogContentHash(selfApproved);
assert.ok(inspectPerformanceRoleCatalogManifest(selfApproved).errors.some((message) => message.includes('نقش بازبین')));
const reviewedManifest = structuredClone(catalogManifest);
reviewedManifest.review = {
  contentOrigin: 'COMPANY_CONTROLLED_SOURCE', status: 'APPROVED', reviewerRole: 'HR_POLICY_OWNER', reviewedAt: '2026-09-09T08:00:00.000Z',
};
reviewedManifest.catalog.contentHash = performanceRoleCatalogContentHash(reviewedManifest);
const inspectedReviewedManifest = inspectPerformanceRoleCatalogManifest(reviewedManifest);
assert.equal(inspectedReviewedManifest.plan?.criteria[0].content.catalogSource.reviewStatus, 'BUSINESS_REVIEW_PENDING',
  'a manifest approval claim must never bypass local audited approval');
assert.equal(inspectedReviewedManifest.plan?.criteria[0].content.catalogSource.manifestReviewStatus, 'APPROVED');
const sanitizedRecovery = structuredClone(catalogManifest);
sanitizedRecovery.source.provenanceCategory = 'SANITIZED_RECOVERY';
sanitizedRecovery.catalog.contentHash = performanceRoleCatalogContentHash(sanitizedRecovery);
assert.deepEqual(inspectPerformanceRoleCatalogManifest(sanitizedRecovery).errors, []);
const mismatchedSnapshotContract = structuredClone(catalogManifest);
mismatchedSnapshotContract.applicabilitySnapshotContract.snapshotVersion = 'PERSONNEL_PERFORMANCE_ASSIGNMENT_FACTS_V2';
mismatchedSnapshotContract.catalog.contentHash = performanceRoleCatalogContentHash(mismatchedSnapshotContract);
assert.ok(inspectPerformanceRoleCatalogManifest(mismatchedSnapshotContract).errors.some((message) => message.includes('تصویر ثابت')));
const syntheticPreview = structuredClone(catalogManifest);
syntheticPreview.source.provenanceCategory = 'SYNTHETIC';
syntheticPreview.source.extractedFacts = false;
syntheticPreview.review = { contentOrigin: 'AI_PROPOSED', status: 'BUSINESS_REVIEW_PENDING', reviewerRole: 'UNASSIGNED', reviewedAt: null };
for (const owner of [...syntheticPreview.jobs, ...syntheticPreview.positions]) {
  owner.reference.id = null;
  owner.reference.synthetic = true;
}
syntheticPreview.catalog.contentHash = performanceRoleCatalogContentHash(syntheticPreview);
const inspectedSynthetic = inspectPerformanceRoleCatalogManifest(syntheticPreview);
assert.deepEqual(inspectedSynthetic.errors, []);
assert.equal(inspectedSynthetic.plan?.importable, false);
assert.ok(inspectedSynthetic.plan?.warnings.some((message) => message.includes('ساختگی')));
for (const provenanceCategory of ['SEED', 'FIXTURE', 'SANITIZED_RECOVERY', 'HISTORICAL_DOCUMENT']) {
  const nonCompanyCatalog = structuredClone(catalogManifest);
  nonCompanyCatalog.source.provenanceCategory = provenanceCategory;
  nonCompanyCatalog.catalog.contentHash = performanceRoleCatalogContentHash(nonCompanyCatalog);
  assert.equal(inspectPerformanceRoleCatalogManifest(nonCompanyCatalog).plan?.importable, false,
    `${provenanceCategory} must remain preview-only`);
}
const malformedCatalogProvenance = structuredClone(catalogManifest);
malformedCatalogProvenance.source.references = [null];
malformedCatalogProvenance.review.contentOrigin = 42;
malformedCatalogProvenance.catalog.contentHash = performanceRoleCatalogContentHash(malformedCatalogProvenance);
assert.ok(inspectPerformanceRoleCatalogManifest(malformedCatalogProvenance).errors.some((message) => message.includes('منبع کاتالوگ')));
assert.ok(inspectPerformanceRoleCatalogManifest(malformedCatalogProvenance).errors.some((message) => message.includes('منشأ محتوای')));

const levels = {
  schemaVersion: 1 as const,
  thresholds: [
    { code: 'URGENT_IMPROVEMENT', titleFa: 'نیازمند بهبود فوری', meaningFa: 'معنای یک', minimum: '0.000000', maximumExclusive: '20.000000' },
    { code: 'IMPROVEMENT', titleFa: 'نیازمند بهبود', meaningFa: 'معنای دو', minimum: '20.000000', maximumExclusive: '40.000000' },
    { code: 'MEETS', titleFa: 'مطابق انتظار', meaningFa: 'معنای سه', minimum: '40.000000', maximumExclusive: '60.000000' },
    { code: 'EXCEEDS', titleFa: 'فراتر از انتظار', meaningFa: 'معنای چهار', minimum: '60.000000', maximumExclusive: '80.000000' },
    { code: 'OUTSTANDING', titleFa: 'عملکرد برجسته', meaningFa: 'معنای پنج', minimum: '80.000000', maximumInclusive: '100.000000' },
  ],
};
assert.deepEqual(validateLevelPolicyContent(levels), []);
assert.ok(validateLevelPolicyContent({
  ...levels,
  thresholds: levels.thresholds.map((threshold, index) => index === 1
    ? { ...threshold, minimum: '20.000001' }
    : threshold),
}).some((message) => message.includes('شکاف')));

assert.deepEqual(validatePerformancePublication({
  now: new Date('2026-08-31T08:00:00.000Z'),
  effectiveFrom: new Date('2026-08-31T20:30:00.000Z'),
  reason: 'اجرای نسخه مصوب برای دوره‌های آینده',
}), []);
assert.ok(validatePerformancePublication({
  now: new Date('2026-08-31T08:00:00.000Z'),
  effectiveFrom: new Date('2026-08-31T08:30:00.000Z'),
  reason: 'اجرای گذشته‌نگر',
}).some((message) => message.includes('ابتدای روز آینده تهران')));

const preview = buildDeterministicPolicyPreview([
  { subjectId: 'subject-b', before: { state: 'LEVEL', levelCode: 'MEETS' }, after: { state: 'LEVEL', levelCode: 'EXCEEDS' } },
  { subjectId: 'subject-a', before: { state: 'LEVEL', levelCode: 'EXCEEDS' }, after: { state: 'LEVEL', levelCode: 'MEETS' } },
  { subjectId: 'subject-c', before: { state: 'LEVEL', levelCode: 'MEETS' }, after: { state: 'LEVEL', levelCode: 'MEETS' } },
  { subjectId: 'subject-d', before: { state: 'LEVEL', levelCode: 'MEETS' }, after: { state: 'NEEDS_NEW_EVALUATION', levelCode: null } },
]);
assert.deepEqual(preview.counts, {
  eligible: 4,
  evaluated: 4,
  increased: 1,
  decreased: 1,
  unchanged: 1,
  expired: 0,
  needsNewEvaluation: 1,
  errors: 0,
});
assert.deepEqual(preview.population.map(({ subjectId }) => subjectId), ['subject-a', 'subject-b', 'subject-c', 'subject-d']);
assert.equal(preview.resultHash, canonicalPerformanceHash(preview.population));

console.log('Personnel performance policy tests passed.');
