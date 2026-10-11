import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { createPartnerTechnicalCatalogReader } from '../partnerSales/crm/technicalCatalogReader';
import { createAuditedPartnerAuthorization } from '../partnerSales/authorization/audited';
import { readPartnerSnapshot } from '../partnerSales/authorization/readSnapshot';

const signal = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test('catalog and multi-profile Accounting authority complete without circular lock waits', async () => {
  const sourceDatabaseUrl = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;
  if (!sourceDatabaseUrl) throw new Error('Existing local database URL required');
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl });
  const database = temporary.client();
  const catalogProfileLocked = signal(), releaseCatalog = signal(), firstAuthorityRead = signal();
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    for (const id of ['admin', 'owner-a', 'owner-b']) await database.user.create({ data: {
      id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: id,
      lastName: 'Fixture', role: id === 'admin' ? 'ADMIN' : 'USER' } });
    for (const id of ['a', 'b']) await database.partnerProfile.create({ data: { id, userId: `owner-${id}`, state: 'ACTIVE' } });
    await database.partnerReleaseCohort.create({ data: { id: 'cohort', name: 'contention fixture', activationEnabled: true } });
    await database.partnerOperationsControl.create({ data: { id: 'partner-operations', cohortId: 'cohort' } });
    await database.partnerCohortMembership.create({ data: { profileId: 'b', cohortId: 'cohort', actorId: 'admin', eligibilityEvidence: {} } });
    const catalog = database.$transaction(async tx => {
      const probed = new Proxy(tx, { get(target, property, receiver) {
        if (property !== '$queryRaw') return Reflect.get(target, property, receiver);
        return async (...args: unknown[]) => {
          const sql = Array.isArray(args[0]) ? args[0].join('') : String(args[0]);
          const value = await Reflect.apply(target.$queryRaw, target, args);
          if (sql.includes('partner_profiles') && sql.includes('FOR UPDATE')) {
            catalogProfileLocked.resolve(); await releaseCatalog.promise;
          }
          return value;
        };
      } });
      return createPartnerTechnicalCatalogReader(probed, { actorId: 'owner-b', correlationId: 'catalog-contention' })
        .read({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: 'PRODUCT' });
    }, { timeout: 5000 });
    // Attach a rejection handler before starting the competing transaction.
    const catalogOutcome = catalog.then(value => ({ value }), error => ({ error }));
    await catalogProfileLocked.promise;
    let accountingAttempts = 0;
    const accounting = readPartnerSnapshot(database, async tx => {
      accountingAttempts += 1;
      const authority = createAuditedPartnerAuthorization(tx, { actorId: 'admin', purpose: 'ONBOARDING', channel: 'LIST' },
        { correlationId: 'accounting-contention' });
      assert.equal((await authority.authorize('PROFILE_READ', { kind: 'PROFILE', id: 'a' })).ok, true);
      firstAuthorityRead.resolve();
      assert.equal((await authority.authorize('PROFILE_READ', { kind: 'PROFILE', id: 'b' })).ok, true);
    }, { multiRootAuthority: true });
    const accountingOutcome = accounting.then(() => ({}), error => ({ error }));
    // Before the fix, Accounting can hold central authority while catalog owns
    // profile B. After the fix it waits at operations control, before any root.
    await Promise.race([firstAuthorityRead.promise, new Promise(resolve => setTimeout(resolve, 300))]);
    releaseCatalog.resolve();
    const [catalogResult, accountingResult] = await Promise.all([catalogOutcome, accountingOutcome]);
    assert.equal('error' in catalogResult, false, 'catalog must not deadlock/expire against a multi-profile read');
    assert.equal('error' in accountingResult, false, `Accounting read must complete: ${'error' in accountingResult ? String(accountingResult.error) : ''}`);
    assert.equal(accountingAttempts, 1, 'no deadlock retry should be needed for concurrent catalog and multi-profile reads');
    assert.ok('value' in catalogResult && catalogResult.value.ok);
  } finally { releaseCatalog.resolve(); await database.$disconnect(); await temporary.cleanup(); }
});
