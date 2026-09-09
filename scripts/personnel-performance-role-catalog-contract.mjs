import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROLE_CATALOG_CONTRACT = require('../backend/src/contracts/personnelPerformanceRoleCatalog.json');

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasPersian = (value) => typeof value === 'string' && /[\u0600-\u06ff]/.test(value);
const isCode = (value) => typeof value === 'string' && /^[A-Z0-9][A-Z0-9_-]{2,95}$/.test(value);
const isSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const CONTROLLED_FACTS = new Map(Object.entries(ROLE_CATALOG_CONTRACT.applicabilityFacts));

const EVIDENCE_CLASSES = new Set([
  'CANONICAL_EVIDENCE',
  'CONTROLLED_DOCUMENT',
  'STRUCTURED_OBSERVATION',
  'MISSING_OR_FUTURE_INTEGRATION',
]);

const COVERAGE_COUNT_FIELDS = [
  'personnel',
  'employmentRelationships',
  'assignmentSections',
  'periodEligiblePersonnel',
  'structurallyReadyPersonnel',
  'cohortMembers',
  'acceptedResults',
  'badgesAvailable',
];

const valueMatchesType = (value, type) => {
  if (type === 'BOOLEAN') return typeof value === 'boolean';
  if (type === 'DATE') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  return typeof value === 'string' && value.trim().length > 0;
};

const sameMembers = (left, right) => Array.isArray(left) && left.length === right.length
  && left.every((value) => right.includes(value));

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const manifestContentHash = (manifest) => {
  const content = structuredClone(manifest);
  delete content.catalog.contentHash;
  return createHash('sha256').update(stableJson(content)).digest('hex');
};

