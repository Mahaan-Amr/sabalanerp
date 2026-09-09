import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const groups = {
  noAccess: [],
  supervisor: ['SUBMIT_PERFORMANCE_EVALUATION'],
  reviewer: ['REVIEW_PERFORMANCE_EVALUATION'],
  lifecycleManager: ['MANAGE_PERFORMANCE_CYCLE', 'PAUSE_PERFORMANCE_EVALUATION'],
} as const;

const cleanup = async (runId: string) => {
  const users = await client.user.findMany({ where: { username: { startsWith: `${runId}-` } }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  if (!userIds.length) return;
  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const subjects = await tx.performanceSubject.findMany({ where: { stableKey: { startsWith: `${runId}:subject:` } },
      select: { id: true, personnelId: true, employmentRelationshipId: true } });
    const subjectIds = subjects.map(({ id }) => id);
    const evaluations = await tx.performanceEvaluation.findMany({ where: { subjectId: { in: subjectIds } }, select: { id: true } });
    const evaluationIds = evaluations.map(({ id }) => id);
    const sections = await tx.performanceEvaluationSection.findMany({ where: { evaluationId: { in: evaluationIds } },
      select: { employmentAssignmentId: true } });
    await tx.performanceEvaluationSection.deleteMany({ where: { evaluationId: { in: evaluationIds } } });
    await tx.performanceEvaluation.deleteMany({ where: { id: { in: evaluationIds } } });
    await tx.performanceSubject.deleteMany({ where: { id: { in: subjectIds } } });
    await tx.hrEmploymentAssignment.deleteMany({ where: { id: { in: sections.map(({ employmentAssignmentId }) => employmentAssignmentId) } } });
    await tx.hrEmploymentRelationship.deleteMany({ where: { id: { in: subjects.flatMap(({ employmentRelationshipId }) => employmentRelationshipId ? [employmentRelationshipId] : []) } } });
    await tx.personnel.deleteMany({ where: { id: { in: subjects.flatMap(({ personnelId }) => personnelId ? [personnelId] : []) } } });
    await tx.hrFeatureAccessGrant.deleteMany({ where: { userId: { in: userIds } } });
    await tx.hrWorkspaceAccessGrant.deleteMany({ where: { userId: { in: userIds } } });
    await tx.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await tx.recognizedBrowserProfile.deleteMany({ where: { userId: { in: userIds } } });
    await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
    await tx.authenticationEvent.deleteMany({ where: { OR: [
      { userId: { in: userIds } },
      { actorId: { in: userIds } },
    ] } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
};

const setup = async () => {
  const runId = `performance-browser-${randomUUID()}`;
  const password = `Acceptance-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(password, 6);
  const requiredFeatures = [...new Set(Object.values(groups).flat())];
  const [workspace, features] = await Promise.all([
    client.hrWorkspaceCatalog.findUnique({ where: { code: 'HUMAN_RESOURCES' }, select: { code: true } }),
    client.hrFeatureCatalog.findMany({ where: { code: { in: requiredFeatures } }, select: { code: true } }),
  ]);
  if (!workspace || features.length !== requiredFeatures.length) throw new Error('PERFORMANCE_BROWSER_CATALOG_UNAVAILABLE');
  const accounts: Record<string, { username: string; password: string; expectedCapabilities: readonly string[] }> = {};
  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    let lifecycleManagerId = '';
    for (const [role, expectedCapabilities] of Object.entries(groups)) {
      const username = `${runId}-${role}`;
      const user = await tx.user.create({ data: {
        username, email: `${username}@example.invalid`, password: passwordHash,
        firstName: 'پذیرش', lastName: `نقش ${role}`, role: 'USER',
      } });
      await tx.hrWorkspaceAccessGrant.create({ data: {
        stableKey: `${runId}:${role}:workspace`, userId: user.id, workspaceCode: 'HUMAN_RESOURCES',
        level: 'VIEW', effectiveFrom: new Date('2020-01-01Z'), reason: 'Synthetic browser acceptance fixture',
      } });
      if (expectedCapabilities.length) await tx.hrFeatureAccessGrant.createMany({ data: expectedCapabilities.map((featureCode) => ({
        stableKey: `${runId}:${role}:${featureCode}`, userId: user.id, featureCode,
        level: 'ADMIN' as const, effectiveFrom: new Date('2020-01-01Z'), reason: 'Synthetic browser acceptance fixture',
      })) });
      if (role === 'lifecycleManager') lifecycleManagerId = user.id;
      accounts[role] = { username, password, expectedCapabilities };
    }
    for (const [index, status] of ['DRAFT', 'REJECTED', 'SUBMITTED', 'ACCEPTED'].entries()) {
      const personnel = await tx.personnel.create({ data: { firstName: 'پذیرش', lastName: `چرخه ${status}` } });
      const relationship = await tx.hrEmploymentRelationship.create({ data: {
        personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2025-01-01Z'), createdBy: lifecycleManagerId,
      } });
      const assignment = await tx.hrEmploymentAssignment.create({ data: {
        employmentRelationshipId: relationship.id, type: 'PRIMARY', effectiveFrom: new Date('2025-01-01Z'),
        performanceAllocationPercent: 100, createdBy: lifecycleManagerId,
      } });
      const subject = await tx.performanceSubject.create({ data: {
        stableKey: `${runId}:subject:${status}`, nonDisplayKey: `${runId}:hidden:${status}`,
        personnelId: personnel.id, employmentRelationshipId: relationship.id, createdByUserId: lifecycleManagerId,
      } });
      const evaluation = await tx.performanceEvaluation.create({ data: {
        stableKey: `${runId}:evaluation:${status}`, subjectId: subject.id,
        measurementFrom: new Date(`2026-0${index + 1}-01Z`), measurementTo: new Date(`2026-0${index + 1}-20Z`),
        createdByUserId: lifecycleManagerId,
      } });
      const section = await tx.performanceEvaluationSection.create({ data: {
        evaluationId: evaluation.id, employmentAssignmentId: assignment.id,
        responsibleSupervisorPersonnelId: personnel.id, effectiveFrom: evaluation.measurementFrom,
        effectiveTo: evaluation.measurementTo, allocationPercent: 100,
      } });
      if (status !== 'DRAFT') await tx.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: 'SUBMITTED' } });
      if (status === 'REJECTED') await tx.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: 'REJECTED' } });
      if (status === 'ACCEPTED') await tx.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: 'ACCEPTED' } });
    }
  });
  console.log(`PERFORMANCE_BROWSER_FIXTURE:${JSON.stringify({ runId, accounts })}`);
};

const main = async () => {
  const [mode, flag, value] = process.argv.slice(2);
  if (mode === 'setup' && !flag) return setup();
  if (mode === 'cleanup' && flag === '--run-id' && value) return cleanup(value);
  throw new Error('Usage: performanceAcceptanceBrowserFixture.ts setup | cleanup --run-id <id>');
};

void main().finally(() => client.$disconnect()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
