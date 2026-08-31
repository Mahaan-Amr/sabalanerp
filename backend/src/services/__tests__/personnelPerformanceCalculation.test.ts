import assert from 'node:assert/strict';
import {
  classifyExactPerformanceScore,
  calculateCurrentPerformanceLevel,
  calculatePerformanceEvaluation,
  performanceResultExpiry,
  reproducePerformanceCalculation,
  validatePerformanceTemplate,
  type PerformanceTemplateSnapshot,
} from '../personnelPerformanceCalculation';

const verifiedEvidence = { referenceId: 'evidence-1', sourceVersion: 'v1', contentHash: 'a'.repeat(64) };

const template: PerformanceTemplateSnapshot = {
  schemaVersion: 1,
  templateVersionId: 'template-v3',
  scoringPolicyVersionId: 'scoring-v1',
  jobSharePercent: '80.00',
  addendumSharePercent: '20.00',
  categories: [
    {
      id: 'quality',
      titleFa: 'کیفیت و دقت',
      weightPercent: '60.00',
      required: true,
      criteria: [
        {
          criterionVersionId: 'accuracy-v2',
          titleFa: 'دقت اجرا',
          weightPercent: '50.00',
          kind: 'JUDGMENT',
          anchorsFa: ['ضعیف یک', 'ضعیف دو', 'مطابق', 'بالاتر', 'برجسته'],
          applicability: { fact: 'assignmentType', operator: 'IN', values: ['PRIMARY'] },
          evidence: { minimumReliableCount: 1, allowedKinds: ['OPERATIONAL_REFERENCE'], required: true },
        },
        {
          criterionVersionId: 'safety-v1',
          titleFa: 'ایمنی',
          weightPercent: '50.00',
          kind: 'JUDGMENT',
          anchorsFa: ['ضعیف یک', 'ضعیف دو', 'مطابق', 'بالاتر', 'برجسته'],
          applicability: { fact: 'hasSafetyDuty', operator: 'EQUALS', values: [true] },
          evidence: { minimumReliableCount: 1, allowedKinds: ['CONTROLLED_DOCUMENT'], required: true },
        },
      ],
    },
    {
      id: 'collaboration',
      titleFa: 'همکاری حرفه‌ای',
      weightPercent: '40.00',
      required: true,
      criteria: [
        {
          criterionVersionId: 'collaboration-v4',
          titleFa: 'همکاری',
          weightPercent: '100.00',
          kind: 'JUDGMENT',
          anchorsFa: ['ضعیف یک', 'ضعیف دو', 'مطابق', 'بالاتر', 'برجسته'],
          applicability: null,
          evidence: { minimumReliableCount: 1, allowedKinds: ['STRUCTURED_OBSERVATION'], required: true },
        },
      ],
    },
  ],
};

assert.deepEqual(validatePerformanceTemplate(template), []);
assert.match(
  validatePerformanceTemplate({
    ...template,
    categories: template.categories.map((category, index) => (
      index === 0 ? { ...category, weightPercent: '59.99' } : category
    )),
  })[0],
  /دقیقاً ۱۰۰ درصد/,
);

const evaluation = calculatePerformanceEvaluation({
  template,
  sections: [
    {
      sectionId: 'section-primary',
      effectiveDays: 30,
      allocationPercent: '100.00',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-01-31T23:59:59.999Z',
      snapshotFacts: { assignmentType: 'PRIMARY', hasSafetyDuty: false },
      responses: [
        {
          criterionVersionId: 'accuracy-v2',
          grade: 5,
          evidence: [{ kind: 'OPERATIONAL_REFERENCE', quality: 'RELIABLE', occurredAt: '2026-01-15', ...verifiedEvidence }],
        },
        {
          criterionVersionId: 'safety-v1',
          notApplicable: { requestedReason: 'این مأموریت مسئولیت ایمنی ندارد.', approvedByHr: true },
          evidence: [],
        },
        {
          criterionVersionId: 'collaboration-v4',
          grade: 3,
          evidence: [{ kind: 'STRUCTURED_OBSERVATION', quality: 'RELIABLE', occurredAt: '2026-01-20', ...verifiedEvidence }],
        },
      ],
    },
    {
      sectionId: 'section-secondary',
      effectiveDays: 10,
      allocationPercent: '50.00',
      effectiveFrom: '2026-02-01T00:00:00.000Z',
      effectiveTo: '2026-02-28T23:59:59.999Z',
      snapshotFacts: { assignmentType: 'PRIMARY', hasSafetyDuty: true },
      responses: [
        {
          criterionVersionId: 'accuracy-v2',
          grade: 3,
          evidence: [{ kind: 'OPERATIONAL_REFERENCE', quality: 'RELIABLE', occurredAt: '2026-02-10', ...verifiedEvidence }],
        },
        {
          criterionVersionId: 'safety-v1',
          grade: 3,
          evidence: [{ kind: 'CONTROLLED_DOCUMENT', quality: 'RELIABLE', occurredAt: '2026-02-11', ...verifiedEvidence }],
        },
        {
          criterionVersionId: 'collaboration-v4',
          grade: 3,
          evidence: [{ kind: 'STRUCTURED_OBSERVATION', quality: 'RELIABLE', occurredAt: '2026-02-12', ...verifiedEvidence }],
        },
      ],
    },
  ],
});

