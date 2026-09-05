import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export const PERFORMANCE_GRADE_POINTS = ['0', '25', '50', '75', '100'] as const;

export type PerformanceCriterionKind = 'JUDGMENT' | 'KPI_EVIDENCE' | 'EXPLANATORY' | 'BINARY_GATE';
export type PerformanceEvidenceKind = 'OPERATIONAL_REFERENCE' | 'CONTROLLED_DOCUMENT' | 'STRUCTURED_OBSERVATION';
export type PerformanceEvidenceQuality = 'RELIABLE' | 'INCOMPLETE' | 'DISPUTED' | 'MISSING' | 'INVALIDATED';

export type PerformanceApplicabilityRule = {
  fact: string;
  operator: 'EQUALS' | 'IN' | 'EXISTS';
  values: unknown[];
};

export type PerformanceCriterionSnapshot = {
  criterionVersionId: string;
  titleFa: string;
  weightPercent: string;
  kind: PerformanceCriterionKind;
  anchorsFa: [string, string, string, string, string] | string[];
  applicability: PerformanceApplicabilityRule | null;
  evidence: {
    minimumReliableCount: number;
    allowedKinds: PerformanceEvidenceKind[];
    lookbackDays?: number;
    required: boolean;
  };
};

export type PerformanceTemplateSnapshot = {
  schemaVersion: 1;
  templateVersionId: string;
  scoringPolicyVersionId: string;
  jobSharePercent: string;
  addendumSharePercent: string;
  categories: Array<{
    id: string;
    titleFa: string;
    weightPercent: string;
    required: boolean;
    criteria: PerformanceCriterionSnapshot[];
  }>;
};

export type PerformanceCriterionResponse = {
  criterionVersionId: string;
  grade?: 1 | 2 | 3 | 4 | 5;
  binaryGatePassed?: boolean;
  notApplicable?: { requestedReason: string; approvedByHr: boolean };
  evidence: Array<{
    kind: PerformanceEvidenceKind;
    quality: PerformanceEvidenceQuality;
    occurredAt: string;
    referenceId: string;
    sourceVersion: string;
    contentHash: string;
  }>;
};

export type PerformanceEvaluationInput = {
  template: PerformanceTemplateSnapshot;
  sections: Array<{
    sectionId: string;
    effectiveDays: number;
    allocationPercent: string;
    effectiveFrom: string;
    effectiveTo: string;
    snapshotFacts: Record<string, unknown>;
    responses: PerformanceCriterionResponse[];
    template?: PerformanceTemplateSnapshot;
    notEvaluable?: boolean;
  }>;
};

type ApplicabilityDecision = 'APPLICABLE' | 'NOT_APPLICABLE' | 'BLOCKED';

type CriterionTrace = {
  criterionVersionId: string;
  titleFa: string;
  criterionKind: PerformanceCriterionKind;
  grade: number | null;
  mappedPoints: string | null;
  originalWeightPercent: string;
  sourceWeightPercent: string;
  effectiveWeightPercent: string;
  applicabilityDecision: ApplicabilityDecision;
  applicabilityReason: string;
  reliableEvidenceCount: number;
  evidenceRequirementMet: boolean;
  evidencePolicy: PerformanceCriterionSnapshot['evidence'];
  evidence: PerformanceCriterionResponse['evidence'];
  binaryGatePassed: boolean | null;
  contribution: string;
};

export type PerformanceCalculationTrace = {
  schemaVersion: 2;
  templateVersionId: string;
  scoringPolicyVersionId: string;
  gradeMapping: typeof PERFORMANCE_GRADE_POINTS;
  precisionScale: 6;
  coverage: {
    requiredPercent: '70.000000';
    actualPercent: string;
  };
  sections: Array<{
    sectionId: string;
    templateVersionId: string;
    scoringPolicyVersionId: string;
    exactScore: string | null;
    effectiveDays: number;
    allocationPercent: string;
    effectiveFrom: string;
    effectiveTo: string;
    combinationBasis: string;
    activeCategoryWeightPercent: string;
    categories: Array<{
      categoryId: string;
      titleFa: string;
      originalWeightPercent: string;
      effectiveWeightPercent: string;
      applicableCriterionWeightPercent: string;
      requiredCoveragePercent: string;
      actualCoveragePercent: string;
      exactScore: string | null;
      criteria: CriterionTrace[];
    }>;
  }>;
  exactScore: string | null;
  displayScore: string | null;
};

