import { Prisma } from '@prisma/client';
import roleCatalogContract from '../contracts/personnelPerformanceRoleCatalog.json';
import {
  canonicalPerformanceHash,
  validateCriterionPolicyContent,
  validatePerformanceTemplateContent,
  type PerformanceCriterionPolicyContent,
  type PerformanceTemplatePolicyContent,
} from './personnelPerformancePolicy';
import {
  PERFORMANCE_APPLICABILITY_FACT_TYPES,
  PERFORMANCE_APPLICABILITY_FACT_OPERATORS,
  validateTypedPerformanceApplicabilityRule,
  type PerformanceApplicabilityFact,
  type PerformanceApplicabilityFactType,
  type TypedPerformanceApplicabilityRule,
} from './personnelPerformanceCalculation';

type CatalogRecord = Record<string, unknown>;
type RoleReference = { code: string; id: string | null; synthetic: boolean };
type CatalogCategory = { code: string; titleFa: string; weight: number };
type CatalogCriterion = {
  conceptCode: string;
  versionCode: string;
  titleFa: string;
  meaningFa: string;
  kind: 'JUDGMENT';
  categoryCode: string;
  weight: number;
  applicability: {
    schemaVersion: 1;
    fact: string;
    factType: PerformanceApplicabilityFactType;
    operator: 'EQUALS' | 'IN' | 'EXISTS';
    values: unknown[];
  } | null;
  anchorsFa: string[];
  evidencePolicy: {
    dictionaryCodes: string[];
    minimumReliableCount: number;
    windowDays: number;
    automaticGrade: false;
  };
  outsideControlFactors: string[];
};
type CatalogRole = {
  reference: RoleReference;
  titleFa: string;
  categories: CatalogCategory[];
  criteria: CatalogCriterion[];
};
type CatalogPosition = CatalogRole & {
  jobReferenceCode: string;
  composition: { jobWeight: number; addendumWeight: number };
};
type ApplicabilityDictionaryEntry = {
  fact: PerformanceApplicabilityFact;
  type: PerformanceApplicabilityFactType;
  operators: Array<'EQUALS' | 'IN' | 'EXISTS'>;
  unknown: 'BLOCK';
  source: string;
  sourceVersion: string;
};
type EvidenceDictionaryEntry = {
  code: string;
  classification: 'CANONICAL_EVIDENCE' | 'CONTROLLED_DOCUMENT' | 'STRUCTURED_OBSERVATION' | 'MISSING_OR_FUTURE_INTEGRATION';
  sourceProcess: string;
  recordVersion: string;
  lineage: string;
  attribution: string;
  ownerRole: string;
};
type CatalogProvenanceCategory = typeof roleCatalogContract.provenanceCategories[number];

export type PerformanceRoleCatalogManifest = {
  schemaVersion: 1;
  catalog: {
    stableKey: string;
    versionCode: string;
    lifecycle: 'DRAFT';
    importIdentity: string;
    contentHash: string;
    contentHashMethod: 'SHA256_CANONICAL_JSON_EXCLUDING_CATALOG_CONTENT_HASH';
  };
  source: {
    provenanceCategory: CatalogProvenanceCategory;
    asOf: string;
    references: string[];
    extractedFacts: boolean;
  };
  review: {
    contentOrigin: string;
    status: 'BUSINESS_REVIEW_PENDING' | 'REJECTED' | 'APPROVED';
    reviewerRole?: string;
    reviewedAt?: string | null;
  };
  applicabilitySnapshotContract: {
    schemaVersion: 1;
    container: '__applicability';
    snapshotVersion: string;
    sourceVersions: 'REQUIRED_MAP_OF_FACT_TO_STABLE_SOURCE_VERSION';
    effectiveAt: 'REQUIRED_ISO_TIMESTAMP';
    unknown: 'BLOCK';
  };
  applicabilityDictionary: ApplicabilityDictionaryEntry[];
  evidenceDictionary: EvidenceDictionaryEntry[];
  jobs: CatalogRole[];
  positions: CatalogPosition[];
};

