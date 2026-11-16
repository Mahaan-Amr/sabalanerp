import type { PrismaClient } from '@prisma/client';

/** Read-only verification of the database protections installed by migration. */
export async function verifyCustomerAllocationDeploymentState(database: Pick<PrismaClient, '$queryRaw'>) {
  const [state] = await database.$queryRaw<Array<{ triggersReady: boolean; pendingIndexReady: boolean; fencesReady: boolean }>>`
    WITH expected(table_name, trigger_name, function_name, trigger_type) AS (
      VALUES
        ('accounting_customer_commands', 'bind_customer_allocation_intent_result', 'bind_customer_allocation_intent_result', 5),
        ('accounting_customer_commands', 'serialize_customer_allocation_parent', 'serialize_customer_allocation_parent', 7),
        ('accounting_customer_allocation_intents', 'allocation_intent_evidence_immutable', 'protect_allocation_intent_evidence', 27),
        ('accounting_customer_allocation_intents', 'verify_customer_allocation_intent_result', 'verify_customer_allocation_intent_result', 23),
        ('accounting_customer_allocation_intents', 'serialize_customer_allocation_intent_insert', 'serialize_customer_allocation_intent_insert', 7)
    ), expected_fences(table_name, key_name) AS (
      VALUES ('public.accounting_customer_allocation_fences', 'profileId'),
        ('public.accounting_customer_command_key_fences', 'idempotencyKey')
    )
    SELECT NOT EXISTS (
      SELECT 1 FROM expected e WHERE NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
        JOIN pg_namespace pn ON pn.oid = p.pronamespace
        WHERE n.nspname = 'public' AND pn.nspname = 'public'
          AND c.relname = e.table_name AND t.tgname = e.trigger_name AND p.proname = e.function_name
          AND t.tgtype = e.trigger_type AND t.tgenabled IN ('O', 'A') AND NOT t.tgisinternal AND t.tgqual IS NULL
      )
    ) AS "triggersReady", EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = to_regclass('public.accounting_customer_allocation_intents')
        AND c.relname = 'allocation_intent_one_pending_per_profile'
        AND i.indisunique AND i.indisvalid AND i.indisready
        AND i.indnkeyatts = 1 AND pg_get_indexdef(i.indexrelid, 1, false) = '"profileId"'
        AND pg_get_expr(i.indpred, i.indrelid) = '(state = ''PENDING''::text)'
    ) AS "pendingIndexReady", to_regprocedure('public.serialize_customer_command_key_within(text)') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM expected_fences e WHERE NOT EXISTS (
        SELECT 1 FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
        WHERE i.indrelid = to_regclass(e.table_name) AND a.attname = e.key_name
          AND a.atttypid = 'text'::regtype AND a.attnotnull
          AND i.indisprimary AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts = 1
      )
    ) AS "fencesReady"
  `;
  if (!state?.triggersReady || !state.pendingIndexReady || !state.fencesReady) {
    throw new Error('Customer allocation database protections are incomplete.');
  }
  return { customerAllocationDatabaseProtections: 'verified' };
}