assert.equal(evaluation.status, 'SCORED');
assert.equal(evaluation.exactScore, '75.714286');
assert.equal(evaluation.displayScore, '75.71');
assert.equal(evaluation.trace.sections[0].exactScore, '80.000000');
const reproducedEvaluation = reproducePerformanceCalculation(evaluation.trace);
assert.equal(reproducedEvaluation.exactScore, '75.714286');
assert.equal(reproducedEvaluation.matchesStoredResult, true);
assert.ok(reproducedEvaluation.sections.every(({ matchesStoredSection }) => matchesStoredSection));
assert.deepEqual(evaluation.trace.sections[0].categories[0].criteria.map((criterion) => ({
  id: criterion.criterionVersionId,
  original: criterion.originalWeightPercent,
  effective: criterion.effectiveWeightPercent,
  decision: criterion.applicabilityDecision,
})), [
  { id: 'accuracy-v2', original: '30.000000', effective: '60.000000', decision: 'APPLICABLE' },
  { id: 'safety-v1', original: '30.000000', effective: '0.000000', decision: 'NOT_APPLICABLE' },
]);

const inadequateEvidence = calculatePerformanceEvaluation({
  template,
  sections: [{
    sectionId: 'section-with-disputed-evidence',
    effectiveDays: 30,
    allocationPercent: '100.00',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: '2026-01-31T23:59:59.999Z',
    snapshotFacts: { assignmentType: 'PRIMARY', hasSafetyDuty: false },
    responses: [
      {
        criterionVersionId: 'accuracy-v2',
        grade: 5,
        evidence: [{ kind: 'OPERATIONAL_REFERENCE', quality: 'DISPUTED', occurredAt: '2026-01-15', ...verifiedEvidence }],
      },
      {
        criterionVersionId: 'safety-v1',
        notApplicable: { requestedReason: 'این مأموریت مسئولیت ایمنی ندارد.', approvedByHr: true },
        evidence: [],
      },
      {
        criterionVersionId: 'collaboration-v4',
        grade: 3,
        evidence: [{ kind: 'STRUCTURED_OBSERVATION', quality: 'RELIABLE', occurredAt: '2026-01-20', ...verifiedEvidence }],
      },
    ],
  }],
});
assert.equal(inadequateEvidence.status, 'NOT_EVALUABLE');
assert.ok(inadequateEvidence.reasons.some((reason) => reason.includes('شاهد قابل اتکا')));

const unverifiableEvidence = calculatePerformanceEvaluation({
  template: {
    ...template,
    categories: [{ ...template.categories[0], weightPercent: '100.00', criteria: [{ ...template.categories[0].criteria[0], weightPercent: '100.00' }] }],
    jobSharePercent: '100.00',
    addendumSharePercent: '0.00',
  },
  sections: [{
    sectionId: 'unverifiable-evidence', effectiveDays: 1, allocationPercent: '100.00',
    effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-01-31T23:59:59.999Z', snapshotFacts: { assignmentType: 'PRIMARY' },
    responses: [{
      criterionVersionId: 'accuracy-v2', grade: 5,
      evidence: [{ kind: 'OPERATIONAL_REFERENCE', quality: 'RELIABLE', occurredAt: '2026-01-15', referenceId: '', sourceVersion: '', contentHash: 'not-a-hash' }],
    }],
  }],
});
assert.equal(unverifiableEvidence.status, 'NOT_EVALUABLE');

const optionalEvidenceTemplate: PerformanceTemplateSnapshot = {
  ...template,
  jobSharePercent: '100.00',
  addendumSharePercent: '0.00',
  categories: [{
    ...template.categories[0],
    weightPercent: '100.00',
    criteria: [{
      ...template.categories[0].criteria[0],
      weightPercent: '100.00',
      evidence: { ...template.categories[0].criteria[0].evidence, required: false },
    }],
  }],
};
const optionalEvidence = calculatePerformanceEvaluation({
  template: optionalEvidenceTemplate,
  sections: [{
    sectionId: 'optional-evidence', effectiveDays: 1, allocationPercent: '100.00',
    effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-01-31T23:59:59.999Z',
    snapshotFacts: { assignmentType: 'PRIMARY' },
    responses: [{ criterionVersionId: 'accuracy-v2', grade: 5, evidence: [] }],
  }],
});
assert.equal(optionalEvidence.status, 'SCORED');