export type PlannedPerformanceCatalogCriterion = {
  sourceOwnerCode: string;
  sourceVersionCode: string;
  content: PerformanceCriterionPolicyContent & {
    catalogSource: {
      importIdentity: string;
      catalogVersion: string;
      sourceAsOf: string;
      sourceProvenanceCategory: string;
      manifestContentOrigin: string;
      manifestReviewerRole?: string;
      manifestReviewedAt?: string | null;
      manifestContentHash: string;
      manifestReviewStatus: PerformanceRoleCatalogManifest['review']['status'];
      reviewStatus: 'BUSINESS_REVIEW_PENDING';
      sourceVersionCode: string;
    };
  };
};

export type PlannedPerformanceCatalogTemplate = {
  sourceOwnerCode: string;
  templateKind: 'JOB_TEMPLATE' | 'POSITION_ADDENDUM';
  ownerType: 'JOB' | 'POSITION';
  ownerId: string | null;
  titleFa: string;
  categories: Array<{
    id: string;
    titleFa: string;
    weightPercent: string;
    required: true;
    criteria: Array<{ conceptCode: string; weightPercent: string }>;
  }>;
};

export type PerformanceCatalogCompositionPreview = {
  jobReferenceCode: string;
  jobId: string | null;
  positionReferenceCode: string;
  positionId: string | null;
  jobSharePercent: string;
  addendumSharePercent: string;
  basis: 'JOB_WITH_POSITION_ADDENDUM' | 'JOB_ONLY';
};

export type PerformanceRoleCatalogPlan = {
  manifest: PerformanceRoleCatalogManifest;
  importIdentity: string;
  contentHash: string;
  importable: boolean;
  warnings: string[];
  criteria: PlannedPerformanceCatalogCriterion[];
  templates: PlannedPerformanceCatalogTemplate[];
  compositions: PerformanceCatalogCompositionPreview[];
};

export type PerformanceRoleCatalogInspection = {
  errors: string[];
  plan: PerformanceRoleCatalogPlan | null;
};

const isRecord = (value: unknown): value is CatalogRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const codePattern = /^[A-Z0-9][A-Z0-9_-]{2,95}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const percent = (value: number) => value.toFixed(2);
const hasAtMostTwoDecimals = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  && new Prisma.Decimal(String(value)).decimalPlaces() <= 2;
const decimalSumIsHundred = (values: number[]) => values
  .reduce((sum, value) => sum.add(String(value)), new Prisma.Decimal(0)).eq(100);
const sameMembers = (left: unknown, right: readonly string[]) => Array.isArray(left) && left.length === right.length
  && left.every((value) => typeof value === 'string' && right.includes(value));

const hasCatalogManifestShape = (input: CatalogRecord) => {
  if (!isRecord(input.catalog) || !isRecord(input.source) || !isRecord(input.review) || !isRecord(input.applicabilitySnapshotContract)
    || !Array.isArray(input.applicabilityDictionary) || !Array.isArray(input.evidenceDictionary)
    || !Array.isArray(input.jobs) || !Array.isArray(input.positions)) return false;
  const validCriterion = (value: unknown) => isRecord(value)
    && (value.applicability === null || isRecord(value.applicability))
    && (value.applicability === null || Array.isArray(value.applicability.values))
    && Array.isArray(value.anchorsFa) && value.anchorsFa.every((anchor) => typeof anchor === 'string')
    && isRecord(value.evidencePolicy)
    && typeof value.weight === 'number'
    && typeof value.evidencePolicy.minimumReliableCount === 'number'
    && typeof value.evidencePolicy.windowDays === 'number'
    && typeof value.evidencePolicy.automaticGrade === 'boolean'
    && Array.isArray(value.evidencePolicy.dictionaryCodes)
    && Array.isArray(value.outsideControlFactors);
  const validRole = (value: unknown) => isRecord(value)
    && isRecord(value.reference)
    && Array.isArray(value.categories)
    && value.categories.every((category) => isRecord(category) && typeof category.weight === 'number')
    && Array.isArray(value.criteria)
    && value.criteria.every(validCriterion);
  return input.applicabilityDictionary.every(isRecord)
    && input.applicabilityDictionary.every((entry) => Array.isArray(entry.operators))
    && input.evidenceDictionary.every(isRecord)
    && input.jobs.every(validRole)
    && input.positions.every((position) => validRole(position) && isRecord(position.composition)
      && typeof position.composition.jobWeight === 'number' && typeof position.composition.addendumWeight === 'number');
};

