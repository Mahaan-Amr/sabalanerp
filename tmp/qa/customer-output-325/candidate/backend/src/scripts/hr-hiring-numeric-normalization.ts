import { Prisma, PrismaClient } from '@prisma/client';
import fs from 'node:fs';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const argument = (prefix: string) => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
const reportPath = argument('--report=');
const manifestPath = argument('--manifest=');

const translateDigits = (value: string) => value
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

const identifierRules: Record<string, RegExp> = {
  mobile: /^09\d{9}$/,
  nationalCode: /^\d{10}$/,
  postalCode: /^\d{10}$/,
  employeeNumber: /^\d+$/,
};

type Change = { entity: string; id: string; field: string; before: string; after: string };
type Review = Change & { reason: string };

const main = async () => {
  const [candidates, personnel, revisions] = await Promise.all([
    prisma.hrCandidate.findMany({ select: { id: true, mobile: true, nationalCode: true, postalCode: true, profileJson: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.personnel.findMany({ select: { id: true, nationalCode: true, employeeNumber: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.hrApplicationFormRevision.findMany({ select: { id: true, dataJson: true, updatedAt: true }, orderBy: { id: 'asc' } }),
  ]);
  const changes: Change[] = [];
  const reviews: Review[] = [];
  const inspect = (entity: string, id: string, field: string, value: unknown) => {
    if (typeof value !== 'string') return;
    const after = translateDigits(value);
    if (after === value) return;
    const rule = identifierRules[field];
    const change = { entity, id, field, before: value, after };
    if (rule && !rule.test(after)) reviews.push({ ...change, reason: 'INVALID_AFTER_DIGIT_TRANSLATION' });
    else changes.push(change);
  };
  for (const row of candidates) for (const field of ['mobile', 'nationalCode', 'postalCode'] as const) inspect('HrCandidate', row.id, field, row[field]);
  for (const row of personnel) for (const field of ['nationalCode', 'employeeNumber'] as const) inspect('Personnel', row.id, field, row[field]);
  const jsonFields = new Set(['mobile', 'homePhone', 'nationalCode', 'postalCode', 'childrenCount', 'graduationYear', 'desiredSalary', 'lastSalaryBenefits', 'duration', 'desiredSalaryRials', 'durationMonths', 'salaryRials']);
  const jsonRules: Record<string, RegExp> = {
    mobile: identifierRules.mobile,
    homePhone: /^\d+$/,
    nationalCode: identifierRules.nationalCode,
    postalCode: identifierRules.postalCode,
    childrenCount: /^\d+$/,
    graduationYear: /^\d+$/,
    desiredSalary: /^\d+$/,
    lastSalaryBenefits: /^\d+$/,
    duration: /^\d+$/,
    desiredSalaryRials: /^\d+$/,
    durationMonths: /^\d+$/,
    salaryRials: /^\d+$/,
  };
  const translatedRevisionJson = new Map<string, Prisma.InputJsonValue>();
  const translatedCandidateProfiles = new Map<string, Prisma.InputJsonValue>();
  const translateJson = (entity: string, entityId: string, value: unknown, path = ''): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => translateJson(entity, entityId, item, `${path}[${index}]`));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonFields.has(key) && typeof item === 'string'
      ? (() => {
          const after = translateDigits(item);
          if (after === item) return item;
          const change = { entity, id: entityId, field: path ? `${path}.${key}` : key, before: item, after };
          if (!jsonRules[key].test(after)) {
            reviews.push({ ...change, reason: 'INVALID_AFTER_DIGIT_TRANSLATION' });
            return item;
          }
          changes.push(change);
          return after;
        })()
      : translateJson(entity, entityId, item, path ? `${path}.${key}` : key)]));
    return value;
  };
  for (const revision of revisions) translatedRevisionJson.set(revision.id, translateJson('HrApplicationFormRevision', revision.id, revision.dataJson) as Prisma.InputJsonValue);
  for (const candidate of candidates) if (candidate.profileJson) translatedCandidateProfiles.set(candidate.id, translateJson('HrCandidateProfile', candidate.id, candidate.profileJson) as Prisma.InputJsonValue);
  const uniqueConflicts = new Set<string>();
  const existingNationalCodes: Record<string, string[]> = {
    HrCandidate: candidates.flatMap((item) => item.nationalCode ? [translateDigits(item.nationalCode)] : []),
    Personnel: personnel.flatMap((item) => item.nationalCode ? [translateDigits(item.nationalCode)] : []),
  };
  for (const entity of ['HrCandidate', 'Personnel']) {
    const nationalChanges = changes.filter((item) => item.entity === entity && item.field === 'nationalCode');
    const counts = new Map<string, number>();
    for (const value of existingNationalCodes[entity]) counts.set(value, (counts.get(value) || 0) + 1);
    for (const item of nationalChanges) if ((counts.get(item.after) || 0) > 1) uniqueConflicts.add(`${item.entity}:${item.id}:${item.field}`);
  }
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const item = changes[index];
    if (uniqueConflicts.has(`${item.entity}:${item.id}:${item.field}`)) {
      reviews.push({ ...item, reason: 'NORMALIZED_UNIQUE_VALUE_CONFLICT' });
      changes.splice(index, 1);
    }
  }
  const report = { schemaVersion: 1, scanned: { candidates: candidates.length, personnel: personnel.length, revisions: revisions.length }, changes, reviews };
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', ...report }, null, 2)}\n`);
  if (!apply) {
    if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    return;
  }
  if (!manifestPath) throw new Error('APPLY_REQUIRES_REVIEWED_MANIFEST');
  const reviewed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (JSON.stringify(reviewed) !== JSON.stringify(report)) throw new Error('NUMERIC_NORMALIZATION_MANIFEST_DRIFT');
  if (reviews.length) throw new Error('NUMERIC_NORMALIZATION_HAS_REVIEW_ITEMS');
  await prisma.$transaction(async (tx) => {
    const changedCandidateProfiles = new Set(changes.filter((change) => change.entity === 'HrCandidateProfile').map((change) => change.id));
    for (const candidate of candidates) {
      const scalarChanges = changes.filter((change) => change.entity === 'HrCandidate' && change.id === candidate.id);
      if (!scalarChanges.length && !changedCandidateProfiles.has(candidate.id)) continue;
      const data: Record<string, unknown> = Object.fromEntries(scalarChanges.map((item) => [item.field, item.after]));
      if (changedCandidateProfiles.has(candidate.id)) data.profileJson = translatedCandidateProfiles.get(candidate.id)!;
      data.updatedAt = candidate.updatedAt;
      const updated = await tx.hrCandidate.updateMany({ where: { id: candidate.id, updatedAt: candidate.updatedAt }, data });
      if (updated.count !== 1) throw new Error(`NUMERIC_NORMALIZATION_SOURCE_DRIFT:HrCandidate:${candidate.id}`);
    }
    for (const row of personnel) {
      const scalarChanges = changes.filter((change) => change.entity === 'Personnel' && change.id === row.id);
      if (!scalarChanges.length) continue;
      const data: Record<string, unknown> = Object.fromEntries(scalarChanges.map((item) => [item.field, item.after]));
      data.updatedAt = row.updatedAt;
      const updated = await tx.personnel.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data });
      if (updated.count !== 1) throw new Error(`NUMERIC_NORMALIZATION_SOURCE_DRIFT:Personnel:${row.id}`);
    }
    const changedRevisionIds = new Set(changes.filter((change) => change.entity === 'HrApplicationFormRevision').map((change) => change.id));
    for (const revision of revisions.filter((item) => changedRevisionIds.has(item.id))) {
      const updated = await tx.hrApplicationFormRevision.updateMany({ where: { id: revision.id, updatedAt: revision.updatedAt }, data: {
        dataJson: translatedRevisionJson.get(revision.id)!, updatedAt: revision.updatedAt,
      } });
      if (updated.count !== 1) throw new Error(`NUMERIC_NORMALIZATION_SOURCE_DRIFT:HrApplicationFormRevision:${revision.id}`);
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