export type PerformanceEvaluationCalculation = {
  status: 'SCORED' | 'NOT_EVALUABLE' | 'BLOCKED';
  exactScore: string | null;
  displayScore: string | null;
  reasons: string[];
  trace: PerformanceCalculationTrace;
};

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ZERO = decimal(0);
const HUNDRED = decimal(100);
const fixed6 = (value: Prisma.Decimal.Value) => decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toFixed(6);
const fixed2 = (value: Prisma.Decimal.Value) => decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
const canonicalCombinedId = (values: string[]) => {
  const unique = [...new Set(values)].sort();
  return unique.length === 1 ? unique[0] : createHash('sha256').update(JSON.stringify(unique)).digest('hex');
};

const hasAtMostTwoDecimalPlaces = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value);
const hasAtMostSixDecimalPlaces = (value: string) => /^\d+(?:\.\d{1,6})?$/.test(value);

export const validatePerformanceTemplate = (template: PerformanceTemplateSnapshot): string[] => {
  const errors: string[] = [];
  if (template.categories.length === 0) errors.push('حداقل یک دسته معیار لازم است.');
  const categoryWeight = template.categories.reduce((sum, category) => sum.add(category.weightPercent), ZERO);
  if (!categoryWeight.eq(HUNDRED)) errors.push('جمع وزن دسته‌ها باید دقیقاً ۱۰۰ درصد باشد.');
  const seenCriteria = new Set<string>();
  for (const category of template.categories) {
    if (!category.id.trim() || !category.titleFa.trim()) errors.push('هویت و عنوان فارسی هر دسته الزامی است.');
    if (!hasAtMostSixDecimalPlaces(category.weightPercent) || decimal(category.weightPercent).lte(0)) {
      errors.push(`وزن دسته «${category.titleFa}» باید مثبت و حداکثر شش رقم اعشار داشته باشد.`);
    }
    const judgmentCriteria = category.criteria.filter((criterion) => criterion.kind === 'JUDGMENT');
    const criterionWeight = judgmentCriteria.reduce((sum, criterion) => sum.add(criterion.weightPercent), ZERO);
    if (!criterionWeight.eq(HUNDRED)) errors.push(`جمع وزن معیارهای دسته «${category.titleFa}» باید دقیقاً ۱۰۰ درصد باشد.`);
    for (const criterion of category.criteria) {
      if (seenCriteria.has(criterion.criterionVersionId)) errors.push(`نسخه معیار «${criterion.titleFa}» در تصویر ثابت تکرار شده است.`);
      seenCriteria.add(criterion.criterionVersionId);
      if (!hasAtMostTwoDecimalPlaces(criterion.weightPercent)
        || (criterion.kind === 'JUDGMENT' ? decimal(criterion.weightPercent).lte(0) : !decimal(criterion.weightPercent).eq(0))) {
        errors.push(`وزن معیار امتیازآور «${criterion.titleFa}» باید مثبت باشد و معیار غیرامتیازی باید وزن صفر داشته باشد.`);
      }
      if (criterion.kind === 'JUDGMENT' && (criterion.anchorsFa.length !== 5 || criterion.anchorsFa.some((anchor) => !anchor.trim()))) {
        errors.push(`برای معیار «${criterion.titleFa}» توضیح رفتاری فارسی هر پنج درجه الزامی است.`);
      }
      if (!Number.isInteger(criterion.evidence.minimumReliableCount) || criterion.evidence.minimumReliableCount < 0) {
        errors.push(`حداقل شاهد معیار «${criterion.titleFa}» معتبر نیست.`);
      }
    }
  }
  const jobShare = decimal(template.jobSharePercent);
  const addendumShare = decimal(template.addendumSharePercent);
  if (!jobShare.add(addendumShare).eq(HUNDRED) || jobShare.lt(70) || addendumShare.gt(30)) {
    errors.push('سهم الگوی شغل و افزوده جایگاه باید ۱۰۰ درصد باشد؛ سهم شغل حداقل ۷۰ و سهم افزوده حداکثر ۳۰ درصد است.');
  }
  return errors;
};

