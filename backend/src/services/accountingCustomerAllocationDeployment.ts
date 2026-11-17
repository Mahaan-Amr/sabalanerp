import type { PrismaClient } from '@prisma/client';

/** Read-only verification of the database protections installed by migration. */
export async function verifyCustomerAllocationDeploymentState(database: Pick<PrismaClient, '$queryRaw'>) {
  const [state] = await database.$queryRaw<Array<{
    triggersReady: boolean; pendingIndexReady: boolean; fencesReady: boolean;
  }>>`
    WITH expected(table_name, trigger_name, function_name, trigger_type, deferred) AS (
      VALUES
        ('accounting_customer_commands', 'bind_customer_allocation_intent_result', 'bind_customer_allocation_intent_result', 5, false),
        ('accounting_customer_commands', 'serialize_customer_allocation_parent', 'serialize_customer_allocation_parent', 7, false),
        ('accounting_customer_allocation_intents', 'allocation_intent_evidence_immutable', 'protect_allocation_intent_evidence', 27, false),
        ('accounting_customer_allocation_intents', 'verify_customer_allocation_intent_result', 'verify_customer_allocation_intent_result', 23, false),
        ('accounting_customer_allocation_intents', 'serialize_customer_allocation_intent_insert', 'serialize_customer_allocation_intent_insert', 7, false),
        ('accounting_settlement_allocations', 'verify_grouped_allocation_child', 'verify_grouped_allocation_child', 5, true),
        ('accounting_settlement_allocations', 'require_active_grouped_allocation_child', 'require_active_grouped_allocation_child', 5, true),
        ('customer_allocation_release_control', 'guard_customer_allocation_control_row', 'guard_customer_allocation_control', 31, false),
        ('customer_allocation_release_control', 'guard_customer_allocation_control_truncate', 'guard_customer_allocation_control', 34, false),
        ('customer_allocation_release_audit', 'guard_customer_allocation_audit', 'guard_customer_allocation_audit', 58, false)
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
          AND t.tgdeferrable = e.deferred AND t.tginitdeferred = e.deferred
      )
    ) AS "triggersReady", EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = to_regclass('public.accounting_customer_allocation_intents')
        AND c.relname = 'allocation_intent_one_pending_per_profile'
        AND i.indisunique AND i.indisvalid AND i.indisready
        AND i.indnkeyatts = 1 AND pg_get_indexdef(i.indexrelid, 1, false) = '"profileId"'
        AND pg_get_expr(i.indpred, i.indrelid) = '(state = ''PENDING''::text)'
    ) AS "pendingIndexReady", to_regprocedure('public.serialize_customer_command_key_within(text)') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.customer_allocation_controller_close(text,text,text,text)')
        AND p.prosecdef
    )
    AND EXISTS (
      SELECT 1 FROM pg_proc p CROSS JOIN pg_roles runtime
      WHERE p.oid = to_regprocedure('public.customer_allocation_runtime_admitted(text,text)')
        AND p.prosecdef AND runtime.rolname = 'sabalan_application_runtime'
        AND has_function_privilege(runtime.oid, p.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS access
          WHERE access.grantee = 0 AND access.privilege_type = 'EXECUTE'
        )
    )
    AND EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indexrelid = to_regclass('public.customer_allocation_release_audit_activation_once')
        AND i.indrelid = to_regclass('public.customer_allocation_release_audit')
        AND i.indisunique AND i.indisvalid AND i.indisready
        AND i.indnkeyatts = 2
        AND pg_get_indexdef(i.indexrelid, 1, false) = 'deployment_id'
        AND pg_get_indexdef(i.indexrelid, 2, false) = 'release_id'
        AND pg_get_expr(i.indpred, i.indrelid) = '(event = ''ACTIVATED''::text)'
    )
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
  const [control] = await database.$queryRaw<Array<{ closed: boolean }>>`
    SELECT count(*) = 1 AND bool_and(id = 'grouped-allocation' AND state = 'CLOSED') AS closed
    FROM public.customer_allocation_release_control
  `;
  if (!control?.closed) throw new Error('Customer allocation release control is not closed.');
  return { customerAllocationDatabaseProtections: 'verified' };
}
