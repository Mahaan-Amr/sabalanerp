import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  activateShipmentStatementCutover,
  buildCutoverManifest,
  readAndVerifyCutoverManifest,
  writeImmutableCutoverManifest,
  type CutoverEvidence,
} from '../src/services/shipmentStatementCutover';
import { PrismaShipmentStatementCutoverRepository } from '../src/services/shipmentStatementCutover/prismaRepository';

const usage = 'Usage: shipment-statement-cutover.ts manifest --evidence <json> --out <json> | activate --manifest <json> --receipt <json>';
const args = process.argv.slice(2);
const command = args.shift();
const option = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const requiredOption = (name: string) => {
  const value = option(name)?.trim();
  if (!value) throw new Error(`${name} is required. ${usage}`);
  return resolve(value);
};
const requiredEnvironment = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const signingKey = requiredEnvironment('SHIPMENT_STATEMENT_CUTOVER_SIGNING_KEY');
const prisma = new PrismaClient();
const repository = new PrismaShipmentStatementCutoverRepository(prisma);

const writeReceipt = async (destination: string, receipt: Record<string, unknown>) => {
  const directory = dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(destination)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Cutover receipt already exists: ${destination}`);
    throw error;
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
};

const run = async () => {
  if (command === 'manifest') {
    const evidence = JSON.parse(await readFile(requiredOption('--evidence'), 'utf8')) as CutoverEvidence;
    const state = await repository.loadState();
    evidence.deployment.databaseGateEnabled = state.enabled;
    evidence.deployment.environmentGateEnabled = process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED === 'true';
    const migration = await prisma.shipmentStatementMigrationManifest.findUnique({
      where: { migrationName: '20260809000100_shipment_statement_data_contracts' },
      include: { runs: { orderBy: { runNumber: 'desc' }, take: 2, include: { evidence: true } } },
    });
    if (!migration) throw new Error('The immutable shipment-statement migration manifest is missing.');
    evidence.deployment.migrationRuns = migration.runs.map(run => ({ runNumber: run.runNumber, status: run.status,
      preservationScopes: run.evidence.length, mismatches: run.evidence.filter(item => item.outcome !== 'MATCHED').length }));
    const latest = migration.runs[0];
    if (latest) evidence.preservation = latest.evidence.map(item => ({ scope: item.scope,
      beforeCount: item.beforeRecordCount.toString(), afterCount: item.afterRecordCount.toString(),
      beforeIdentityHash: item.beforeIdentityHash, afterIdentityHash: item.afterIdentityHash,
      beforeQuantityScale3: item.beforeQuantityTotal?.toFixed(3) ?? null,
      afterQuantityScale3: item.afterQuantityTotal?.toFixed(3) ?? null,
      beforeAmountScale12: item.beforeAmountTotal?.toFixed(12) ?? null,
      afterAmountScale12: item.afterAmountTotal?.toFixed(12) ?? null,
      beforeEvidenceHash: item.beforeEvidenceHash, afterEvidenceHash: item.afterEvidenceHash }));
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const manifest = buildCutoverManifest({ releaseId: requiredEnvironment('SHIPMENT_STATEMENT_RELEASE_ID'),
      migrationManifestId: migration.id, createdAt: new Date().toISOString(),
      createdBy: requiredEnvironment('SHIPMENT_STATEMENT_CUTOVER_ACTOR_ID'), sourceCommit, evidence,
      keyId: requiredEnvironment('SHIPMENT_STATEMENT_CUTOVER_KEY_ID'), signingKey });
    await writeImmutableCutoverManifest(requiredOption('--out'), manifest);
    console.log(JSON.stringify({ decision: manifest.decision, failures: manifest.failures, integrityHash: manifest.integrityHash }));
    if (manifest.decision === 'NO_GO') process.exitCode = 2;
    return;
  }
  if (command === 'activate') {
    const source = requiredOption('--manifest');
    const manifest = await readAndVerifyCutoverManifest(source, signingKey);
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (sourceCommit !== manifest.sourceCommit) throw new Error('The signed cutover manifest belongs to a different source commit.');
    const currentMigration = await prisma.shipmentStatementMigrationManifest.findUnique({ where: { id: manifest.migrationManifestId },
      include: { runs: { orderBy: { runNumber: 'desc' }, take: 2, include: { evidence: true } } } });
    if (!currentMigration) throw new Error('The signed migration manifest no longer exists.');
    const currentRuns = currentMigration.runs.map(run => ({ runNumber: run.runNumber, status: run.status,
      preservationScopes: run.evidence.length, mismatches: run.evidence.filter(item => item.outcome !== 'MATCHED').length }));
    if (JSON.stringify(currentRuns) !== JSON.stringify(manifest.evidence.deployment.migrationRuns)) {
      throw new Error('Migration evidence changed after the cutover manifest was signed; rerun the gates.');
    }
    const activatedBy = requiredEnvironment('SHIPMENT_STATEMENT_CUTOVER_ACTOR_ID');
    const result = await activateShipmentStatementCutover({ repository, manifest, activatedBy, signingKey, environment: process.env });
    if (!result.cutoverAt) throw new Error('Cutover activation returned no compatibility boundary.');
    const receiptCore = { schemaVersion: 1, releaseId: manifest.releaseId, manifestIntegrityHash: manifest.integrityHash,
      migrationManifestId: manifest.migrationManifestId, cutoverAt: result.cutoverAt.toISOString(),
      activatedAt: result.activatedAt.toISOString(), activatedBy };
    const receiptIntegrityHash = createHash('sha256').update(JSON.stringify(receiptCore)).digest('hex');
    const receipt = { ...receiptCore, receiptIntegrityHash, signature: { algorithm: 'HMAC-SHA256',
      keyId: manifest.signature.keyId, value: createHmac('sha256', signingKey).update(receiptIntegrityHash).digest('hex') } };
    await writeReceipt(requiredOption('--receipt'), receipt);
    console.log(JSON.stringify(receipt));
    return;
  }
  throw new Error(usage);
};

run().finally(() => prisma.$disconnect());