const overlappingAllocation = calculatePerformanceEvaluation({
  template: optionalEvidenceTemplate,
  sections: ['first', 'second'].map((sectionId) => ({
    sectionId, effectiveDays: 1, allocationPercent: '60.00',
    effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-01-31T23:59:59.999Z',
    snapshotFacts: { assignmentType: 'PRIMARY' },
    responses: [{ criterionVersionId: 'accuracy-v2', grade: 3 as const, evidence: [] }],
  })),
});
assert.equal(overlappingAllocation.status, 'BLOCKED');
assert.ok(overlappingAllocation.reasons.some((reason) => reason.includes('هم‌پوشان')));

const templateWithNonScoringCriteria: PerformanceTemplateSnapshot = {
  ...template,
  categories: template.categories.map((category, index) => index === 0 ? {
    ...category,
    criteria: [...category.criteria, {
      criterionVersionId: 'safety-gate-v1', titleFa: 'کنترل ایمنی', weightPercent: '0.00', kind: 'BINARY_GATE',
      anchorsFa: [], applicability: null, evidence: { minimumReliableCount: 0, allowedKinds: [], required: true },
    }, {
      criterionVersionId: 'kpi-v1', titleFa: 'شاخص عملیاتی', weightPercent: '0.00', kind: 'KPI_EVIDENCE',
      anchorsFa: [], applicability: null, evidence: { minimumReliableCount: 0, allowedKinds: ['OPERATIONAL_REFERENCE'], required: true },
    }],
  } : category),
};
assert.deepEqual(validatePerformanceTemplate(templateWithNonScoringCriteria), []);
const blockedByGate = calculatePerformanceEvaluation({
  template: templateWithNonScoringCriteria,
  sections: [{
    sectionId: 'gate', effectiveDays: 1, allocationPercent: '100.00',
    effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-01-31T23:59:59.999Z', snapshotFacts: { assignmentType: 'PRIMARY', hasSafetyDuty: false },
    responses: [
      { criterionVersionId: 'accuracy-v2', grade: 3, evidence: [{ kind: 'OPERATIONAL_REFERENCE', quality: 'RELIABLE', occurredAt: '2026-01-15', ...verifiedEvidence }] },
      { criterionVersionId: 'safety-v1', notApplicable: { requestedReason: 'فاقد مأموریت ایمنی', approvedByHr: true }, evidence: [] },
      { criterionVersionId: 'collaboration-v4', grade: 3, evidence: [{ kind: 'STRUCTURED_OBSERVATION', quality: 'RELIABLE', occurredAt: '2026-01-15', ...verifiedEvidence }] },
      { criterionVersionId: 'safety-gate-v1', binaryGatePassed: false, evidence: [] },
      { criterionVersionId: 'kpi-v1', evidence: [] },
    ],
  }],
});
assert.equal(blockedByGate.status, 'BLOCKED');

const allNotApplicableCategory = calculatePerformanceEvaluation({
  template,
  sections: [{
    sectionId: 'redistributed-category',
    effectiveDays: 1,
    allocationPercent: '100.00',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: '2026-01-31T23:59:59.999Z',
    snapshotFacts: { assignmentType: 'SECONDARY', hasSafetyDuty: false },
    responses: [{
      criterionVersionId: 'collaboration-v4',
      grade: 3,
      evidence: [{ kind: 'STRUCTURED_OBSERVATION', quality: 'RELIABLE', occurredAt: '2026-01-20', ...verifiedEvidence }],
    }],
  }],
});
assert.equal(allNotApplicableCategory.status, 'SCORED');
assert.equal(allNotApplicableCategory.exactScore, '50.000000');
assert.equal(allNotApplicableCategory.trace.sections[0].categories[0].effectiveWeightPercent, '0.000000');
assert.equal(allNotApplicableCategory.trace.sections[0].categories[1].effectiveWeightPercent, '100.000000');