const evaluateApplicability = (
  criterion: PerformanceCriterionSnapshot,
  facts: Record<string, unknown>,
  response: PerformanceCriterionResponse | undefined,
): { decision: ApplicabilityDecision; reason: string } => {
  if (response?.notApplicable) {
    if (response.notApplicable.approvedByHr && response.notApplicable.requestedReason.trim()) {
      return { decision: 'NOT_APPLICABLE', reason: 'درخواست نامرتبط‌بودن با دلیل به تأیید منابع انسانی رسیده است.' };
    }
    return { decision: 'BLOCKED', reason: 'درخواست نامرتبط‌بودن هنوز تأیید معتبر منابع انسانی ندارد.' };
  }
  if (!criterion.applicability) return { decision: 'APPLICABLE', reason: 'معیار برای همه مأموریت‌ها کاربرد دارد.' };
  const rule = criterion.applicability;
  if (!Object.prototype.hasOwnProperty.call(facts, rule.fact)) {
    return { decision: 'BLOCKED', reason: `واقعیت کنترل‌شده «${rule.fact}» در تصویر ثابت موجود نیست.` };
  }
  const fact = facts[rule.fact];
  const matches = rule.operator === 'EXISTS'
    ? fact !== null && fact !== undefined && fact !== ''
    : rule.operator === 'EQUALS'
      ? rule.values.some((value) => Object.is(value, fact))
      : rule.values.some((value) => Object.is(value, fact));
  return matches
    ? { decision: 'APPLICABLE', reason: 'واقعیت کنترل‌شده تصویر ثابت با قاعده کاربردپذیری منطبق است.' }
    : { decision: 'NOT_APPLICABLE', reason: 'واقعیت کنترل‌شده تصویر ثابت با قاعده کاربردپذیری منطبق نیست.' };
};

const evidenceWithinWindow = (
  occurredAt: string,
  section: { effectiveFrom?: string; effectiveTo?: string },
  lookbackDays = 0,
) => {
  if (!section.effectiveFrom || !section.effectiveTo) return true;
  const eventTime = new Date(occurredAt).getTime();
  const from = new Date(section.effectiveFrom).getTime() - lookbackDays * 86_400_000;
  const to = new Date(section.effectiveTo).getTime();
  return Number.isFinite(eventTime) && eventTime >= from && eventTime <= to;
};

const hasVerifiableEvidenceIdentity = (evidence: PerformanceCriterionResponse['evidence'][number]) => (
  evidence.referenceId.trim().length > 0
  && evidence.sourceVersion.trim().length > 0
  && /^[a-f0-9]{64}$/i.test(evidence.contentHash)
);

