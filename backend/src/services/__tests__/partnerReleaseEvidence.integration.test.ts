import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { Prisma } from '@prisma/client';
import { compileProtectedCurrentRelease, protectedCurrentReleaseNames } from '../protectedBridgeMigrations';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { mandatoryReleaseDeploymentGateNames } from '../deploymentGates';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local database required');
  }
  return url.toString();
}

test('release readiness publication is insert-only on the real schema', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()),
    sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client(), id = `deploy-partner-release-${temporary.runId}`;
  try {
    const now = new Date(), expiresAt = new Date(now.getTime() + 15 * 60_000);
    await database.deploymentOperation.create({ data: { id, releaseId: id, targetCommit: 'a'.repeat(40),
      owner: 'release-owner', phase: 'COMPLETED', leaseToken: `${id}-lease`, leaseExpiresAt: expiresAt,
      heartbeatAt: now, startedAt: now, completedAt: now, reportJson: { format: 'sabalan-deployment-report',
        version: 1, mode: 'RELEASE', deploymentId: id, releaseId: id, targetCommit: 'a'.repeat(40),
        gates: mandatoryReleaseDeploymentGateNames.map(name => ({ name, passed: true })) } } });
    await database.partnerReleaseReadinessPublication.create({ data: { id, deploymentId: id, releaseId: id,
      targetCommit: 'a'.repeat(40), schemaId: 'partner-schema-v1', checkedAt: now, expiresAt,
      packageSha256: 'b'.repeat(64), trustEnvelopeSha256: 'c'.repeat(64), trustKeyId: 'offline-2026',
      packageBytesBase64: 'e30=', trustEnvelopeBytesBase64: 'e30=',
      evidenceJson: { source: 'DATABASE_VERIFIED', evidenceId: id } } });
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe('SAVEPOINT release_evidence_update');
      await assert.rejects(tx.partnerReleaseReadinessPublication.update({ where: { id },
        data: { trustKeyId: 'forged-key' } }), /immutable|append-only/i);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT release_evidence_update');
      await tx.$executeRawUnsafe('SAVEPOINT release_evidence_delete');
      await assert.rejects(tx.partnerReleaseReadinessPublication.delete({ where: { id } }), /immutable|append-only/i);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT release_evidence_delete');
    });
    assert.equal(await database.partnerReleaseReadinessPublication.count({ where: { id } }), 1);
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});

test('restricted runtime sees only Partner publications for actual completed and fully gated deployments', async () => {
  const repositoryRoot = path.resolve(process.cwd());
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot, sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  try {
    const migrationFiles = protectedCurrentReleaseNames.map(name => [
      name, readFileSync(path.join(repositoryRoot, 'backend/prisma/migrations', name, 'migration.sql')),
    ] as const);
    const projection = compileProtectedCurrentRelease(migrationFiles).at(-1)!;
    assert.equal(projection.name, '20261117160000_partner_release_readiness_completed_projection');
    const rolledBack = new Error('Roll back Partner projection fixture');
    await assert.rejects(database.$transaction(async tx => {
      await tx.$executeRaw`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sabalan_application_runtime') THEN
          CREATE ROLE sabalan_application_runtime NOLOGIN;
        END IF;
      END $$;`;
      await tx.$executeRaw`DROP VIEW IF EXISTS public.partner_release_readiness_completed`;
      for (const statement of projection.statements) await tx.$executeRawUnsafe(statement);
      await tx.$executeRaw`GRANT SELECT ON public.partner_release_readiness_publications TO sabalan_application_runtime`;
      const now = new Date(), expiresAt = new Date(now.getTime() + 15 * 60_000);
      const commit = 'a'.repeat(40);
      const gates = mandatoryReleaseDeploymentGateNames.map(name => ({ name, passed: true, details: { private: 'private detail' } }));
      const seed = async (suffix: string, options: {
        phase?: 'GATES_PASSED'; completedAt?: null; releaseId?: string;
        report?: Record<string, Prisma.InputJsonValue>; published?: boolean;
      } = {}) => {
        const id = `projection-${temporary.runId}-${suffix}`;
        await tx.deploymentOperation.create({ data: { id, releaseId: id, targetCommit: commit,
          owner: 'release-owner', phase: options.phase ?? 'COMPLETED', leaseToken: `${id}-lease`, leaseExpiresAt: expiresAt,
          heartbeatAt: now, startedAt: now, completedAt: options.completedAt === null ? null : now,
          reportJson: { format: 'sabalan-deployment-report', version: 1, mode: 'RELEASE', deploymentId: id,
            releaseId: id, targetCommit: commit, gates, ...options.report } } });
        if (options.published !== false) await tx.partnerReleaseReadinessPublication.create({ data: {
          id, deploymentId: id, releaseId: options.releaseId ?? id, targetCommit: commit, schemaId: 'partner-schema-v1',
          checkedAt: now, expiresAt, packageSha256: 'b'.repeat(64), trustEnvelopeSha256: 'c'.repeat(64),
          trustKeyId: 'offline-2026', packageBytesBase64: 'e30=', trustEnvelopeBytesBase64: 'e30=',
          evidenceJson: { source: 'DATABASE_VERIFIED', evidenceId: id } } });
        return id;
      };
      const id = await seed('qualified');
      const differentlyOrdered = await seed('ordered-differently', { report: { gates: [...gates].reverse() } });
      await seed('unpublished', { published: false });
      await seed('unfinished', { phase: 'GATES_PASSED' });
      await seed('missing-completion-time', { completedAt: null });
      await seed('unmatched-publication', { releaseId: 'other-release' });
      await seed('unmatched-report', { report: { targetCommit: 'b'.repeat(40) } });
      await seed('wrong-mode', { report: { mode: 'ONLINE' } });
      await seed('wrong-version-type', { report: { version: '1' } });
      await seed('bad-gate-container', { report: { gates: {} } });
      await seed('missing-gate', { report: { gates: gates.slice(1) } });
      await seed('duplicate-gate', { report: { gates: [...gates.slice(1), gates[1]] } });
      await seed('failed-gate', { report: { gates: [{ ...gates[0], passed: false }, ...gates.slice(1)] } });
      await seed('wrong-pass-type', { report: { gates: [{ ...gates[0], passed: 'true' }, ...gates.slice(1)] } });
      await tx.$executeRaw`SET LOCAL ROLE sabalan_application_runtime`;
      const rows = await tx.$queryRaw`SELECT * FROM public.partner_release_readiness_completed ORDER BY id`;
      assert.deepEqual(rows, [{ id: differentlyOrdered }, { id }]);
      await tx.$executeRaw`SAVEPOINT forbidden_report`;
      await assert.rejects(tx.$queryRaw`SELECT "reportJson" FROM public.deployment_operations`, /permission denied/);
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT forbidden_report`;
      const [access] = await tx.$queryRaw<Array<{ write: boolean }>>`
        SELECT has_table_privilege('public.partner_release_readiness_completed',
          'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS write
      `;
      assert.equal(access.write, false);
      await tx.$executeRaw`SAVEPOINT forbidden_write`;
      await assert.rejects(tx.$executeRaw`DELETE FROM public.partner_release_readiness_completed`, /permission denied|cannot delete from view/);
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT forbidden_write`;
      throw rolledBack;
    }, { timeout: 30_000 }), error => error === rolledBack);
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
