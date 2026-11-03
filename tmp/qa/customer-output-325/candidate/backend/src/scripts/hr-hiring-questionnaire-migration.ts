import { Prisma, PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import {
  classifyLegacyEducation,
  classifyLegacyGraduationYear,
  currentJalaliYear,
} from '../services/hrHiringQuestionnaireMigration';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const argument = (prefix: string) => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
const reportPath = argument('--report=');
const manifestPath = argument('--manifest=');

type EducationChange = {
  field: 'educationLevel';
  before: string;
  after: string;
  educationLevelOther: string;
  legacyRaw: string;
};
type RevisionChange = EducationChange & { revisionId: string };
type CandidateChange = EducationChange & { candidateId: string };
type Review = {
  recordType: 'REVISION' | 'CANDIDATE';
  recordId: string;
  field: 'graduationYear';
  value: string;
  reason: string;
};

const main = async () => {
  const [revisions, candidates] = await Promise.all([
    prisma.hrApplicationFormRevision.findMany({ select: { id: true, dataJson: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.hrCandidate.findMany({ select: { id: true, profileJson: true, updatedAt: true }, orderBy: { id: 'asc' } }),
  ]);
  const currentYear = currentJalaliYear();
  const changes: RevisionChange[] = [];
  const reviews: Review[] = [];
  const candidateChanges: CandidateChange[] = [];
  for (const revision of revisions) {
    const data = revision.dataJson && typeof revision.dataJson === 'object' && !Array.isArray(revision.dataJson)
      ? revision.dataJson as Record<string, unknown>
      : {};
    const education = classifyLegacyEducation(data.educationLevel);
    if (education.kind === 'CHANGE') changes.push({
      revisionId: revision.id,
      field: 'educationLevel',
      before: String(data.educationLevel ?? ''),
      after: education.educationLevel,
      educationLevelOther: education.educationLevelOther,
      legacyRaw: education.legacyRaw,
    });
    const year = classifyLegacyGraduationYear(data.graduationYear, currentYear);
    if (year.kind === 'REVIEW') reviews.push({
      recordType: 'REVISION', recordId: revision.id,
      field: 'graduationYear',
      value: year.raw,
      reason: year.reason,
    });
  }
  for (const candidate of candidates) {
    const data = candidate.profileJson && typeof candidate.profileJson === 'object' && !Array.isArray(candidate.profileJson)
      ? candidate.profileJson as Record<string, unknown> : {};
    const education = classifyLegacyEducation(data.educationLevel);
    if (education.kind === 'CHANGE') candidateChanges.push({
      candidateId: candidate.id,
      field: 'educationLevel', before: String(data.educationLevel ?? ''), after: education.educationLevel,
      educationLevelOther: education.educationLevelOther, legacyRaw: education.legacyRaw,
    });
    const year = classifyLegacyGraduationYear(data.graduationYear, currentYear);
    if (year.kind === 'REVIEW') reviews.push({
      recordType: 'CANDIDATE', recordId: candidate.id, field: 'graduationYear', value: year.raw, reason: year.reason,
    });
  }
  const report = {
    schemaVersion: 2,
    currentJalaliYear: currentYear,
    scanned: { revisions: revisions.length, candidates: candidates.length },
    changes,
    candidateChanges,
    reviews,
  };
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', ...report }, null, 2)}\n`);
  if (!apply) {
    if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    return;
  }
  if (!manifestPath) throw new Error('APPLY_REQUIRES_REVIEWED_MANIFEST');
  const reviewed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (JSON.stringify(reviewed) !== JSON.stringify(report)) throw new Error('QUESTIONNAIRE_MIGRATION_MANIFEST_DRIFT');
  // Reviewed ambiguous years remain untouched; the exact manifest authorizes only deterministic education changes.
  const changeById = new Map(changes.map((item) => [item.revisionId, item]));
  const candidateChangeById = new Map(candidateChanges.map((item) => [item.candidateId, item]));
  await prisma.$transaction(async (tx) => {
    for (const revision of revisions) {
      const change = changeById.get(revision.id);
      if (!change) continue;
      const before = revision.dataJson as Record<string, unknown>;
      const dataJson: Prisma.InputJsonValue = {
        ...before,
        educationLevel: change.after,
        educationLevelOther: change.educationLevelOther,
        educationLevelLegacyRaw: change.legacyRaw,
      } as Prisma.InputJsonValue;
      const updated = await tx.hrApplicationFormRevision.updateMany({
        where: { id: revision.id, updatedAt: revision.updatedAt },
        data: { dataJson, updatedAt: revision.updatedAt },
      });
      if (updated.count !== 1) throw new Error(`QUESTIONNAIRE_MIGRATION_SOURCE_DRIFT:${revision.id}`);
    }
    for (const candidate of candidates) {
      const change = candidateChangeById.get(candidate.id);
      if (!change) continue;
      const before = candidate.profileJson as Record<string, unknown>;
      const profileJson: Prisma.InputJsonValue = {
        ...before, educationLevel: change.after, educationLevelOther: change.educationLevelOther,
        educationLevelLegacyRaw: change.legacyRaw,
      } as Prisma.InputJsonValue;
      const updated = await tx.hrCandidate.updateMany({
        where: { id: candidate.id, updatedAt: candidate.updatedAt }, data: { profileJson, updatedAt: candidate.updatedAt },
      });
      if (updated.count !== 1) throw new Error(`QUESTIONNAIRE_MIGRATION_SOURCE_DRIFT:${candidate.id}`);
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