const kpiEvidenceRequired = calculatePerformanceEvaluation({
  template: {
    ...templateWithNonScoringCriteria,
    categories: templateWithNonScoringCriteria.categories.map((category, index) => index === 0 ? {
      ...category,
      criteria: category.criteria.map((criterion) => criterion.criterionVersionId === 'kpi-v1'
        ? { ...criterion, evidence: { ...criterion.evidence, minimumReliableCount: 1 } }
        : criterion),
    } : category),
  },
  sections: [{
    sectionId: 'kpi-evidence', effectiveDays: 1, allocationPercent: '100.00',
    effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-01-31T23:59:59.999Z', snapshotFacts: { assignmentType: 'PRIMARY', hasSafetyDuty: false },
    responses: [
      { criterionVersionId: 'accuracy-v2', grade: 3, evidence: [{ kind: 'OPERATIONAL_REFERENCE', quality: 'RELIABLE', occurredAt: '2026-01-15', ...verifiedEvidence }] },
      { criterionVersionId: 'safety-v1', notApplicable: { requestedReason: 'فاقد مأموریت ایمنی', approvedByHr: true }, evidence: [] },
      { criterionVersionId: 'collaboration-v4', grade: 3, evidence: [{ kind: 'STRUCTURED_OBSERVATION', quality: 'RELIABLE', occurredAt: '2026-01-15', ...verifiedEvidence }] },
      { criterionVersionId: 'safety-gate-v1', binaryGatePassed: true, evidence: [] },
      { criterionVersionId: 'kpi-v1', evidence: [] },
    ],
  }],
});
assert.equal(kpiEvidenceRequired.status, 'NOT_EVALUABLE');
assert.ok(kpiEvidenceRequired.reasons.some((reason) => reason.includes('شاخص عملیاتی')));

const tamperedTrace = structuredClone(evaluation.trace);
tamperedTrace.sections[0].categories[0].criteria[0].evidence[0].contentHash = 'invalid';
assert.equal(reproducePerformanceCalculation(tamperedTrace).matchesStoredResult, false);
assert.equal(evaluation.trace.sections[0].categories[0].criteria[0].evidence[0].referenceId, 'evidence-1');

const level = calculateCurrentPerformanceLevel({
  asOf: new Date('2026-06-01T00:00:00.000Z'),
  nextPolicyEffectiveAt: new Date('2026-07-01T00:00:00.000Z'),
  policy: {
    versionId: 'level-v2',
    thresholds: [
      { code: 'URGENT_IMPROVEMENT', titleFa: 'نیازمند بهبود فوری', minimum: '0.000000', maximumExclusive: '20.000000' },
      { code: 'IMPROVEMENT', titleFa: 'نیازمند بهبود', minimum: '20.000000', maximumExclusive: '40.000000' },
      { code: 'MEETS', titleFa: 'مطابق انتظار', minimum: '40.000000', maximumExclusive: '60.000000' },
      { code: 'EXCEEDS', titleFa: 'فراتر از انتظار', minimum: '60.000000', maximumExclusive: '80.000000' },
      { code: 'OUTSTANDING', titleFa: 'عملکرد برجسته', minimum: '80.000000', maximumInclusive: '100.000000' },
    ],
  },
  results: [
    { resultId: 'newer', exactScore: '80.000000', measurementTo: '2026-04-30T20:29:59.999Z', expiresAt: '2027-04-30T20:29:59.999Z', status: 'EFFECTIVE' },
    { resultId: 'older', exactScore: '60.000000', measurementTo: '2026-03-31T20:29:59.999Z', expiresAt: '2027-03-31T20:29:59.999Z', status: 'EFFECTIVE' },
  ],
});
assert.equal(level.state, 'LEVEL');
assert.equal(level.exactScore, '72.500000');
assert.equal(level.levelCode, 'EXCEEDS');
assert.equal(level.nextReviewAt, '2026-07-01T00:00:00.000Z');
assert.deepEqual(level.trace.inputs.map(({ resultId, normalizedWeightPercent }) => ({ resultId, normalizedWeightPercent })), [
  { resultId: 'newer', normalizedWeightPercent: '62.500000' },
  { resultId: 'older', normalizedWeightPercent: '37.500000' },
]);

assert.deepEqual(
  classifyExactPerformanceScore({
    versionId: 'level-v2',
    thresholds: [
      { code: 'URGENT_IMPROVEMENT', titleFa: 'نیازمند بهبود فوری', minimum: '0.000000', maximumExclusive: '20.000000' },
      { code: 'IMPROVEMENT', titleFa: 'نیازمند بهبود', minimum: '20.000000', maximumExclusive: '40.000000' },
      { code: 'MEETS', titleFa: 'مطابق انتظار', minimum: '40.000000', maximumExclusive: '60.000000' },
      { code: 'EXCEEDS', titleFa: 'فراتر از انتظار', minimum: '60.000000', maximumExclusive: '80.000000' },
      { code: 'OUTSTANDING', titleFa: 'عملکرد برجسته', minimum: '80.000000', maximumInclusive: '100.000000' },
    ],
  }, '80'),
  { exactScore: '80.000000', levelCode: 'OUTSTANDING', levelTitleFa: 'عملکرد برجسته' },
);

assert.equal(
  performanceResultExpiry(new Date('2025-01-01T08:00:00.000Z')).toISOString(),
  '2026-01-01T20:29:59.999Z',
);

console.log('Personnel performance calculation tests passed.');
