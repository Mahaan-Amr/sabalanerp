import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

// Focused source-client check on the selected schema. Production data and the
// immutable retained image are qualified by the protected release rehearsal.
async function run() {
  const repositoryRoot = path.resolve(process.cwd(), '..');
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  const legacyRoot = process.env.SABALAN_LEGACY_CLIENT_ROOT;
  const exactClient = process.env.SABALAN_LEGACY_GENERATED_CLIENT;
  if (!sourceDatabaseUrl || new URL(sourceDatabaseUrl).pathname !== '/sabalanerp')
    throw new Error('Use the existing sabalanerp-local source database.');
  if (!legacyRoot && !exactClient) throw new Error('Provide an exact e407 generated client or a detached b58c53c0 source worktree.');
  const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  let OldPrismaClient: any;
  let clientIdentity: string;
  if (exactClient) {
    const clientDirectory = path.dirname(exactClient);
    const nodeModules = path.resolve(clientDirectory, '..', '..');
    assert.equal(sha256(exactClient), 'b0b5f65fe1a79e8c802b01097164bfa36cac058ea1cbd14061aa799ec0740a26');
    assert.equal(sha256(path.join(nodeModules, '@prisma', 'client', 'runtime', 'library.js')),
      '9ab29d2d4f29cfc3bef4d09eb4008edc80dac07266ca81d1e21a602a8e039050');
    assert.equal(sha256(path.join(clientDirectory, 'schema.prisma')),
      '2134693dc21bacca6693dde25171e5eee4bbf7bf062e6b39948d8674e6d5c667');
    if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) throw new Error('Set the Prisma 5.22 Windows engine path.');
    ({ PrismaClient: OldPrismaClient } = createRequire(path.join(repositoryRoot, 'backend', 'package.json'))(exactClient));
    clientIdentity = 'e407 image-generated';
  } else {
    if (!legacyRoot) throw new Error('Detached b58c53c0 worktree required.');
    const legacySha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: legacyRoot, encoding: 'utf8' }).trim();
    assert.equal(legacySha, 'b58c53c0f88d2d89da3cb6a45949e6eca97e4308');
    ({ PrismaClient: OldPrismaClient } = createRequire(path.join(legacyRoot, 'backend', 'package.json'))('@prisma/client'));
    clientIdentity = 'b58 source-generated';
  }

  const database = await createTemporaryConcurrencyDatabase({
    repositoryRoot, sourceDatabaseUrl, migrateEmptySchema: true,
  });
  const old = new OldPrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  try {
    const migrations = await old.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
    assert.equal(migrations.length, 451);
    const catalog = readdirSync(path.join(repositoryRoot, 'backend', 'prisma', 'migrations'), { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.deepEqual(migrations.map(row => row.migration_name), catalog);
    for (const excluded of [
      '20261014140000_online_deployment_control',
      '20261019010000_customer_semantic_barrier',
      '20261019020000_hr_versioned_file_cleanup',
      '20261020010000_online_realtime_completion',
      '20261020093000_online_serving_epochs',
    ]) assert(!catalog.includes(excluded), `Online-only migration retained: ${excluded}`);
    const rollback = Symbol('legacy transaction rollback');
    await assert.rejects(old.$transaction(async (tx: any) => {
      const key = randomUUID();
      const actor = await tx.user.create({ data: { email: `${key}@example.invalid`, username: key,
        password: 'test-not-login', firstName: 'Legacy', lastName: 'Actor', role: 'ADMIN' } });
      const customer = await tx.crmCustomer.create({ data: { firstName: 'Legacy', lastName: 'Customer' } });
      const department = await tx.department.create({ data: { name: `legacy-${key}`, namePersian: `legacy-${key}` } });
      const contract = await tx.salesContract.create({ data: { contractNumber: `legacy-${key}`,
        title: 'Legacy contract', titlePersian: 'قرارداد قدیمی', content: 'compatibility',
        customerId: customer.id, departmentId: department.id, createdBy: actor.id,
        responsibleSellerId: actor.id, totalAmount: '24.00' } });
      const project = await tx.projectAddress.create({ data: { customerId: customer.id,
        projectName: 'Legacy project', address: 'Local QA' } });
      const loading = await tx.logisticsLoading.create({ data: { loadingNumber: `legacy-${key}`,
        customerId: customer.id, projectId: project.id, createdBy: actor.id } });
      const person = await tx.personnel.create({ data: { firstName: 'Legacy', lastName: key } });
      const attendance = await tx.attendanceRecord.create({ data: { personnelId: person.id,
        date: new Date('2026-11-02T00:00:00Z'), status: 'PRESENT' } });

      assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } })).totalAmount.toString(), '24');
      assert.equal((await tx.logisticsLoading.findUniqueOrThrow({ where: { id: loading.id } })).loadingNumber, `legacy-${key}`);
      assert.equal((await tx.attendanceRecord.findUniqueOrThrow({ where: { id: attendance.id } })).personnelId, person.id);
      assert.equal((await tx.accountingDispatchWaybill.findMany({ take: 1 })).length, 0);
      throw rollback;
    }, { timeout: 60000 }), error => error === rollback);
    assert.equal(await old.salesContract.count(), 0);
    assert.equal(await old.logisticsLoading.count(), 0);
    assert.equal(await old.attendanceRecord.count(), 0);
    console.log(`Legacy ${clientIdentity} Prisma read/write against selected 451-migration schema: PASS (${database.databaseName})`);
  } finally {
    await old.$disconnect();
    await database.cleanup();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
