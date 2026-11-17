import type { PrismaClient } from '@prisma/client';

export async function verifyPredecessorDatabaseRoles(
  database: Pick<PrismaClient, '$queryRaw'>,
  controlUser: string,
  runtimeAddress: string,
) {
  const [result] = await database.$queryRaw<Array<{ control: boolean; controller: 'dormant' | 'restricted' | null; runtime: boolean; closed: boolean }>>`
    WITH protected_relations AS (
      SELECT oid, relowner, relname FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relname IN ('_prisma_migrations', 'deployment_operations',
          'customer_allocation_release_control', 'customer_allocation_release_audit')
    ), controller_routines AS (
      SELECT oid FROM pg_catalog.pg_proc
      WHERE oid IN (
        pg_catalog.to_regprocedure('public.customer_allocation_controller_lock(text,text)'),
        pg_catalog.to_regprocedure('public.customer_allocation_controller_activate(text,text,text,text,timestamptz)'),
        pg_catalog.to_regprocedure('public.customer_allocation_controller_close(text,text,text,text)')
      ) AND prosecdef AND proowner = session_user::regrole
    ), role_attributes AS (
      SELECT r.oid, r.rolname, r.rolcanlogin, r.rolconfig,
        NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid = r.oid OR m.member = r.oid
        ) AS restricted
      FROM pg_catalog.pg_roles r
    )
    SELECT session_user = ${controlUser} AND current_user = session_user
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = session_user AND rolsuper AND rolcanlogin)
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_database WHERE datname = current_database() AND datdba = session_user::regrole
      )
      AND (SELECT count(*) FROM protected_relations WHERE relowner = session_user::regrole) = 4
      AS control,
      (
        SELECT CASE
          WHEN NOT r.rolcanlogin AND auth.rolpassword IS NULL THEN 'dormant'
          WHEN r.rolcanlogin AND auth.rolpassword LIKE 'SCRAM-SHA-256$%'
            AND r.rolconfig IS NULL
            AND (auth.rolvaliduntil IS NULL OR auth.rolvaliduntil > clock_timestamp())
            AND NOT EXISTS (SELECT FROM pg_catalog.pg_db_role_setting WHERE setrole = r.oid)
            AND NOT EXISTS (SELECT FROM pg_catalog.pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = r.oid AND deptype = 'o')
            AND pg_catalog.has_database_privilege(r.oid, current_database(), 'CONNECT')
            AND pg_catalog.has_schema_privilege(r.oid, 'public', 'USAGE')
            AND NOT pg_catalog.has_database_privilege(r.oid, current_database(), 'CREATE')
            AND NOT pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE')
            AND NOT EXISTS (
              SELECT FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace
                AND CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
                  pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                  OR pg_catalog.has_any_column_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
                ELSE false END
            )
            AND NOT EXISTS (
              SELECT FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace
                AND CASE WHEN c.relkind = 'S' THEN pg_catalog.has_sequence_privilege(r.oid, c.oid, 'USAGE, SELECT, UPDATE')
                ELSE false END
            )
            AND (SELECT count(*) FROM controller_routines WHERE pg_catalog.has_function_privilege(r.oid, oid, 'EXECUTE')) = 3
            AND NOT EXISTS (
              SELECT FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
                AND pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
                AND NOT EXISTS (SELECT FROM controller_routines c WHERE c.oid = p.oid)
            ) THEN 'restricted'
          END
        FROM role_attributes r
        JOIN pg_catalog.pg_authid auth ON auth.oid = r.oid
        WHERE r.rolname = 'sabalan_allocation_controller' AND r.restricted
      ) AS controller,
      EXISTS (
        SELECT 1 FROM role_attributes r
        WHERE r.rolname = 'sabalan_application_runtime' AND r.rolcanlogin AND r.restricted
          AND pg_catalog.has_schema_privilege(r.oid, 'public', 'USAGE')
          AND NOT pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE')
          AND NOT pg_catalog.has_database_privilege(r.oid, current_database(), 'CREATE')
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspowner = r.oid)
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relowner = r.oid)
          AND NOT EXISTS (
            SELECT 1 FROM protected_relations c WHERE
              pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
              OR pg_catalog.has_any_column_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            WHERE p.oid = pg_catalog.to_regprocedure('public.customer_allocation_runtime_admitted(text,text)')
              AND p.prosecdef AND p.proowner = session_user::regrole
              AND pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND (p.proowner = r.oid OR (
              p.prosecdef AND pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
              AND p.oid IS DISTINCT FROM pg_catalog.to_regprocedure('public.customer_allocation_runtime_admitted(text,text)')
            ))
          )
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_stat_activity a
            WHERE a.datname = current_database() AND a.backend_type = 'client backend'
              AND a.client_addr = ${runtimeAddress}::inet AND a.usesysid = r.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_stat_activity a
            WHERE a.backend_type = 'client backend' AND a.client_addr = ${runtimeAddress}::inet
              AND (a.datname IS DISTINCT FROM current_database() OR a.usesysid IS DISTINCT FROM r.oid)
          )
      ) AS runtime,
      (SELECT count(*) = 1 AND bool_and(id = 'grouped-allocation' AND state = 'CLOSED')
        FROM public.customer_allocation_release_control) AS closed
  `;
  if (!result?.control || !result.controller || !result.runtime || !result.closed) {
    throw new Error('PREDECESSOR_DATABASE_ROLES_UNPROVEN');
  }
  return { control: 'owner', controller: result.controller, runtime: 'restricted', allocation: 'closed' };
}
