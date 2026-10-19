import { createHash } from 'node:crypto';
import baseline from './protectedBootstrapBaseline.json';

const definitions = Object.freeze([
  ['20261014150000_customer_opening_review', 'be095bd5afd3e18b21397d2475202f4093ad597740ddd8b6c3d37e660fe91813'],
  ['20261014151000_customer_credit_settlement_source', '8def7c867e27cf3e8d17f945994664cb836e31bd676faf6073e8d2e11865fda0'],
  ['20261014152000_customer_receipt_components', '821fe9f781450eb7381a6bec07f4109744be7296d539b00abadbc5a872ca8bca'],
  ['20261014153000_customer_receipt_adjustments', '29ce1853a0d89dce901facb914706291c90a926badbf3d5295ca9088434e1206'],
  ['20261014154000_customer_check_bank_outcomes', '5c6ab5a025f8b9326a22ea59806283a3b2e3f06100d1d1ca1f50fc40c77d1bb6'],
  ['20261014155000_customer_command_and_attribution', '7d18552d570107a92560d528b207c4cf64396ca84bf969aafa20f30bf1b3d919'],
  ['20261014160000_customer_legacy_receipt_resolution', '21938e7c0cf840c965f8cdeb862b15992656daac0c366d9b50ee8cea9d0a6d0b'],
  ['20261019010000_customer_semantic_barrier', 'f21138c410c8653d8fcfc46b266c4ae91e82385adb0263fa0696bad9fa36ce55'],
].map(([name, sha256]) => Object.freeze({ name, sha256 })));
const prefix = [...baseline.migrations,
  { name: '20261014120000_hr_vehicle_assignment_plans', sha256: 'c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289' },
  { name: '20261014140000_online_deployment_control', sha256: '872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2' },
];
const fail = (): never => { throw new Error('CUSTOMER_EXPANSION_SOURCE_UNPROVEN'); };

/** Private PostgreSQL rehearsal only. This compiler has no deployment authority
 * or production executor. The database-name guard is additional containment,
 * never a substitute for the real native owner/checkpoint/lease protocol.
 * All eight files and their test-only history receipts commit as one statement.
 */
export function compileClosedCustomerExpansion(files: readonly { name: string; bytes: Buffer }[]) {
  if (!Array.isArray(files) || files.length !== definitions.length || baseline.migrations.length !== 425) fail();
  const bodies = files.map((file, index) => {
    const expected = definitions[index];
    if (!file || file.name !== expected.name || !Buffer.isBuffer(file.bytes)
      || createHash('sha256').update(file.bytes).digest('hex') !== expected.sha256) fail();
    const body = file.bytes.toString('utf8');
    // Static delimiters are accepted only after complete immutable-file proof.
    if (body.includes('$customer_file$')) fail();
    return `EXECUTE $customer_file$${body}$customer_file$;`;
  });
  const expectedHistory = prefix.map(row => `('${row.name}','${row.sha256}')`).join(',\n');
  const receipts = definitions.map(row => `('${row.name}','${row.sha256}')`).join(',\n');
  const sql = `DO $closed_customer_expansion$
DECLARE
  batch_started timestamptz := clock_timestamp();
  batch_finished timestamptz;
BEGIN
  IF current_database() !~ '^qa_customer_expansion_[a-f0-9]{32}$'
      OR current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'CUSTOMER_EXPANSION_REHEARSAL_ONLY' USING ERRCODE='55000';
  END IF;
  IF current_setting('lock_timeout')::interval = interval '0'
      OR current_setting('lock_timeout')::interval > interval '250 milliseconds' THEN
    PERFORM set_config('lock_timeout','250ms',true);
  END IF;
  IF current_setting('statement_timeout')::interval = interval '0'
      OR current_setting('statement_timeout')::interval > interval '10 seconds' THEN
    PERFORM set_config('statement_timeout','10s',true);
  END IF;
  -- Historical byte-exact DDL creates unqualified public relations. Keeping
  -- pg_catalog implicit preserves its lookup priority without making it the
  -- creation schema.
  PERFORM set_config('search_path','public',true);
  IF NOT pg_try_advisory_xact_lock(741936426::bigint) THEN
    RAISE EXCEPTION 'CUSTOMER_EXPANSION_ALREADY_RUNNING' USING ERRCODE='55000';
  END IF;
  LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT count(*) FROM public._prisma_migrations) <> 427 OR EXISTS (
    SELECT 1 FROM (VALUES ${expectedHistory}) AS expected(name,checksum)
    FULL JOIN public._prisma_migrations AS actual ON actual.migration_name=expected.name
    WHERE actual.id IS NULL OR expected.name IS NULL OR actual.checksum<>expected.checksum
      OR actual.finished_at IS NULL OR actual.rolled_back_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_EXPANSION_HISTORY_UNPROVEN' USING ERRCODE='55000';
  END IF;
  ${bodies.join('\n  ')}
  batch_finished := clock_timestamp();
  IF batch_finished < batch_started THEN
    RAISE EXCEPTION 'CUSTOMER_EXPANSION_CLOCK_UNPROVEN' USING ERRCODE='55000';
  END IF;
  INSERT INTO public._prisma_migrations
    (id,checksum,finished_at,migration_name,logs,started_at,applied_steps_count)
    SELECT md5('closed-customer-rehearsal:' || name),checksum,batch_finished,name,
      '{"format":"sabalan-closed-customer-rehearsal/v1","productionAdmission":false}',batch_started,1
    FROM (VALUES ${receipts}) AS migration(name,checksum);
END
$closed_customer_expansion$;`;
  return Object.freeze({ sql, migrations: definitions, productionAdmission: false as const });
}