export const calculatePerformanceEvaluation = (input: PerformanceEvaluationInput): PerformanceEvaluationCalculation => {
  const sectionTemplates = input.sections.map((section) => section.template ?? input.template);
  const validationErrors = [...new Set(sectionTemplates.flatMap(validatePerformanceTemplate))];
  const reasons = [...validationErrors];
  let structuralBlocker = validationErrors.length > 0;

  const sectionWork = input.sections.map((section) => {
    const sectionTemplate = section.template ?? input.template;
    const effectiveFromMs = new Date(section.effectiveFrom).getTime();
    const effectiveToMs = new Date(section.effectiveTo).getTime();
    if (!Number.isFinite(effectiveFromMs) || !Number.isFinite(effectiveToMs) || effectiveFromMs >= effectiveToMs) {
      structuralBlocker = true;
      reasons.push(`بازه زمانی بخش «${section.sectionId}» باید کامل و معتبر باشد.`);
    }
    if (!Number.isInteger(section.effectiveDays) || section.effectiveDays <= 0) {
      structuralBlocker = true;
      reasons.push(`روزهای مؤثر بخش «${section.sectionId}» معتبر نیست.`);
    }
    const allocation = decimal(section.allocationPercent);
    if (allocation.lte(0) || allocation.gt(100) || !hasAtMostTwoDecimalPlaces(section.allocationPercent)) {
      structuralBlocker = true;
      reasons.push(`درصد تخصیص کاری بخش «${section.sectionId}» معتبر نیست.`);
    }
    const responses = new Map(section.responses.map((response) => [response.criterionVersionId, response]));
    let sectionOriginalWeight = ZERO;
    let sectionCoveredWeight = ZERO;
    const categoryWork = sectionTemplate.categories.map((category) => {
      const categoryOriginal = decimal(category.weightPercent);
      let coveredWithinCategory = ZERO;
      const criterionWork = category.criteria.map((criterion) => {
        const response = responses.get(criterion.criterionVersionId);
        const originalWithinCategory = decimal(criterion.weightPercent);
        const originalGlobal = categoryOriginal.mul(originalWithinCategory).div(HUNDRED);
        const applicability = evaluateApplicability(criterion, section.snapshotFacts, response);
        if (applicability.decision === 'BLOCKED') {
          if (!section.notEvaluable) structuralBlocker = true;
          reasons.push(`${criterion.titleFa}: ${applicability.reason}`);
        }
        const reliableEvidence = (response?.evidence ?? []).filter((evidence) => (
          evidence.quality === 'RELIABLE'
          && criterion.evidence.allowedKinds.includes(evidence.kind)
          && evidenceWithinWindow(evidence.occurredAt, section, criterion.evidence.lookbackDays)
          && hasVerifiableEvidenceIdentity(evidence)
        ));
        const evidenceRequirementMet = !criterion.evidence.required
          || reliableEvidence.length >= criterion.evidence.minimumReliableCount;
        const grade = response?.grade ?? null;
        if (!section.notEvaluable && applicability.decision === 'APPLICABLE' && criterion.kind === 'JUDGMENT' && grade === null) {
          structuralBlocker = true;
          reasons.push(`برای معیار «${criterion.titleFa}» باید یکی از پنج درجه ثبت شود.`);
        }
        if (!section.notEvaluable && applicability.decision === 'APPLICABLE' && !evidenceRequirementMet) {
          reasons.push(`معیار «${criterion.titleFa}» حداقل شاهد قابل اتکا را ندارد.`);
        }
        if (!section.notEvaluable && applicability.decision === 'APPLICABLE' && criterion.kind === 'BINARY_GATE' && response?.binaryGatePassed !== true) {
          structuralBlocker = true;
          reasons.push(`کنترل الزامی «${criterion.titleFa}» تأیید نشده است.`);
        }
        if (applicability.decision === 'APPLICABLE' && criterion.kind === 'JUDGMENT' && grade !== null && evidenceRequirementMet) {
          coveredWithinCategory = coveredWithinCategory.add(originalWithinCategory);
          sectionCoveredWeight = sectionCoveredWeight.add(originalGlobal);
        }
        if (applicability.decision === 'APPLICABLE' && criterion.kind === 'JUDGMENT') {
          sectionOriginalWeight = sectionOriginalWeight.add(originalGlobal);
        }
        return {
          criterion,
          response,
          grade,
          originalWithinCategory,
          originalGlobal,
          applicability,
          reliableEvidenceCount: reliableEvidence.length,
          evidenceRequirementMet,
          reliableEvidence,
        };
      });
      const applicable = criterionWork.filter(({ applicability, criterion }) => (
        applicability.decision === 'APPLICABLE' && criterion.kind === 'JUDGMENT'
      ));
      const applicableWeight = applicable.reduce((sum, item) => sum.add(item.originalWithinCategory), ZERO);
      const coverage = applicableWeight.gt(0) ? coveredWithinCategory.div(applicableWeight).mul(HUNDRED) : HUNDRED;
      if (!section.notEvaluable && category.required && applicableWeight.gt(0) && coverage.lt(50)) {
        reasons.push(`پوشش دسته الزامی «${category.titleFa}» کمتر از ۵۰ درصد است.`);
      }
      const scoreNumerator = applicable.reduce((sum, item) => {
        if (item.grade === null || !item.evidenceRequirementMet) return sum;
        return sum.add(decimal(PERFORMANCE_GRADE_POINTS[item.grade - 1]).mul(item.originalWithinCategory));
      }, ZERO);
      const score = applicableWeight.gt(0) ? scoreNumerator.div(applicableWeight) : null;
      return { category, categoryOriginal, criterionWork, applicableWeight, coverage, score };
    });
    const activeCategoryWeight = categoryWork
      .filter(({ applicableWeight }) => applicableWeight.gt(0))
      .reduce((sum, item) => sum.add(item.categoryOriginal), ZERO);
    const sectionScore = !section.notEvaluable && activeCategoryWeight.gt(0)
      ? categoryWork.reduce((sum, item) => item.score === null
        ? sum
        : sum.add(item.score.mul(item.categoryOriginal)), ZERO).div(activeCategoryWeight)
      : null;
    const combinationBasis = decimal(Math.max(section.effectiveDays, 0)).mul(allocation);
    return {
      section, sectionTemplate, allocation, categoryWork, activeCategoryWeight, sectionScore, combinationBasis,
      sectionOriginalWeight, sectionCoveredWeight,
      effectiveFromMs, effectiveToMs,
    };
  });

  const allocationEvents = sectionWork.flatMap(({ allocation, effectiveFromMs, effectiveToMs }) => (
    Number.isFinite(effectiveFromMs) && Number.isFinite(effectiveToMs)
      ? [
        { at: effectiveFromMs, delta: allocation },
        { at: effectiveToMs, delta: allocation.negated() },
      ]
      : []
  )).sort((left, right) => left.at - right.at || left.delta.comparedTo(right.delta));
  let concurrentAllocation = ZERO;
  for (const event of allocationEvents) {
    concurrentAllocation = concurrentAllocation.add(event.delta);
    if (concurrentAllocation.gt(HUNDRED)) {
      structuralBlocker = true;
      reasons.push('جمع تخصیص بخش‌های مأموریت در یک بازه هم‌پوشان بیشتر از ۱۰۰ درصد است.');
      break;
    }
  }

  const weightedOriginal = sectionWork.reduce((sum, item) => sum.add(item.sectionOriginalWeight.mul(item.combinationBasis)), ZERO);
  const weightedCovered = sectionWork.reduce((sum, item) => sum.add(item.sectionCoveredWeight.mul(item.combinationBasis)), ZERO);
  const coverage = weightedOriginal.gt(0) ? weightedCovered.div(weightedOriginal).mul(HUNDRED) : ZERO;
  if (coverage.lt(70)) reasons.push('پوشش وزن اصلی ارزیابی کمتر از ۷۰ درصد است.');
  const notEvaluable = !structuralBlocker && reasons.length > 0;
  const scoredSectionWork = sectionWork.filter((item) => item.sectionScore !== null);
  const totalBasis = scoredSectionWork.reduce((sum, item) => sum.add(item.combinationBasis), ZERO);
  const exactScore = structuralBlocker || notEvaluable || totalBasis.eq(0)
    ? null
    : scoredSectionWork.reduce((sum, item) => (
      sum.add(item.sectionScore!.mul(item.combinationBasis))
    ), ZERO).div(totalBasis);

  const traceSections = sectionWork.map((sectionItem) => ({
    sectionId: sectionItem.section.sectionId,
    templateVersionId: sectionItem.sectionTemplate.templateVersionId,
    scoringPolicyVersionId: sectionItem.sectionTemplate.scoringPolicyVersionId,
    exactScore: sectionItem.sectionScore === null ? null : fixed6(sectionItem.sectionScore),
    effectiveDays: sectionItem.section.effectiveDays,
    allocationPercent: fixed6(sectionItem.allocation),
    effectiveFrom: sectionItem.section.effectiveFrom,
    effectiveTo: sectionItem.section.effectiveTo,
    combinationBasis: fixed6(sectionItem.combinationBasis),
    activeCategoryWeightPercent: fixed6(sectionItem.activeCategoryWeight),
    categories: sectionItem.categoryWork.map((categoryItem) => {
      const effectiveCategoryWeight = sectionItem.activeCategoryWeight.gt(0) && categoryItem.applicableWeight.gt(0)
        ? categoryItem.categoryOriginal.div(sectionItem.activeCategoryWeight).mul(HUNDRED)
        : ZERO;
      return {
        categoryId: categoryItem.category.id,
        titleFa: categoryItem.category.titleFa,
        originalWeightPercent: fixed6(categoryItem.categoryOriginal),
        effectiveWeightPercent: fixed6(effectiveCategoryWeight),
        applicableCriterionWeightPercent: fixed6(categoryItem.applicableWeight),
        requiredCoveragePercent: categoryItem.category.required ? '50.000000' : '0.000000',
        actualCoveragePercent: fixed6(categoryItem.coverage),
        exactScore: categoryItem.score === null ? null : fixed6(categoryItem.score),
        criteria: categoryItem.criterionWork.map((item): CriterionTrace => {
          const effectiveCriterionWithinCategory = item.applicability.decision === 'APPLICABLE' && categoryItem.applicableWeight.gt(0)
            ? item.originalWithinCategory.div(categoryItem.applicableWeight).mul(HUNDRED)
            : ZERO;
          const effectiveGlobal = effectiveCategoryWeight.mul(effectiveCriterionWithinCategory).div(HUNDRED);
          const points = item.grade === null ? null : decimal(PERFORMANCE_GRADE_POINTS[item.grade - 1]);
          return {
            criterionVersionId: item.criterion.criterionVersionId,
            titleFa: item.criterion.titleFa,
            criterionKind: item.criterion.kind,
            grade: item.grade,
            mappedPoints: points === null ? null : fixed6(points),
            originalWeightPercent: fixed6(item.originalGlobal),
            sourceWeightPercent: fixed6(item.originalWithinCategory),
            effectiveWeightPercent: fixed6(effectiveGlobal),
            applicabilityDecision: item.applicability.decision,
            applicabilityReason: item.applicability.reason,
            reliableEvidenceCount: item.reliableEvidenceCount,
            evidenceRequirementMet: item.evidenceRequirementMet,
            evidencePolicy: item.criterion.evidence,
            evidence: item.response?.evidence ?? [],
            binaryGatePassed: item.response?.binaryGatePassed ?? null,
            contribution: points === null ? '0.000000' : fixed6(points.mul(effectiveGlobal).div(HUNDRED)),
          };
        }),
      };
    }),
  }));

  const status: PerformanceEvaluationCalculation['status'] = structuralBlocker
    ? 'BLOCKED'
    : notEvaluable || exactScore === null
      ? 'NOT_EVALUABLE'
      : 'SCORED';
  return {
    status,
    exactScore: exactScore === null ? null : fixed6(exactScore),
    displayScore: exactScore === null ? null : fixed2(exactScore),
    reasons: [...new Set(reasons)],
    trace: {
      schemaVersion: 2,
      templateVersionId: canonicalCombinedId(sectionTemplates.map(({ templateVersionId }) => templateVersionId)),
      scoringPolicyVersionId: canonicalCombinedId(sectionTemplates.map(({ scoringPolicyVersionId }) => scoringPolicyVersionId)),
      gradeMapping: PERFORMANCE_GRADE_POINTS,
      precisionScale: 6,
      coverage: { requiredPercent: '70.000000', actualPercent: fixed6(coverage) },
      sections: traceSections,
      exactScore: exactScore === null ? null : fixed6(exactScore),
      displayScore: exactScore === null ? null : fixed2(exactScore),
    },
  };
};

