import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { provisionLocalPartnerQa } from '../../scripts/provision-partner-local-qa';
import { createPrismaPartnerActivationPackage } from '../partnerSales/activationPackage/prisma';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local database required');
  }
  return url.toString();
}

test('local provisioning fills every activation selector through the real query', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()),
    sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    await database.partnerOperationsControl.create({ data: { id: 'partner-operations', revision: 1,
      enrollmentPaused: true, operationalPaused: true } });
    await database.user.createMany({ data: [
      { id: 'local-admin', username: 'local-admin', email: 'local-admin@example.invalid', password: 'disabled',
        firstName: 'مدیر', lastName: 'محلی', role: 'ADMIN' },
      { id: 'local-fariba', username: 'pourshahid', email: 'fariba@example.invalid', password: 'disabled',
        firstName: 'فریبا', lastName: 'پورشهید', role: 'SALES' },
      { id: 'local-yaghoobi', username: 'yaghoobi', email: 'yaghoobi@example.invalid', password: 'disabled',
        firstName: 'محمد', lastName: 'یعقوبی', role: 'SALES' },
      ...Array.from({ length: 110 }, (_, index) => ({ id: `aaa-filler-${String(index).padStart(3, '0')}`,
        username: `filler-${index}`, email: `filler-${index}@example.invalid`, password: 'disabled',
        firstName: 'کاربر', lastName: `آزمایشی ${index}`, role: 'USER' as const })),
    ] });
    await provisionLocalPartnerQa(database, { subjectUsername: 'pourshahid', responderUsername: 'yaghoobi',
      releaseId: 'local-partner-qa', schemaId: 'partner-schema-v1' });
    const service = createPrismaPartnerActivationPackage({ database, actorId: 'local-admin',
      runtimeIdentity: { releaseId: 'local-partner-qa', schemaId: 'partner-schema-v1' },
      resolveVerifiedReadiness: async () => null,
      authorize: async () => ({ ok: true, value: { evidenceId: 'test-read', isAdmin: true } }),
    });
    const initial = await service.query({ schemaVersion: 3, purpose: 'PARTNER_ACTIVATION' });
    assert.equal(initial.ok, true);
    if (!initial.ok) return;
    assert.equal(initial.value.candidates.some(item => item.userId === 'local-fariba'), true);
    const selected = await service.query({ schemaVersion: 3, purpose: 'PARTNER_ACTIVATION', userId: 'local-fariba' });
    assert.equal(selected.ok, true);
    if (!selected.ok) return;
    assert.equal(selected.value.release.status, 'READY');
    assert.equal(selected.value.identityEvidence.length, 1);
    assert.equal(selected.value.commercialTerms.length, 1);
    assert.equal(selected.value.creditTerms.length, 1);
    assert.deepEqual(selected.value.responders.map(item => item.label), ['محمد یعقوبی']);
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
