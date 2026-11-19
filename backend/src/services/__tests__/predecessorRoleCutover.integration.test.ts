import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { mandatoryReleaseDeploymentGateNames } from '../deploymentGates';
import { verifyPredecessorRoleCutover } from '../protectedDatabaseRoleRecovery';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

const source = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
const repositoryRoot = path.resolve(process.cwd(), '..');
const quote = (value: string) => '"' + value.replace(/"/g, '""') + '"';

test('first split preflight requires the exact catalog and per-object grants', {
  skip: !source,
  timeout: 240_000,
}, async () => {
  const fixture = await createTemporaryConcurrencyDatabase({
    repositoryRoot, sourceDatabaseUrl: source!, migrateEmptySchema: true,
  });
  const database = fixture.client();
  const catalogFile = path.join(repositoryRoot, 'backend/scripts/predecessor-role-catalog.json');
  const bind = {
    databaseUrl: fixture.databaseUrl,
    migrationsDirectory: path.join(repositoryRoot, 'backend/prisma/migrations'),
    catalogFile,
  };
  const before = () => verifyPredecessorRoleCutover({ ...bind, stage: 'before-grants' });
  const staged = () => verifyPredecessorRoleCutover({ ...bind, stage: 'grants-staged' });
  try {
    const baseline = await before();
    assert.deepEqual(baseline, {
      stage: 'before-grants',
      catalogSha256: '1500b28bbde6809652bcae34eb8f421b67528f266c9c31660af66c11f230e375',
      migrationSha256: '29112f7b85061e1bbb96995b7877212ec4a1d076690d6b7f789afde5434cd903',
      migrations: 488, tables: 571, views: 1, sequences: 5, securityDefinerRoutines: 7,
    });
    await assert.rejects(staged(), /Cutover privilege drift/);

    await database.$executeRaw`CREATE TABLE public.unreviewed_role_cutover_probe (id integer)`;
    await assert.rejects(before(), /Unexpected cutover table/);
    await database.$executeRaw`DROP TABLE public.unreviewed_role_cutover_probe`;

    await database.$executeRaw`ALTER VIEW public.partner_release_readiness_completed SET (security_barrier = false)`;
    await assert.rejects(before(), /view differs from the reviewed cutover inventory/);
    await database.$executeRaw`ALTER VIEW public.partner_release_readiness_completed SET (security_barrier = true)`;

    await database.$executeRaw`REVOKE SELECT ON public.partner_release_readiness_completed FROM sabalan_application_runtime`;
    await assert.rejects(before(), /Cutover privilege drift on TABLE partner_release_readiness_completed/);
    await database.$executeRaw`GRANT SELECT ON public.partner_release_readiness_completed TO sabalan_application_runtime`;

    await database.$executeRaw`CREATE FUNCTION public.unreviewed_role_cutover_probe() RETURNS integer
      LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`;
    await assert.rejects(before(), /privileged routine differs/);
    await database.$executeRaw`DROP FUNCTION public.unreviewed_role_cutover_probe()`;

    await database.$executeRaw`UPDATE public._prisma_migrations SET checksum = repeat('0', 64)
      WHERE migration_name = '20261117150000_customer_allocation_runtime_admission'`;
    await assert.rejects(before(), /live migration ledger differs/);
    const checksum = createHash('sha256').update(await readFile(path.join(bind.migrationsDirectory,
      '20261117150000_customer_allocation_runtime_admission/migration.sql'))).digest('hex');
    await database.$executeRaw`UPDATE public._prisma_migrations SET checksum = ${checksum}
      WHERE migration_name = '20261117150000_customer_allocation_runtime_admission'`;

    await database.$executeRaw`ALTER TABLE public.simple_performance_profiles DISABLE TRIGGER restrict_runtime_reference_update`;
    await assert.rejects(before(), /cutover write-guard trigger differs/);
    await database.$executeRaw`ALTER TABLE public.simple_performance_profiles ENABLE TRIGGER restrict_runtime_reference_update`;

    const [referenceGuard] = await database.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_functiondef('public.protect_runtime_reference_row()'::regprocedure) AS definition
    `;
    await database.$executeRaw`CREATE OR REPLACE FUNCTION public.protect_runtime_reference_row() RETURNS trigger
      LANGUAGE plpgsql AS $guard$ BEGIN RETURN NEW; END $guard$`;
    await assert.rejects(before(), /cutover write-guard routine differs/);
    await database.$executeRawUnsafe(referenceGuard.definition);

    // This fixture stages the intended grants only on its disposable database.
    const manifest = JSON.parse(await readFile(catalogFile, 'utf8')) as {
      tables: Record<string, string[]>;
      sequences: string[];
    };
    const roles = 'sabalan_application_runtime, sabalan_allocation_controller';
    const db = quote(fixture.databaseName);
    await database.$executeRawUnsafe(`REVOKE CONNECT, TEMPORARY ON DATABASE ${db} FROM PUBLIC`);
    await database.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${db} TO ${roles}`);
    await database.$executeRaw`REVOKE USAGE ON SCHEMA public FROM PUBLIC`;
    await database.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${roles}`);
    for (const [profile, names] of Object.entries(manifest.tables)) {
      if (profile !== 'NONE') {
        const tables = names.map(name => 'public.' + quote(name)).join(', ');
        await database.$executeRawUnsafe(`GRANT ${profile.replace(/ /g, ', ')} ON TABLE ${tables} TO sabalan_application_runtime`);
      }
    }
    const sequences = manifest.sequences.map(name => 'public.' + quote(name)).join(', ');
    await database.$executeRawUnsafe(`GRANT USAGE ON SEQUENCE ${sequences} TO sabalan_application_runtime`);
    assert.deepEqual(await staged(), { ...baseline, stage: 'grants-staged' });

    await database.simplePerformanceProfile.create({ data: {
      id: 'role-lock-probe', stableKey: 'role-lock-probe', nameFa: 'QA role probe', version: 1, createdByUserId: 'fixture',
    } });

    await database.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL ROLE sabalan_application_runtime`;
      const referenceRelations = [
        'external_driver_documents', 'external_vehicle_documents', 'partner_commercial_accounts',
        'partner_commercial_numbers', 'partner_duplicate_customer_matches', 'partner_identity_evidence',
        'partner_terms_policies', 'simple_performance_profiles',
      ];
      for (const table of referenceRelations) {
        await tx.$queryRawUnsafe(`SELECT 1 FROM public.${quote(table)} WHERE false FOR SHARE`);
      }
      assert.equal((await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM public.simple_performance_profiles WHERE id = 'role-lock-probe' FOR UPDATE
      `)[0].id, 'role-lock-probe');
      await tx.$queryRaw`SELECT revision FROM public.performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
      assert.deepEqual(await tx.$queryRaw`
        SELECT has_function_privilege(current_user, 'public.partner_reserve_number()', 'EXECUTE') AS reserve,
          has_function_privilege(current_user, 'public.performance_guard_canonical_write()', 'EXECUTE') AS disclosure
      `, [{ reserve: false, disclosure: false }]);
    });
    await assert.rejects(database.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL ROLE sabalan_application_runtime`;
      await tx.simplePerformanceProfile.update({ where: { id: 'role-lock-probe' }, data: { nameFa: 'no write' } });
    }), /Restricted runtime may lock this reference but may not update it/);

    const targetCommit = 'a'.repeat(40);
    const now = new Date();
    for (const phase of ['COMPLETED', 'TRAFFIC_OPENED']) {
      const id = `projection-${phase}`;
      await database.deploymentOperation.create({ data: { id, releaseId: id, targetCommit, owner: 'fixture', phase,
        leaseToken: id, leaseExpiresAt: now, heartbeatAt: now, startedAt: now, completedAt: now,
        reportJson: { format: 'sabalan-deployment-report', version: 1, mode: 'RELEASE', deploymentId: id, releaseId: id,
          targetCommit, gates: mandatoryReleaseDeploymentGateNames.map(name => ({ name, passed: true })) } } });
      await database.partnerReleaseReadinessPublication.create({ data: { id, deploymentId: id, releaseId: id, targetCommit,
        schemaId: 'fixture', checkedAt: now, expiresAt: new Date(now.getTime() + 60_000), packageSha256: 'b'.repeat(64), trustEnvelopeSha256: 'c'.repeat(64),
        trustKeyId: 'fixture', packageBytesBase64: 'e30=', trustEnvelopeBytesBase64: 'e30=', evidenceJson: {} } });
    }

    await database.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL ROLE sabalan_application_runtime`;
      assert.deepEqual(await tx.$queryRaw`SELECT * FROM public.partner_release_readiness_completed`,
        [{ id: 'projection-COMPLETED' }]);
      const operation = await tx.recoveryOperation.create({ data: { packageType: 'DATA_ONLY', source: 'GENERATED', status: 'PENDING' } });
      await tx.recoveryOperation.update({ where: { id: operation.id }, data: { progress: 1 } });
      await tx.recoveryAuditEvent.create({ data: { operationId: operation.id, eventType: 'ROLE_CUTOVER_PROBE' } });
      assert.equal(await tx.recoveryAuditEvent.count({ where: { operationId: operation.id } }), 1);
    });
    await assert.rejects(database.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL ROLE sabalan_application_runtime`;
      await tx.$queryRaw`SELECT id FROM public.deployment_operations LIMIT 1`;
    }), /42501/);
    await assert.rejects(database.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL ROLE sabalan_application_runtime`;
      await tx.$queryRaw`SELECT public.customer_allocation_controller_close('a', 'b', 'c', 'd')`;
    }), /42501/);

    await assert.rejects(database.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL ROLE sabalan_allocation_controller`;
      await tx.$queryRaw`SELECT id FROM public.partner_release_readiness_completed`;
    }), /42501/);

    await database.$executeRaw`REVOKE UPDATE ON public.recovery_operations FROM sabalan_application_runtime`;
    await assert.rejects(staged(), /Cutover privilege drift on TABLE recovery_operations/);
    await database.$executeRaw`GRANT UPDATE ON public.recovery_operations TO sabalan_application_runtime`;
    await database.$executeRaw`GRANT DELETE ON public.recovery_audit_events TO sabalan_application_runtime`;
    await assert.rejects(staged(), /Cutover privilege drift on TABLE recovery_audit_events/);
    await database.$executeRaw`REVOKE DELETE ON public.recovery_audit_events FROM sabalan_application_runtime`;
    await database.$executeRaw`GRANT SELECT (id) ON public.deployment_operations TO PUBLIC`;
    await assert.rejects(staged(), /ACL objects outside the supported role contract/);
    await database.$executeRaw`REVOKE SELECT (id) ON public.deployment_operations FROM PUBLIC`;
    await database.$executeRaw`GRANT SELECT ON public.deployment_operations TO PUBLIC`;
    await assert.rejects(staged(), /Cutover privilege drift on TABLE deployment_operations/);
  } finally {
    await database.$disconnect();
    await fixture.cleanup();
  }
});