export type PerformanceLevelPolicySnapshot = {
  versionId: string;
  thresholds: Array<{
    code: string;
    titleFa: string;
    meaningFa?: string;
    minimum: string;
    maximumExclusive?: string;
    maximumInclusive?: string;
  }>;
};

export type CurrentPerformanceResultInput = {
  resultId: string;
  exactScore: string;
  measurementTo: string;
  expiresAt: string;
  status: 'EFFECTIVE' | 'SUSPENDED' | 'SUPERSEDED' | 'EXPIRED';
};

export type CurrentPerformanceLevel = {
  state: 'UNEVALUATED' | 'NEEDS_NEW_EVALUATION' | 'LEVEL';
  exactScore: string | null;
  levelCode: string | null;
  levelTitleFa: string | null;
  policyVersionId: string;
  newestMeasurementTo: string | null;
  nextReviewAt: string | null;
  sourceResultsHashInput: string;
  trace: {
    policyVersionId: string;
    aggregationPolicyVersionId: string;
    exactScore: string | null;
    inputs: Array<CurrentPerformanceResultInput & {
      recencyWeightPercent: string;
      normalizedWeightPercent: string;
      contribution: string;
    }>;
  };
};

export const classifyExactPerformanceScore = (
  policy: PerformanceLevelPolicySnapshot,
  exactScore: string,
) => {
  const score = decimal(exactScore);
  const threshold = policy.thresholds.find((candidate) => (
    score.gte(candidate.minimum)
    && (candidate.maximumExclusive !== undefined
      ? score.lt(candidate.maximumExclusive)
      : score.lte(candidate.maximumInclusive ?? candidate.minimum))
  )) ?? null;
  if (!threshold) {
    throw Object.assign(new Error('Performance level policy does not classify the exact score.'), {
      code: 'PERFORMANCE_LEVEL_POLICY_GAP',
    });
  }
  return { exactScore: fixed6(score), levelCode: threshold.code, levelTitleFa: threshold.titleFa };
};