export const performanceRoleCatalogContentHash = (input: unknown) => {
  if (!isRecord(input) || !isRecord(input.catalog)) return '';
  const canonical = structuredClone(input);
  delete (canonical.catalog as CatalogRecord).contentHash;
  return canonicalPerformanceHash(canonical);
};

const evidenceKind = (classification: EvidenceDictionaryEntry['classification']) => ({
  CANONICAL_EVIDENCE: 'OPERATIONAL_REFERENCE',
  CONTROLLED_DOCUMENT: 'CONTROLLED_DOCUMENT',
  STRUCTURED_OBSERVATION: 'STRUCTURED_OBSERVATION',
} as const)[classification as Exclude<EvidenceDictionaryEntry['classification'], 'MISSING_OR_FUTURE_INTEGRATION'>];

const resolveApplicability = (
  criterion: CatalogCriterion,
  dictionary: Map<string, ApplicabilityDictionaryEntry>,
  ownerIds: { jobs: Map<string, string | null>; positions: Map<string, string | null> },
  errors: string[],
): TypedPerformanceApplicabilityRule | null => {
  if (!criterion.applicability) return null;
  const definition = dictionary.get(criterion.applicability.fact);
  if (!definition) {
    errors.push(`معیار ${criterion.conceptCode} از واقعیت کاربردپذیری تعریف‌نشده استفاده می‌کند.`);
    return null;
  }
  const controlledDefinition = Object.prototype.hasOwnProperty.call(PERFORMANCE_APPLICABILITY_FACT_OPERATORS, definition.fact)
    ? PERFORMANCE_APPLICABILITY_FACT_OPERATORS[definition.fact]
    : undefined;
  if (definition.unknown !== 'BLOCK' || typeof definition.source !== 'string' || !definition.source.trim()
    || typeof definition.sourceVersion !== 'string' || !definition.sourceVersion.trim()) {
    errors.push(`واقعیت ${definition.fact} باید منبع نسخه‌دار و رفتار BLOCK برای مقدار نامعلوم داشته باشد.`);
  }
  if (PERFORMANCE_APPLICABILITY_FACT_TYPES[definition.fact] !== definition.type) {
    errors.push(`نوع واقعیت ${definition.fact} با قرارداد کاربردپذیری سامانه سازگار نیست.`);
  }
  if (!controlledDefinition || !sameMembers(definition.operators, controlledDefinition.operators)) {
    errors.push(`عملگرهای فرهنگ واقعیت ${definition.fact} با قرارداد کنترل‌شده سامانه منطبق نیست.`);
  }
  if (criterion.applicability.schemaVersion !== 1 || criterion.applicability.factType !== definition.type) {
    errors.push(`نسخه یا نوع قاعده معیار ${criterion.conceptCode} با فرهنگ کاربردپذیری منطبق نیست.`);
  }
  if (!definition.operators.includes(criterion.applicability.operator)) {
    errors.push(`عملگر معیار ${criterion.conceptCode} در فرهنگ واقعیت ${definition.fact} مجاز نیست.`);
  }
  const referenceMap = definition.fact === 'jobId' ? ownerIds.jobs
    : definition.fact === 'positionId' ? ownerIds.positions : null;
  const values = criterion.applicability.values.map((value) => {
    if (!referenceMap) return value;
    const resolved = typeof value === 'string' ? referenceMap.get(value) : undefined;
    if (typeof value !== 'string' || !referenceMap.has(value)) {
      errors.push(`مرجع ${definition.fact} در معیار ${criterion.conceptCode} حل نشده یا از نوع نادرست است.`);
      return value;
    }
    return resolved ?? value;
  });
  const rule: TypedPerformanceApplicabilityRule = {
    schemaVersion: 1,
    fact: definition.fact,
    factType: definition.type,
    source: definition.source,
    sourceVersion: definition.sourceVersion,
    operator: criterion.applicability.operator,
    values,
  };
  errors.push(...validateTypedPerformanceApplicabilityRule(rule).map((error) => `${criterion.conceptCode}: ${error}`));
  return rule;
};

