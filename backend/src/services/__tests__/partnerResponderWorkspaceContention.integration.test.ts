import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { readAuthorizationDecisionByCorrelation } from '../effectiveAuthorization/audit';
import { createPrismaPartnerWorkspaceQuery } from '../partnerSales/workspaces/prisma';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';

test('responder list remains available while a concurrent transaction holds a candidate profile lock', async () => {
  const sourceDatabaseUrl = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;
  if (!sourceDatabaseUrl) throw new Error('Existing local database URL required');
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl });
  const database = temporary.client();
  let profileLocked!: () => void;
  let releaseProfile!: () => void;
  const locked = new Promise<void>(resolve => { profileLocked = resolve; });
  const release = new Promise<void>(resolve => { releaseProfile = resolve; });
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    for (const id of ['manager', 'partner']) {
      await database.user.create({ data: { id, username: id, email: `${id}@example.invalid`,
        password: 'not-a-login', firstName: id, lastName: 'Fixture', role: id === 'manager' ? 'ADMIN' : 'USER' } });
    }
    await database.partnerProfile.create({ data: { id: 'profile', userId: 'partner', state: 'ACTIVE' } });
    await database.partnerReleaseCohort.create({ data: { id: 'cohort', name: 'responder fixture', activationEnabled: true } });
    await database.partnerOperationsControl.create({ data: { id: 'partner-operations', cohortId: 'cohort' } });
    await database.partnerCohortMembership.create({ data: {
      profileId: 'profile', cohortId: 'cohort', actorId: 'manager', eligibilityEvidence: {},
    } });
    await database.partnerInquiry.create({ data: { id: 'inquiry', profileId: 'profile',
      assignments: { create: { revision: 1, responderId: 'manager', actorId: 'manager', reason: 'fixture', eligibilityEvidence: {} } },
      rows: { create: { id: 'row', version: 1, configurationHash: 'sha256-v1:' + 'a'.repeat(64), definition: {} } },
    } });

    const writer = database.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${'profile'} FOR UPDATE`;
      profileLocked();
      await release;
      await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${'inquiry'} FOR UPDATE`;
    }, { timeout: 15_000 });
    let pending: Promise<unknown> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([locked, writer]);
      const correlationId = 'responder-concurrent-profile-lock';
      const workspace = createPrismaPartnerWorkspaceQuery({ database, actorId: 'manager', correlationId });
      const response = workspace.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view: 'all', status: 'all' });
      pending = response;
      const result = await Promise.race([response, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('Responder list waited for the profile writer')), 3_000);
      })]);
      assert.ok(result.ok, JSON.stringify(result));
      assert.deepEqual(result.value.contracts?.map(contract => contract.id), ['inquiry']);
      assert.equal(result.value.contractCounts?.pending, 1);
      const evidence = await database.$transaction(tx => readAuthorizationDecisionByCorrelation(tx, {
        domain: 'PARTNER', actorId: 'manager', action: 'INQUIRY_READ', rootKind: 'INQUIRY', rootId: 'inquiry',
        purpose: 'RESPONDER', channel: 'API', correlationId, allowed: true,
      }));
      assert.equal(evidence?.authorizationRevision, 1);
      assert.equal(evidence?.assignmentRevision, 1);
    } finally {
      clearTimeout(deadline);
      releaseProfile();
      await Promise.allSettled([writer, pending]);
    }
    await writer;
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
