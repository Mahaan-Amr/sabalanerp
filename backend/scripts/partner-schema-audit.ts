/** #315, partner-schema/v1. Read-only inventory; never infers historical Partner meaning.
 * Local: node backend/node_modules/tsx/dist/cli.mjs backend/scripts/partner-schema-audit.ts --local
 * Other environments: supply DATABASE_URL to an explicitly read-only audit identity.
 * Production migration/deployment remains subject to ADR-0039, not this command.
 */
import type { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function localDatabaseUrl(): string {
  if (process.env.NODE_ENV === 'production' || ['DATABASE_URL', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'COMPOSE_FILE']
    .some(key => process.env[key]) || (process.env.COMPOSE_PROJECT_NAME && process.env.COMPOSE_PROJECT_NAME !== 'sabalanerp-local')) {
    throw new Error('Local schema audit refuses an inherited database or Docker target.');
  }
  const output = execFileSync('docker', ['compose', '-f', 'docker-compose.local.yml', 'ps', '--format', 'json'], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', windowsHide: true, timeout: 30_000,
  }).trim();
  const services = output.startsWith('[') ? JSON.parse(output) : output.split(/\r?\n/).map(line => JSON.parse(line));
  const postgres = services.find((service: any) => service.Service === 'postgres');
  if (postgres?.Project !== 'sabalanerp-local' || postgres.State !== 'running' || postgres.Health !== 'healthy'
    || !postgres.Publishers?.some((port: any) => port.URL === '127.0.0.1' && port.PublishedPort === 55432)) {
    throw new Error('Expected healthy sabalanerp-local PostgreSQL on its fixed loopback port.');
  }
  // The preceding Compose check also precedes this Docker inspection.
  const context = JSON.parse(execFileSync('docker', ['context', 'inspect'], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
  }));
  const endpoint = context[0]?.Endpoints?.docker?.Host || '';
  if (!endpoint.startsWith('npipe://') && !endpoint.startsWith('unix://')) throw new Error('Remote Docker contexts are not a local QA target.');
  return `postgresql://postgres:${encodeURIComponent(process.env.LOCAL_POSTGRES_PASSWORD || 'sabalanerp-local-only')}@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10&application_name=partner-schema-audit`;
}

export async function audit(prisma: PrismaClient) {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
    const tables = await tx.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables
      WHERE schemaname = 'public' ORDER BY tablename`;
    const legacy: Record<string, { count: number; hash: string }> = {};
    const partner: Record<string, number> = {};
    for (const { name } of tables) {
      // Only trusted catalog identifiers; the report contains no row contents or PII.
      const table = '"' + name.replace(/"/g, '""') + '"';
      if (name.startsWith('partner_') || name === 'sabalan_to_partner_sale_records') {
        const [row] = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM ${table}`);
        partner[name] = Number(row.count);
      } else if (/^(sales_contract|contract_|deliver|payment|accounting_|crm_customer)/.test(name)) {
        const projection = name === 'sales_contracts'
          ? "to_jsonb(t) - ARRAY['partnerCaseId','partnerKind','partnerRevision','partnerIntegrityHash']" : 'to_jsonb(t)';
        const [row] = await tx.$queryRawUnsafe<Array<{ count: bigint; hash: string }>>(`SELECT count(*) AS count,
          md5(coalesce(string_agg(fingerprint, '' ORDER BY fingerprint), '')) AS hash
          FROM (SELECT md5((${projection})::text) AS fingerprint FROM ${table} t) rows`);
        legacy[name] = { count: Number(row.count), hash: `md5-rowset-v1:${row.hash}` };
      }
    }
    const migrations = await tx.$queryRaw<Array<{ migration_name: string; checksum: string }>>`
      SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL ORDER BY migration_name`;
    const constraints = await tx.$queryRaw<Array<{ name: string; deferred: boolean; validated: boolean }>>`
      SELECT conname AS name, condeferrable AS deferred, convalidated AS validated FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace AND conname LIKE 'partner_%' ORDER BY conname`;
    const activationOpen = tables.some(t => t.name === 'partner_release_cohorts')
      ? (await tx.$queryRawUnsafe<Array<{ open: boolean }>>('SELECT EXISTS (SELECT 1 FROM partner_release_cohorts WHERE "activationEnabled") AS open'))[0].open
      : false;
    const triggers = await tx.$queryRaw<Array<{ table: string; name: string; enabled: string }>>`
      SELECT c.relname AS table, t.tgname AS name, t.tgenabled::text AS enabled
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgname LIKE 'partner_%'
      ORDER BY c.relname, t.tgname`;
    const pairViolations = tables.some(t => t.name === 'partner_sale_cases')
      ? Number((await tx.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM partner_sale_cases c
        LEFT JOIN sabalan_to_partner_sale_records i ON i.id = c."internalRecordId"
        LEFT JOIN sales_contracts s ON s.id = c."customerContractId"
        LEFT JOIN partner_case_revisions r ON r."caseId"=c.id AND r.revision=c."headRevision"
        WHERE i.id IS NULL OR s.id IS NULL OR r."caseId" IS NULL OR i."caseId" <> c.id
          OR s."partnerCaseId" IS DISTINCT FROM c.id OR s."partnerKind" IS DISTINCT FROM 'PARTNER_CUSTOMER'
          OR i."expectedRevision" <> c."headRevision" OR s."partnerRevision" IS DISTINCT FROM c."headRevision"
          OR i."integrityHash" <> c."integrityHash" OR s."partnerIntegrityHash" IS DISTINCT FROM c."integrityHash"
          OR r."integrityHash" <> c."integrityHash"`))[0].count) : null;
    return { interfaceVersion: 'partner-schema/v1', legacy, partner, migrations, constraints, triggers, pairViolations, activationOpen };
  }, { isolationLevel: 'RepeatableRead', timeout: 60_000 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--local' && arg !== '--dry-run')) throw new Error('Only read-only audit options are supported.');
  const datasourceUrl = args.includes('--local') ? localDatabaseUrl() : process.env.DATABASE_URL;
  if (!datasourceUrl) throw new Error('Explicit DATABASE_URL or --local required.');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl, log: [] });
  try { console.log(JSON.stringify(await audit(prisma), null, 2)); }
  finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch(() => {
  // Database errors can include business rows/credentials. Never echo them.
  console.error('Partner schema audit failed; verify the target, read access, and migration state.');
  process.exitCode = 1;
});