export const calculateCurrentPerformanceLevel = (input: {
  asOf: Date;
  policy: PerformanceLevelPolicySnapshot;
  results: CurrentPerformanceResultInput[];
  nextPolicyEffectiveAt?: Date | null;
  aggregationPolicy?: {
    versionId: string;
    recencyWeightsPercent: string[];
    maximumResults: number;
  };
}): CurrentPerformanceLevel => {
  const recencyWeights = input.aggregationPolicy?.recencyWeightsPercent ?? ['50', '30', '15', '5'];
  const maximumResults = input.aggregationPolicy?.maximumResults ?? 4;
  if (maximumResults < 1 || maximumResults > recencyWeights.length) {
    throw Object.assign(new Error('Current performance level policy has invalid recency weights.'), {
      code: 'PERFORMANCE_CURRENT_LEVEL_POLICY_INVALID',
    });
  }
  const valid = input.results
    .filter((result) => result.status === 'EFFECTIVE' && new Date(result.expiresAt).getTime() > input.asOf.getTime())
    .sort((left, right) => (
      new Date(right.measurementTo).getTime() - new Date(left.measurementTo).getTime()
      || right.resultId.localeCompare(left.resultId)
    ))
    .slice(0, maximumResults);
  const totalWeight = valid.reduce((sum, _result, index) => sum.add(recencyWeights[index]), ZERO);
  const weightedScore = totalWeight.eq(0) ? null : valid.reduce((sum, result, index) => (
    sum.add(decimal(result.exactScore).mul(recencyWeights[index]))
  ), ZERO).div(totalWeight);
  const classification = weightedScore === null
    ? null
    : classifyExactPerformanceScore(input.policy, weightedScore.toString());
  const reviewCandidates = [
    ...valid.map((result) => new Date(result.expiresAt)),
    ...(input.nextPolicyEffectiveAt ? [input.nextPolicyEffectiveAt] : []),
  ].filter((date) => date.getTime() > input.asOf.getTime());
  const nextReviewAt = reviewCandidates.sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  const state = weightedScore !== null ? 'LEVEL' : input.results.some((result) => (
    result.status === 'EXPIRED' || new Date(result.expiresAt).getTime() <= input.asOf.getTime()
  )) ? 'NEEDS_NEW_EVALUATION' : 'UNEVALUATED';
  const traceInputs = valid.map((result, index) => {
    const normalizedWeight = decimal(recencyWeights[index]).div(totalWeight).mul(HUNDRED);
    return {
      ...result,
      recencyWeightPercent: fixed6(recencyWeights[index]),
      normalizedWeightPercent: fixed6(normalizedWeight),
      contribution: fixed6(decimal(result.exactScore).mul(normalizedWeight).div(HUNDRED)),
    };
  });
  return {
    state,
    exactScore: weightedScore === null ? null : fixed6(weightedScore),
    levelCode: classification?.levelCode ?? null,
    levelTitleFa: classification?.levelTitleFa ?? null,
    policyVersionId: input.policy.versionId,
    newestMeasurementTo: valid[0]?.measurementTo ?? null,
    nextReviewAt: nextReviewAt?.toISOString() ?? null,
    sourceResultsHashInput: valid.map((result) => `${result.resultId}:${result.exactScore}:${result.expiresAt}`).join('|'),
    trace: {
      policyVersionId: input.policy.versionId,
      aggregationPolicyVersionId: input.aggregationPolicy?.versionId ?? 'CURRENT_LEVEL_DEFAULT_V1',
      exactScore: weightedScore === null ? null : fixed6(weightedScore),
      inputs: traceInputs,
    },
  };
};

