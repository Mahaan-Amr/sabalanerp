import { canonicalPerformanceHash, type PerformanceCriterionPolicyContent } from './personnelPerformancePolicy';
import {
  PERFORMANCE_APPLICABILITY_FACT_TYPES,
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
  applicability: { fact: string; operator: 'EQUALS' | 'IN' | 'EXISTS'; values: unknown[] } | null;
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
};

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
    provenanceCategory: string;
    asOf: string;
    references: string[];
    extractedFacts: boolean;
  };
  review: {
    contentOrigin: string;
    status: 'BUSINESS_REVIEW_PENDING' | 'REJECTED' | 'APPROVED';
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
      reviewStatus: PerformanceRoleCatalogManifest['review']['status'];
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

const hasCatalogManifestShape = (input: CatalogRecord) => {
  if (!isRecord(input.catalog) || !isRecord(input.source) || !isRecord(input.review)
    || !Array.isArray(input.applicabilityDictionary) || !Array.isArray(input.evidenceDictionary)
    || !Array.isArray(input.jobs) || !Array.isArray(input.positions)) return false;
  const validCriterion = (value: unknown) => isRecord(value)
    && (value.applicability === null || isRecord(value.applicability))
    && Array.isArray(value.anchorsFa)
    && isRecord(value.evidencePolicy)
    && Array.isArray(value.evidencePolicy.dictionaryCodes)
    && Array.isArray(value.outsideControlFactors);
  const validRole = (value: unknown) => isRecord(value)
    && isRecord(value.reference)
    && Array.isArray(value.categories)
    && value.categories.every(isRecord)
    && Array.isArray(value.criteria)
    && value.criteria.every(validCriterion);
  return input.applicabilityDictionary.every(isRecord)
    && input.evidenceDictionary.every(isRecord)
    && input.jobs.every(validRole)
    && input.positions.every((position) => validRole(position) && isRecord(position.composition));
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
  ownerIds: Map<string, string | null>,
  errors: string[],
): TypedPerformanceApplicabilityRule | null => {
  if (!criterion.applicability) return null;
  const definition = dictionary.get(criterion.applicability.fact);
  if (!definition) {
    errors.push(`معیار ${criterion.conceptCode} از واقعیت کاربردپذیری تعریف‌نشده استفاده می‌کند.`);
    return null;
  }
  if (definition.unknown !== 'BLOCK' || !definition.source.trim() || !definition.sourceVersion.trim()) {
    errors.push(`واقعیت ${definition.fact} باید منبع نسخه‌دار و رفتار BLOCK برای مقدار نامعلوم داشته باشد.`);
  }
  if (PERFORMANCE_APPLICABILITY_FACT_TYPES[definition.fact] !== definition.type) {
    errors.push(`نوع واقعیت ${definition.fact} با قرارداد کاربردپذیری سامانه سازگار نیست.`);
  }
  if (!definition.operators.includes(criterion.applicability.operator)) {
    errors.push(`عملگر معیار ${criterion.conceptCode} در فرهنگ واقعیت ${definition.fact} مجاز نیست.`);
  }
  const values = criterion.applicability.values.map((value) => {
    if (typeof value !== 'string' || !ownerIds.has(value)) return value;
    return ownerIds.get(value) ?? value;
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
    || !Array.isArray(manifest.source.references) || manifest.source.references.length === 0) {
    errors.push('منبع کاتالوگ باید تاریخ مبنا و ارجاع‌های قابل پیگیری داشته باشد.');
  }
  if (!manifest.review || !['BUSINESS_REVIEW_PENDING', 'REJECTED', 'APPROVED'].includes(manifest.review.status)) {
    errors.push('وضعیت بازبینی کسب‌وکاری کاتالوگ معتبر نیست.');
  }
  if (manifest.review?.status === 'REJECTED') errors.push('کاتالوگ ردشده قابل درون‌ریزی نیست.');
  if ((manifest.source?.provenanceCategory === 'SYNTHETIC' || manifest.review?.contentOrigin === 'AI_PROPOSED')
    && manifest.review?.status === 'APPROVED') errors.push('محتوای ساختگی یا تولیدشده با هوش مصنوعی نمی‌تواند تأییدشده ثبت شود.');

  const applicabilityEntries = Array.isArray(manifest.applicabilityDictionary) ? manifest.applicabilityDictionary : [];
  const applicabilityDictionary = new Map<string, ApplicabilityDictionaryEntry>(
    applicabilityEntries.map((entry) => [entry.fact, entry]),
  );
  for (const [fact, factType] of Object.entries(PERFORMANCE_APPLICABILITY_FACT_TYPES)) {
    const entry = applicabilityDictionary.get(fact);
    if (!entry || entry.type !== factType || entry.unknown !== 'BLOCK' || !text(entry.source) || !text(entry.sourceVersion)) {
      errors.push(`فرهنگ کاربردپذیری باید ${fact} را با نوع ${factType}، منبع نسخه‌دار و رفتار BLOCK تعریف کند.`);
    }
  }
  if (applicabilityDictionary.has('locationId')) errors.push('به‌جای locationId باید از workplaceId استفاده شود.');

  const evidenceEntries = Array.isArray(manifest.evidenceDictionary) ? manifest.evidenceDictionary : [];
  const evidenceDictionary = new Map(evidenceEntries.map((entry) => [entry.code, entry]));
  const jobs = Array.isArray(manifest.jobs) ? manifest.jobs : [];
  const positions = Array.isArray(manifest.positions) ? manifest.positions : [];
  if (jobs.length === 0) errors.push('کاتالوگ باید دست‌کم یک شغل داشته باشد.');
  const ownerIds = new Map<string, string | null>();
  for (const owner of [...jobs, ...positions]) {
    if (!codePattern.test(text(owner.reference?.code)) || ownerIds.has(owner.reference?.code)) {
      errors.push('کد مرجع هر شغل و جایگاه باید معتبر و یکتا باشد.');
    } else ownerIds.set(owner.reference.code, typeof owner.reference.id === 'string' && owner.reference.id.trim() ? owner.reference.id : null);
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
    if (!Array.isArray(role.categories) || role.categories.reduce((sum, category) => sum + category.weight, 0) !== 100) {
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
        || !Number.isFinite(criterion.weight) || criterion.weight <= 0) {
        errors.push(`نسخه، عنوان، معنا و وزن معیار ${criterion.conceptCode} باید معتبر باشد.`);
      }
      if (criterion.kind !== 'JUDGMENT' || !Array.isArray(criterion.anchorsFa) || criterion.anchorsFa.length !== 5) {
        errors.push(`معیار ${criterion.conceptCode} باید JUDGMENT با پنج لنگر فارسی باشد.`);
      }
      const allowedKinds = (criterion.evidencePolicy?.dictionaryCodes ?? []).map((code) => evidenceDictionary.get(code)).map((entry) => {
        if (!entry || entry.classification === 'MISSING_OR_FUTURE_INTEGRATION') {
          errors.push(`منبع شاهد معیار ${criterion.conceptCode} هنوز قابل اتکا نیست.`);
          return null;
        }
        return evidenceKind(entry.classification);
      }).filter((kind): kind is NonNullable<typeof kind> => Boolean(kind));
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
          applicability: resolveApplicability(criterion, applicabilityDictionary, ownerIds, errors),
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
            reviewStatus: manifest.review?.status,
            sourceVersionCode: criterion.versionCode,
          },
        },
      });
    }
    for (const category of role.categories ?? []) {
      const categoryCriteria = plannedCriteria.filter((criterion) => criterion.categoryCode === category.code);
      if (!categoryCodes.has(category.code) || categoryCriteria.reduce((sum, criterion) => sum + criterion.weight, 0) !== 100) {
        errors.push(`جمع وزن معیارهای دسته ${category.code} باید ۱۰۰ باشد.`);
      }
    }
    templates.push({
      sourceOwnerCode: role.reference.code,
      templateKind,
      ownerType: templateKind === 'JOB_TEMPLATE' ? 'JOB' : 'POSITION',
      ownerId: ownerIds.get(role.reference.code) ?? null,
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
  };
  for (const job of jobs) planRole(job, 'JOB_TEMPLATE');

  const jobByCode = new Map(jobs.map((job) => [job.reference.code, job]));
  const compositions: PerformanceCatalogCompositionPreview[] = [];
  for (const position of positions) {
    const job = jobByCode.get(position.jobReferenceCode);
    if (!job) errors.push(`جایگاه ${position.reference?.code ?? ''} به شغل ناشناخته ارجاع می‌دهد.`);
    const jobWeight = position.composition?.jobWeight;
    const addendumWeight = position.composition?.addendumWeight;
    if (!Number.isFinite(jobWeight) || !Number.isFinite(addendumWeight) || jobWeight + addendumWeight !== 100
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
      jobId: job ? ownerIds.get(job.reference.code) ?? null : null,
      positionReferenceCode: position.reference.code,
      positionId: ownerIds.get(position.reference.code) ?? null,
      jobSharePercent: percent(jobWeight),
      addendumSharePercent: percent(addendumWeight),
      basis: hasAddendum ? 'JOB_WITH_POSITION_ADDENDUM' : 'JOB_ONLY',
    });
  }

  const warnings: string[] = [];
  const unresolvedOwners = [...ownerIds.values()].some((id) => id === null);
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
      importable: !unresolvedOwners && manifest.source.provenanceCategory !== 'SYNTHETIC',
      warnings,
      criteria,
      templates,
      compositions,
    },
  };
};