const validateCriterion = (criterion, path, evidenceCodes, errors) => {
  if (!isRecord(criterion)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (!isCode(criterion.conceptCode) || !isCode(criterion.versionCode)) {
    errors.push(`${path} requires stable concept and version codes.`);
  }
  if (!hasPersian(criterion.titleFa) || !hasPersian(criterion.meaningFa)) {
    errors.push(`${path} requires a Persian title and meaning.`);
  }
  if (criterion.kind !== 'JUDGMENT') {
    errors.push(`${path} must use JUDGMENT; counts and KPIs are evidence, never grades.`);
  }
  if (!Array.isArray(criterion.anchorsFa) || criterion.anchorsFa.length !== 5
    || criterion.anchorsFa.some((anchor) => !hasPersian(anchor))) {
    errors.push(`${path} requires exactly five Persian anchors.`);
  }
  if (!Number.isFinite(criterion.weight) || criterion.weight <= 0) {
    errors.push(`${path}.weight must be a positive number.`);
  }
  if (!Array.isArray(criterion.evidencePolicy?.dictionaryCodes)
    || criterion.evidencePolicy.dictionaryCodes.length === 0
    || criterion.evidencePolicy.dictionaryCodes.some((code) => !evidenceCodes.has(code))) {
    errors.push(`${path} must reference defined evidence dictionary entries.`);
  }
  if (!Number.isInteger(criterion.evidencePolicy?.minimumReliableCount)
    || criterion.evidencePolicy.minimumReliableCount < 1) {
    errors.push(`${path} requires a positive reliable-evidence minimum.`);
  }
  if (!Number.isInteger(criterion.evidencePolicy?.windowDays)
    || criterion.evidencePolicy.windowDays < 1) {
    errors.push(`${path} requires a positive evidence window.`);
  }
  if (criterion.evidencePolicy?.automaticGrade !== false) {
    errors.push(`${path} must explicitly disable automatic grades.`);
  }
  if (!Array.isArray(criterion.outsideControlFactors) || criterion.outsideControlFactors.length === 0) {
    errors.push(`${path} must record outside-control factors.`);
  }
  if (criterion.applicability !== null) {
    const factDefinition = CONTROLLED_FACTS.get(criterion.applicability?.fact);
    const factType = factDefinition?.type;
    if (!factDefinition) errors.push(`${path} uses a non-controlled applicability fact.`);
    if (criterion.applicability?.schemaVersion !== 1) errors.push(`${path}.applicability.schemaVersion must be 1.`);
    if (criterion.applicability?.factType !== factType) errors.push(`${path}.applicability.factType must match the dictionary.`);
    if (!factDefinition?.operators.includes(criterion.applicability?.operator)) {
      errors.push(`${path} uses an operator not allowed for its controlled fact.`);
    }
    const values = criterion.applicability?.values;
    if (!Array.isArray(values)) {
      errors.push(`${path}.applicability.values must be an array.`);
    } else if (criterion.applicability.operator === 'EQUALS') {
      if (factType === 'STRING_LIST' || values.length !== 1 || !valueMatchesType(values[0], factType)) {
        errors.push(`${path} EQUALS requires exactly one same-type scalar and cannot target STRING_LIST.`);
      }
    } else if (criterion.applicability.operator === 'IN') {
      if (values.length === 0 || values.some((value) => !valueMatchesType(value, factType === 'STRING_LIST' ? 'STRING' : factType))) {
        errors.push(`${path} IN requires one or more same-type membership values.`);
      }
    } else if (criterion.applicability.operator === 'EXISTS' && values.length !== 0) {
      errors.push(`${path} EXISTS requires no values.`);
    }
    if (['personnelId', 'userId', 'nationalCode', 'protectedTrait'].includes(criterion.applicability?.fact)) {
      errors.push(`${path} uses person-specific or protected applicability.`);
    }
  }
};

const validateWeightedCriteria = (owner, path, evidenceCodes, errors) => {
  if (!Array.isArray(owner.categories) || owner.categories.length === 0) {
    errors.push(`${path}.categories must not be empty.`);
    return;
  }
  const categoryCodes = new Set();
  let categoryTotal = 0;
  owner.categories.forEach((category, categoryIndex) => {
    const categoryPath = `${path}.categories[${categoryIndex}]`;
    if (!isCode(category.code) || categoryCodes.has(category.code)) errors.push(`${categoryPath}.code must be unique and stable.`);
    categoryCodes.add(category.code);
    if (!Number.isFinite(category.weight) || category.weight <= 0) errors.push(`${categoryPath}.weight must be positive.`);
    else categoryTotal += category.weight;
  });
  if (categoryTotal !== 100) errors.push(`${path} category weights must total 100.`);

  if (!Array.isArray(owner.criteria) || owner.criteria.length === 0) {
    errors.push(`${path}.criteria must not be empty.`);
    return;
  }
  const criteriaByCategory = new Map([...categoryCodes].map((code) => [code, 0]));
  owner.criteria.forEach((criterion, criterionIndex) => {
    const criterionPath = `${path}.criteria[${criterionIndex}]`;
    validateCriterion(criterion, criterionPath, evidenceCodes, errors);
    if (!categoryCodes.has(criterion.categoryCode)) errors.push(`${criterionPath} references an unknown category.`);
    else criteriaByCategory.set(criterion.categoryCode, criteriaByCategory.get(criterion.categoryCode) + criterion.weight);
  });
  for (const [code, weight] of criteriaByCategory) {
    if (weight !== 100) errors.push(`${path} criteria weights in category ${code} must total 100.`);
  }
};

export const validateRoleCatalogManifest = (manifest) => {
  const errors = [];
  if (!isRecord(manifest)) return ['Manifest must be an object.'];
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (!isCode(manifest.catalog?.stableKey) || !isCode(manifest.catalog?.versionCode)) {
    errors.push('Catalog requires stable key and version identity.');
  }
  if (typeof manifest.catalog?.importIdentity !== 'string'
    || !/^[A-Z0-9][A-Z0-9:_-]{2,127}$/.test(manifest.catalog.importIdentity)) {
    errors.push('Catalog requires a stable importIdentity.');
  }
  if (!isCode(manifest.catalog?.effectiveContext)) errors.push('Catalog requires a stable effectiveContext.');
  if (manifest.catalog?.lifecycle !== 'DRAFT') errors.push('The proposed catalog must remain DRAFT.');
  if (!isSha256(manifest.catalog?.contentHash)) errors.push('Catalog requires a SHA-256 content hash field.');
  else if (manifest.catalog.contentHashMethod !== 'SHA256_CANONICAL_JSON_EXCLUDING_CATALOG_CONTENT_HASH'
    || manifestContentHash(manifest) !== manifest.catalog.contentHash) {
    errors.push('Catalog content hash does not match the canonical manifest content.');
  }
  if (!ROLE_CATALOG_CONTRACT.provenanceCategories.includes(manifest.source?.provenanceCategory)) {
    errors.push('Source provenance category is missing or unsupported.');
  }
  if (!manifest.source?.asOf || !Array.isArray(manifest.source?.references)) errors.push('Source requires as-of time and references.');
  if (manifest.source?.provenanceCategory === 'SYNTHETIC' && manifest.review?.status === 'APPROVED') {
    errors.push('Synthetic or AI-authored content cannot be approved.');
  }
  if (manifest.review?.contentOrigin === 'AI_PROPOSED' && manifest.review?.status === 'APPROVED') {
    errors.push('AI-authored content cannot be approved.');
  }
  if (!['BUSINESS_REVIEW_PENDING', 'REJECTED', 'APPROVED'].includes(manifest.review?.status)) {
    errors.push('Review status is missing or unsupported.');
  }

  const declaredFacts = new Map((manifest.applicabilityDictionary ?? []).map((entry) => [entry.fact, entry]));
  for (const [index, entry] of (manifest.applicabilityDictionary ?? []).entries()) {
    if (entry.unknown !== 'BLOCK') errors.push(`applicabilityDictionary[${index}].unknown must be BLOCK.`);
    if (typeof entry.source !== 'string' || entry.source.trim() === '') errors.push(`applicabilityDictionary[${index}].source is required.`);
    if (typeof entry.sourceVersion !== 'string' || entry.sourceVersion.trim() === '') errors.push(`applicabilityDictionary[${index}].sourceVersion is required.`);
  }
  for (const [fact, definition] of CONTROLLED_FACTS) {
    const declared = declaredFacts.get(fact);
    if (declared?.type !== definition.type) errors.push(`Applicability dictionary must define ${fact} as ${definition.type}.`);
    if (!sameMembers(declared?.operators, definition.operators)) errors.push(`Applicability dictionary operators for ${fact} do not match the controlled schema.`);
  }
  if (declaredFacts.has('locationId')) errors.push('Applicability dictionary must use canonical workplaceId, not locationId.');
  const snapshotContract = manifest.applicabilitySnapshotContract;
  if (snapshotContract?.schemaVersion !== 1) errors.push('applicabilitySnapshotContract.schemaVersion must be 1.');
  if (snapshotContract?.container !== '__applicability') errors.push('applicabilitySnapshotContract.container must be __applicability.');
  if (snapshotContract?.snapshotVersion !== ROLE_CATALOG_CONTRACT.snapshotVersion) errors.push('applicabilitySnapshotContract.snapshotVersion must match the producer identity.');
  if (snapshotContract?.sourceVersions !== 'REQUIRED_MAP_OF_FACT_TO_STABLE_SOURCE_VERSION') errors.push('applicabilitySnapshotContract.sourceVersions is required.');
  if (snapshotContract?.effectiveAt !== 'REQUIRED_ISO_TIMESTAMP') errors.push('applicabilitySnapshotContract.effectiveAt is required.');
  if (snapshotContract?.unknown !== 'BLOCK') errors.push('applicabilitySnapshotContract.unknown must be BLOCK.');

  const evidenceCodes = new Set();
  if (!Array.isArray(manifest.evidenceDictionary) || manifest.evidenceDictionary.length === 0) {
    errors.push('Evidence dictionary must not be empty.');
  } else {
    manifest.evidenceDictionary.forEach((entry, index) => {
      if (!isCode(entry.code) || evidenceCodes.has(entry.code)) errors.push(`evidenceDictionary[${index}].code must be unique and stable.`);
      evidenceCodes.add(entry.code);
      if (!EVIDENCE_CLASSES.has(entry.classification)) errors.push(`evidenceDictionary[${index}] has an unsupported classification.`);
      for (const field of ['sourceProcess', 'recordVersion', 'lineage', 'attribution', 'ownerRole']) {
        if (typeof entry[field] !== 'string' || entry[field].trim() === '') errors.push(`evidenceDictionary[${index}].${field} is required.`);
      }
    });
  }

  const jobCodes = new Set();
  if (!Array.isArray(manifest.jobs) || manifest.jobs.length === 0) errors.push('Jobs must not be empty.');
  else manifest.jobs.forEach((job, index) => {
    const path = `jobs[${index}]`;
    if (!isCode(job.reference?.code) || jobCodes.has(job.reference?.code)) errors.push(`${path} requires a unique Job reference code.`);
    jobCodes.add(job.reference?.code);
    if (job.reference?.synthetic !== (manifest.source?.provenanceCategory === 'SYNTHETIC')) errors.push(`${path} provenance conflicts with the manifest source.`);
    if (!hasPersian(job.titleFa) || !hasPersian(job.purposeFa) || !Array.isArray(job.responsibilitiesFa) || job.responsibilitiesFa.some((item) => !hasPersian(item))) {
      errors.push(`${path} requires Persian title, purpose, and responsibilities.`);
    }
    validateWeightedCriteria(job, path, evidenceCodes, errors);
  });

  if (!Array.isArray(manifest.positions)) errors.push('Positions must be an array.');
  else manifest.positions.forEach((position, index) => {
    const path = `positions[${index}]`;
    if (!isCode(position.reference?.code) || !jobCodes.has(position.jobReferenceCode)) errors.push(`${path} requires valid Position and Job references.`);
    const { jobWeight, addendumWeight } = position.composition ?? {};
    if (jobWeight + addendumWeight !== 100) errors.push(`${path} composition must total 100.`);
    if (jobWeight < 70) errors.push(`${path} job weight must be at least 70.`);
    if (addendumWeight > 30) errors.push(`${path} addendum weight must not exceed 30.`);
    if (addendumWeight === 0 && (position.criteria?.length ?? 0) > 0) errors.push(`${path} cannot carry criteria without addendum weight.`);
    if (addendumWeight > 0) validateWeightedCriteria(position, path, evidenceCodes, errors);
  });

  if (!['UNAVAILABLE', 'AVAILABLE'].includes(manifest.coverage?.status)) errors.push('Coverage status is missing or unsupported.');
  if (manifest.coverage?.status === 'UNAVAILABLE') {
    if (manifest.coverage.counts !== null) errors.push('Unavailable coverage must not invent counts.');
    if (!Array.isArray(manifest.coverage.limitations) || manifest.coverage.limitations.length === 0) errors.push('Unavailable coverage requires limitations.');
  } else {
    for (const field of COVERAGE_COUNT_FIELDS) {
      if (!Number.isInteger(manifest.coverage.counts?.[field]) || manifest.coverage.counts[field] < 0) {
        errors.push(`coverage.counts.${field} must be a non-negative integer.`);
      }
    }
  }
  if (!Array.isArray(manifest.syntheticCoverageExamples)
    || !manifest.syntheticCoverageExamples.some((row) => row.userStatus === 'NO_USER')) {
    errors.push('Synthetic acceptance coverage must demonstrate a worker without User.');
  }

  return [...new Set(errors)];
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFile } = await import('node:fs/promises');
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node scripts/personnel-performance-role-catalog-contract.mjs <manifest.json>');
  const errors = validateRoleCatalogManifest(JSON.parse(await readFile(path, 'utf8')));
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log('Personnel performance role catalog manifest is valid.');
  }
}