const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1_000;

export const performanceResultExpiry = (measurementTo: Date): Date => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(measurementTo);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((candidate) => candidate.type === type)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day') + 366) - TEHRAN_OFFSET_MS - 1);
};

export const reproducePerformanceCalculation = (trace: PerformanceCalculationTrace) => {
  const rebuiltSections = trace.sections.map((section) => {
    const rebuiltCriteria = section.categories.flatMap((category) => category.criteria.map((criterion) => {
      const mappedPoints = criterion.grade === null ? null : trace.gradeMapping[criterion.grade - 1];
      const effectiveWeight = decimal(section.activeCategoryWeightPercent).gt(0)
        && decimal(category.applicableCriterionWeightPercent).gt(0)
        && criterion.applicabilityDecision === 'APPLICABLE'
        ? decimal(category.originalWeightPercent)
          .div(section.activeCategoryWeightPercent)
          .mul(criterion.sourceWeightPercent)
          .div(category.applicableCriterionWeightPercent)
          .mul(HUNDRED)
        : ZERO;
      const exactContribution = mappedPoints === null
        ? ZERO
        : decimal(mappedPoints).mul(effectiveWeight).div(HUNDRED);
      const contribution = fixed6(exactContribution);
      const reliableEvidenceCount = criterion.evidence.filter((evidence) => (
        evidence.quality === 'RELIABLE'
        && criterion.evidencePolicy.allowedKinds.includes(evidence.kind)
        && evidenceWithinWindow(evidence.occurredAt, section, criterion.evidencePolicy.lookbackDays)
        && hasVerifiableEvidenceIdentity(evidence)
      )).length;
      const evidenceRequirementMet = !criterion.evidencePolicy.required
        || reliableEvidenceCount >= criterion.evidencePolicy.minimumReliableCount;
      const binaryGateMatches = criterion.criterionKind !== 'BINARY_GATE'
        || criterion.applicabilityDecision !== 'APPLICABLE'
        || criterion.binaryGatePassed === true;
      return {
        criterionVersionId: criterion.criterionVersionId,
        exactContribution,
        contribution,
        matchesStoredContribution: contribution === criterion.contribution
          && (mappedPoints === null || fixed6(mappedPoints) === criterion.mappedPoints)
          && reliableEvidenceCount === criterion.reliableEvidenceCount
          && evidenceRequirementMet === criterion.evidenceRequirementMet
          && binaryGateMatches,
      };
    }));
    const exactScore = section.categories.some((category) => category.exactScore !== null)
      ? fixed6(rebuiltCriteria.reduce((sum, criterion) => sum.add(criterion.exactContribution), ZERO))
      : null;
    return {
      ...section,
      rebuiltExactScore: exactScore,
      matchesStoredSection: exactScore === section.exactScore && rebuiltCriteria.every(({ matchesStoredContribution }) => matchesStoredContribution),
    };
  });
  const scoredSections = rebuiltSections.filter((section) => section.rebuiltExactScore !== null);
  const totalBasis = scoredSections.reduce((sum, section) => sum.add(section.combinationBasis), ZERO);
  const exactScore = totalBasis.eq(0) ? null : scoredSections.reduce((sum, section) => (
    sum.add(decimal(section.rebuiltExactScore!).mul(section.combinationBasis))
  ), ZERO).div(totalBasis);
  const reproduced = exactScore === null ? null : fixed6(exactScore);
  return {
    exactScore: reproduced,
    matchesStoredResult: reproduced === trace.exactScore && rebuiltSections.every(({ matchesStoredSection }) => matchesStoredSection),
    sections: rebuiltSections.map(({ sectionId, rebuiltExactScore, matchesStoredSection }) => ({ sectionId, exactScore: rebuiltExactScore, matchesStoredSection })),
  };
};