export const inspectPerformanceRoleCatalogManifest = (input: unknown): PerformanceRoleCatalogInspection => {
  const errors: string[] = [];
  if (!isRecord(input)) return { errors: ['ساختار کاتالوگ باید یک شیء باشد.'], plan: null };
  if (!hasCatalogManifestShape(input)) {
    return { errors: ['ساختار کاتالوگ ناقص است؛ فرهنگ‌ها، شغل‌ها، جایگاه‌ها، دسته‌ها و معیارها باید آرایه‌های نوع‌دار باشند.'], plan: null };
  }
  const manifest = input as unknown as PerformanceRoleCatalogManifest;
  if (manifest.schemaVersion !== 1) errors.push('نسخه ساختار کاتالوگ باید ۱ باشد.');
  if (!manifest.catalog || !codePattern.test(text(manifest.catalog.stableKey)) || !codePattern.test(text(manifest.catalog.versionCode))
    || !text(manifest.catalog.importIdentity)) errors.push('هویت پایدار کاتالوگ، نسخه و هویت درون‌ریزی الزامی است.');
  if (manifest.catalog?.lifecycle !== 'DRAFT') errors.push('درون‌ریزی فقط برای کاتالوگ DRAFT مجاز است.');
  if (manifest.catalog?.contentHashMethod !== 'SHA256_CANONICAL_JSON_EXCLUDING_CATALOG_CONTENT_HASH'
    || !sha256Pattern.test(text(manifest.catalog?.contentHash))
    || performanceRoleCatalogContentHash(input) !== manifest.catalog?.contentHash) {
    errors.push('هش محتوای کاتالوگ با JSON کانونی منطبق نیست.');
  }
  if (!manifest.source || !text(manifest.source.asOf) || !Number.isFinite(new Date(manifest.source.asOf).getTime())
    || !Array.isArray(manifest.source.references) || manifest.source.references.length === 0
    || manifest.source.references.some((reference) => !text(reference))) {
    errors.push('منبع کاتالوگ باید تاریخ مبنا و ارجاع‌های قابل پیگیری داشته باشد.');
  }
  if (!roleCatalogContract.provenanceCategories.includes(manifest.source?.provenanceCategory)) {
    errors.push('رده منشأ کاتالوگ پشتیبانی نمی‌شود.');
  }
  if (!manifest.review || !['BUSINESS_REVIEW_PENDING', 'REJECTED', 'APPROVED'].includes(manifest.review.status)) {
    errors.push('وضعیت بازبینی کسب‌وکاری کاتالوگ معتبر نیست.');
  }
  if (!text(manifest.review?.contentOrigin)) errors.push('منشأ محتوای بازبینی‌شده باید روشن و غیرخالی باشد.');
  if (manifest.review?.status === 'REJECTED') errors.push('کاتالوگ ردشده قابل درون‌ریزی نیست.');
  if ((manifest.source?.provenanceCategory === 'SYNTHETIC' || manifest.review?.contentOrigin === 'AI_PROPOSED')
    && manifest.review?.status === 'APPROVED') errors.push('محتوای ساختگی یا تولیدشده با هوش مصنوعی نمی‌تواند تأییدشده ثبت شود.');
  if (manifest.review?.status === 'APPROVED'
    && (!text(manifest.review.reviewerRole) || manifest.review.reviewerRole === 'UNASSIGNED'
      || !text(manifest.review.reviewedAt) || !Number.isFinite(new Date(manifest.review.reviewedAt!).getTime()))) {
    errors.push('کاتالوگ تأییدشده باید نقش بازبین و زمان تأیید معتبر داشته باشد.');
  }
  const snapshotContract = manifest.applicabilitySnapshotContract;
  if (snapshotContract?.schemaVersion !== 1 || snapshotContract?.container !== '__applicability'
    || snapshotContract?.snapshotVersion !== roleCatalogContract.snapshotVersion
    || snapshotContract?.sourceVersions !== 'REQUIRED_MAP_OF_FACT_TO_STABLE_SOURCE_VERSION'
    || snapshotContract?.effectiveAt !== 'REQUIRED_ISO_TIMESTAMP' || snapshotContract?.unknown !== 'BLOCK') {
    errors.push('قرارداد تصویر ثابت کاربردپذیری با تولیدکننده نسخه‌دار سامانه منطبق نیست.');
  }

  const applicabilityEntries = Array.isArray(manifest.applicabilityDictionary) ? manifest.applicabilityDictionary : [];
  const applicabilityDictionary = new Map<string, ApplicabilityDictionaryEntry>(
    applicabilityEntries.map((entry) => [entry.fact, entry]),
  );
  if (applicabilityDictionary.size !== applicabilityEntries.length
    || applicabilityEntries.some((entry) => !Object.prototype.hasOwnProperty.call(PERFORMANCE_APPLICABILITY_FACT_TYPES, entry.fact))) {
    errors.push('فرهنگ کاربردپذیری فقط باید واقعیت‌های یکتای قرارداد کنترل‌شده سامانه را تعریف کند.');
  }
  for (const [fact, factType] of Object.entries(PERFORMANCE_APPLICABILITY_FACT_TYPES)) {
    const entry = applicabilityDictionary.get(fact);
    if (!entry || entry.type !== factType || entry.unknown !== 'BLOCK' || !text(entry.source) || !text(entry.sourceVersion)) {
      errors.push(`فرهنگ کاربردپذیری باید ${fact} را با نوع ${factType}، منبع نسخه‌دار و رفتار BLOCK تعریف کند.`);
    }
    const controlled = PERFORMANCE_APPLICABILITY_FACT_OPERATORS[fact as PerformanceApplicabilityFact];
    if (!entry || !sameMembers(entry.operators, controlled.operators)) {
      errors.push(`عملگرهای فرهنگ واقعیت ${fact} با قرارداد کنترل‌شده سامانه منطبق نیست.`);
    }
  }
  if (applicabilityDictionary.has('locationId')) errors.push('به‌جای locationId باید از workplaceId استفاده شود.');

  const evidenceEntries = Array.isArray(manifest.evidenceDictionary) ? manifest.evidenceDictionary : [];
  const evidenceDictionary = new Map(evidenceEntries.map((entry) => [entry.code, entry]));
  if (evidenceDictionary.size !== evidenceEntries.length || evidenceEntries.some((entry) => !codePattern.test(text(entry.code))
    || !['CANONICAL_EVIDENCE', 'CONTROLLED_DOCUMENT', 'STRUCTURED_OBSERVATION', 'MISSING_OR_FUTURE_INTEGRATION'].includes(entry.classification)
    || [entry.sourceProcess, entry.recordVersion, entry.lineage, entry.attribution, entry.ownerRole].some((field) => !text(field)))) {
    errors.push('فرهنگ شاهد باید کدهای یکتا و طبقه‌بندی پشتیبانی‌شده داشته باشد.');
  }
  const jobs = Array.isArray(manifest.jobs) ? manifest.jobs : [];
  const positions = Array.isArray(manifest.positions) ? manifest.positions : [];
  if (jobs.length === 0) errors.push('کاتالوگ باید دست‌کم یک شغل داشته باشد.');
  const jobOwnerIds = new Map<string, string | null>();
  const positionOwnerIds = new Map<string, string | null>();
  const allOwnerCodes = new Set<string>();
  for (const [owner, ownerMap] of [...jobs.map((job) => [job, jobOwnerIds] as const), ...positions.map((position) => [position, positionOwnerIds] as const)]) {
    if (!codePattern.test(text(owner.reference?.code)) || allOwnerCodes.has(owner.reference?.code)) {
      errors.push('کد مرجع هر شغل و جایگاه باید معتبر و یکتا باشد.');
    } else {
      allOwnerCodes.add(owner.reference.code);
      ownerMap.set(owner.reference.code, typeof owner.reference.id === 'string' && owner.reference.id.trim() ? owner.reference.id : null);
    }
  }
  const allReferences = [...jobs, ...positions].map((owner) => owner.reference);
  if (manifest.source?.provenanceCategory === 'SYNTHETIC') {
    if (manifest.source.extractedFacts !== false || allReferences.some((reference) => reference.synthetic !== true || reference.id !== null)) {
      errors.push('منشأ ساختگی فقط با extractedFacts=false و مراجع synthetic بدون شناسه واقعی معتبر است.');
    }
  } else if (manifest.source?.extractedFacts !== true
    || allReferences.some((reference) => reference.synthetic !== false || !text(reference.id))) {
    errors.push('منشأ غیرساختگی به extractedFacts=true و شناسه‌های واقعی غیرساختگی نیاز دارد.');
  }

  const criteria: PlannedPerformanceCatalogCriterion[] = [];
  const templates: PlannedPerformanceCatalogTemplate[] = [];
  const seenConcepts = new Set<string>();
  const planRole = (role: CatalogRole, templateKind: 'JOB_TEMPLATE' | 'POSITION_ADDENDUM') => {
    const categoryCodes = new Set(role.categories?.map((category) => category.code) ?? []);
    if (categoryCodes.size !== role.categories.length) errors.push(`کد دسته‌های ${role.reference.code} باید یکتا باشد.`);
    if (role.categories.some((category) => !codePattern.test(text(category.code)) || !text(category.titleFa)
      || !Number.isFinite(category.weight) || category.weight <= 0)) {
      errors.push(`دسته‌های ${role.reference.code} باید کد و عنوان معتبر و وزن مثبت داشته باشند.`);
    }
    if (!role.categories.every((category) => hasAtMostTwoDecimals(category.weight))
      || !decimalSumIsHundred(role.categories.map((category) => category.weight))) {
      errors.push(`جمع وزن دسته‌های ${role.reference?.code ?? 'مالک'} باید ۱۰۰ باشد.`);
    }
    const plannedCriteria = Array.isArray(role.criteria) ? role.criteria : [];
    for (const criterion of plannedCriteria) {
      if (!codePattern.test(text(criterion.conceptCode)) || seenConcepts.has(criterion.conceptCode)) {
        errors.push(`کد مفهوم معیار ${criterion.conceptCode ?? ''} باید معتبر و در کاتالوگ یکتا باشد.`);
      }
      seenConcepts.add(criterion.conceptCode);
      if (!categoryCodes.has(criterion.categoryCode)) {
        errors.push(`معیار ${criterion.conceptCode} به دسته تعریف‌نشده ${criterion.categoryCode ?? ''} ارجاع می‌دهد.`);
      }
      if (!codePattern.test(text(criterion.versionCode)) || !text(criterion.titleFa) || !text(criterion.meaningFa)
        || !hasAtMostTwoDecimals(criterion.weight) || criterion.weight <= 0) {
        errors.push(`نسخه، عنوان، معنا و وزن معیار ${criterion.conceptCode} باید معتبر باشد.`);
      }
      if (criterion.kind !== 'JUDGMENT' || !Array.isArray(criterion.anchorsFa) || criterion.anchorsFa.length !== 5) {
        errors.push(`معیار ${criterion.conceptCode} باید JUDGMENT با پنج لنگر فارسی باشد.`);
      }
      if (!Number.isInteger(criterion.evidencePolicy?.minimumReliableCount) || criterion.evidencePolicy.minimumReliableCount < 1
        || !Number.isInteger(criterion.evidencePolicy?.windowDays) || criterion.evidencePolicy.windowDays < 1
        || criterion.evidencePolicy?.automaticGrade !== false) {
        errors.push(`سیاست شاهد معیار ${criterion.conceptCode} باید حداقل و بازه مثبت داشته باشد و درجه خودکار را غیرفعال کند.`);
      }
      if (!Array.isArray(criterion.outsideControlFactors) || criterion.outsideControlFactors.length === 0
        || criterion.outsideControlFactors.some((factor) => !text(factor))) {
        errors.push(`عوامل خارج از کنترل معیار ${criterion.conceptCode} باید روشن ثبت شوند.`);
      }
      const allowedKinds = (criterion.evidencePolicy?.dictionaryCodes ?? []).map((code) => evidenceDictionary.get(code)).map((entry) => {
        if (!entry || entry.classification === 'MISSING_OR_FUTURE_INTEGRATION') {
          errors.push(`منبع شاهد معیار ${criterion.conceptCode} هنوز قابل اتکا نیست.`);
          return null;
        }
        return evidenceKind(entry.classification);
      }).filter((kind): kind is NonNullable<typeof kind> => Boolean(kind));
      if (allowedKinds.length === 0) errors.push(`معیار ${criterion.conceptCode} باید دست‌کم یک گونه شاهد قابل اتکا داشته باشد.`);
      criteria.push({
        sourceOwnerCode: role.reference.code,
        sourceVersionCode: criterion.versionCode,
        content: {
          schemaVersion: 1,
          conceptCode: criterion.conceptCode,
          titleFa: criterion.titleFa,
          meaningFa: criterion.meaningFa,
          kind: criterion.kind,
          anchorsFa: criterion.anchorsFa,
          applicability: resolveApplicability(criterion, applicabilityDictionary, { jobs: jobOwnerIds, positions: positionOwnerIds }, errors),
          evidence: {
            allowedKinds: [...new Set(allowedKinds)],
            minimumReliableCount: criterion.evidencePolicy?.minimumReliableCount,
            lookbackDays: criterion.evidencePolicy?.windowDays,
            required: true,
          },
          catalogSource: {
            importIdentity: manifest.catalog?.importIdentity,
            catalogVersion: manifest.catalog?.versionCode,
            sourceAsOf: manifest.source?.asOf,
            sourceProvenanceCategory: manifest.source?.provenanceCategory,
            manifestContentOrigin: manifest.review?.contentOrigin,
            ...(manifest.review?.reviewerRole ? { manifestReviewerRole: manifest.review.reviewerRole } : {}),
            ...(manifest.review?.reviewedAt ? { manifestReviewedAt: manifest.review.reviewedAt } : {}),
            manifestContentHash: manifest.catalog?.contentHash,
            manifestReviewStatus: manifest.review?.status,
            reviewStatus: 'BUSINESS_REVIEW_PENDING',
            sourceVersionCode: criterion.versionCode,
          },
        },
      });
      errors.push(...validateCriterionPolicyContent(criteria[criteria.length - 1].content)
        .map((error) => `${criterion.conceptCode}: ${error}`));
    }
    for (const category of role.categories ?? []) {
      const categoryCriteria = plannedCriteria.filter((criterion) => criterion.categoryCode === category.code);
      if (!categoryCodes.has(category.code) || !categoryCriteria.every((criterion) => hasAtMostTwoDecimals(criterion.weight))
        || !decimalSumIsHundred(categoryCriteria.map((criterion) => criterion.weight))) {
        errors.push(`جمع وزن معیارهای دسته ${category.code} باید ۱۰۰ باشد.`);
      }
    }
    templates.push({
      sourceOwnerCode: role.reference.code,
      templateKind,
      ownerType: templateKind === 'JOB_TEMPLATE' ? 'JOB' : 'POSITION',
      ownerId: (templateKind === 'JOB_TEMPLATE' ? jobOwnerIds : positionOwnerIds).get(role.reference.code) ?? null,
      titleFa: role.titleFa,
      categories: (role.categories ?? []).map((category) => ({
        id: category.code,
        titleFa: category.titleFa,
        weightPercent: percent(category.weight),
        required: true,
        criteria: plannedCriteria.filter((criterion) => criterion.categoryCode === category.code)
          .map((criterion) => ({ conceptCode: criterion.conceptCode, weightPercent: percent(criterion.weight) })),
      })),
    });
    const previewTemplate: PerformanceTemplatePolicyContent = {
      schemaVersion: 1,
      titleFa: role.titleFa,
      categories: templates[templates.length - 1].categories.map((category) => ({
        ...category,
        criteria: category.criteria.map((criterion) => ({
          criterionVersionId: criterion.conceptCode,
          weightPercent: criterion.weightPercent,
        })),
      })),
    };
    errors.push(...validatePerformanceTemplateContent(previewTemplate).map((error) => `${role.reference.code}: ${error}`));
  };
  for (const job of jobs) planRole(job, 'JOB_TEMPLATE');

  const jobByCode = new Map(jobs.map((job) => [job.reference.code, job]));
  const compositions: PerformanceCatalogCompositionPreview[] = [];
  for (const position of positions) {
    const job = jobByCode.get(position.jobReferenceCode);
    if (!job) errors.push(`جایگاه ${position.reference?.code ?? ''} به شغل ناشناخته ارجاع می‌دهد.`);
    const jobWeight = position.composition?.jobWeight;
    const addendumWeight = position.composition?.addendumWeight;
    if (!hasAtMostTwoDecimals(jobWeight) || !hasAtMostTwoDecimals(addendumWeight)
      || !decimalSumIsHundred([jobWeight, addendumWeight])
      || jobWeight < 70 || addendumWeight > 30 || addendumWeight < 0) {
      errors.push(`ترکیب شغل و افزوده جایگاه ${position.reference?.code ?? ''} باید جمع ۱۰۰، سهم شغل حداقل ۷۰ و افزوده حداکثر ۳۰ باشد.`);
    }
    const hasAddendum = Array.isArray(position.criteria) && position.criteria.length > 0;
    if (!hasAddendum && (jobWeight !== 100 || addendumWeight !== 0)) {
      errors.push(`جایگاه بدون افزوده ${position.reference?.code ?? ''} باید ترکیب ۱۰۰/۰ داشته باشد.`);
    }
    if (hasAddendum && addendumWeight <= 0) errors.push(`جایگاه دارای معیار افزوده ${position.reference?.code ?? ''} باید سهم افزوده مثبت داشته باشد.`);
    if (hasAddendum) planRole(position, 'POSITION_ADDENDUM');
    compositions.push({
      jobReferenceCode: position.jobReferenceCode,
      jobId: job ? jobOwnerIds.get(job.reference.code) ?? null : null,
      positionReferenceCode: position.reference.code,
      positionId: positionOwnerIds.get(position.reference.code) ?? null,
      jobSharePercent: percent(jobWeight),
      addendumSharePercent: percent(addendumWeight),
      basis: hasAddendum ? 'JOB_WITH_POSITION_ADDENDUM' : 'JOB_ONLY',
    });
  }

  const warnings: string[] = [];
  const unresolvedOwners = [...jobOwnerIds.values(), ...positionOwnerIds.values()].some((id) => id === null);
  if (unresolvedOwners) warnings.push('شناسه واقعی یک یا چند شغل/جایگاه حل نشده و این نسخه فقط قابل پیش‌نمایش است.');
  if (manifest.source?.provenanceCategory === 'SYNTHETIC') warnings.push('محتوای ساختگی فقط برای پذیرش نرم‌افزار است و به داده شرکت تبدیل نمی‌شود.');
  if (manifest.review?.status !== 'APPROVED') warnings.push('محتوا هنوز تأیید کسب‌وکاری نشده و در صورت درون‌ریزی فقط DRAFT می‌ماند.');

  if (errors.length > 0) return { errors: [...new Set(errors)], plan: null };
  return {
    errors: [],
    plan: {
      manifest,
      importIdentity: manifest.catalog.importIdentity,
      contentHash: manifest.catalog.contentHash,
      importable: !unresolvedOwners && ['PRODUCTION', 'LOCAL'].includes(manifest.source.provenanceCategory),
      warnings,
      criteria,
      templates,
      compositions,
    },
  };
};
