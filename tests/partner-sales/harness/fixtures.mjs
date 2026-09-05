import { createHash, randomBytes } from 'node:crypto';
import { localSql, validateNamespace } from './safety.mjs';

// All interpolated identities pass the closed UUID grammar, never user SQL or wildcards.
export async function createFixture(namespace) {
  validateNamespace(namespace);
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  console.log(`Partner QA fixture namespace: ${namespace}`);
  await localSql(`
    BEGIN;
    SET LOCAL lock_timeout = '3s';
    INSERT INTO users (id, email, username, password, "firstName", "lastName", role, "isActive", "updatedAt")
    VALUES ('${namespace}', '${namespace}@example.invalid', '${namespace}', '!disabled-qa-login', 'آزمون', 'فروش داخلی', 'USER', true, now());
    INSERT INTO workspace_permissions (id, "userId", workspace, "permissionLevel", "updatedAt")
    VALUES ('${namespace}-workspace', '${namespace}', 'sales', 'view', now());
    INSERT INTO feature_permissions (id, "userId", workspace, feature, "permissionLevel", "updatedAt")
    VALUES ('${namespace}-feature', '${namespace}', 'sales', 'sales_contracts_create', 'edit', now());
    INSERT INTO auth_sessions (id, "tokenHash", "userId", "idleExpiresAt", "absoluteExpiresAt", "updatedAt")
    VALUES ('${namespace}-session', '${tokenHash}', '${namespace}', now() + interval '20 minutes', now() + interval '20 minutes', now());
    COMMIT;
  `);
  return { namespace, token };
}

export async function removeFixture(namespace) {
  await localSql(fixtureCleanupSql(namespace));
}

export function fixtureCleanupSql(namespace, { transaction = true } = {}) {
  validateNamespace(namespace);
  return `
    ${transaction ? 'BEGIN;' : ''}
    SET LOCAL lock_timeout = '3s';
    SELECT id FROM users WHERE id = '${namespace}' FOR UPDATE;
    DO $cleanup$
    DECLARE ref record; target record; linked boolean;
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.contype = 'f' AND c.confrelid IN
          ('public.users'::regclass, 'public.auth_sessions'::regclass, 'public.feature_permissions'::regclass, 'public.workspace_permissions'::regclass)
        AND (cardinality(c.conkey) <> 1 OR cardinality(c.confkey) <> 1 OR NOT EXISTS (
          SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1] AND a.attname = 'id'
        ))
      ) THEN RAISE EXCEPTION 'Unsupported foreign-key shape; cleanup requires owner review'; END IF;
      IF EXISTS (SELECT 1 FROM users WHERE id = '${namespace}' AND
        (email <> '${namespace}@example.invalid' OR username <> '${namespace}' OR password <> '!disabled-qa-login')) THEN
        RAISE EXCEPTION 'Fixture ownership mismatch';
      END IF;
      FOR target IN SELECT * FROM (VALUES
        ('auth_sessions', '${namespace}-session'),
        ('feature_permissions', '${namespace}-feature'),
        ('workspace_permissions', '${namespace}-workspace')
      ) AS owned(table_name, row_id)
      LOOP
        EXECUTE format('SELECT id FROM %I WHERE id = $1 FOR UPDATE', target.table_name) USING target.row_id;
        FOR ref IN
          SELECT ns.nspname AS schema_name, rel.relname AS table_name, att.attname AS column_name
          FROM pg_constraint c JOIN pg_class rel ON rel.oid = c.conrelid
          JOIN pg_namespace ns ON ns.oid = rel.relnamespace
          JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY(c.conkey)
          WHERE c.contype = 'f' AND c.confrelid = ('public.' || target.table_name)::regclass
        LOOP
          EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I::text = $1)', ref.schema_name, ref.table_name, ref.column_name)
          INTO linked USING target.row_id;
          IF linked THEN RAISE EXCEPTION 'Unexpected fixture artifact dependency'; END IF;
        END LOOP;
      END LOOP;
      DELETE FROM auth_sessions WHERE id = '${namespace}-session' AND "userId" = '${namespace}';
      DELETE FROM feature_permissions WHERE id = '${namespace}-feature' AND "userId" = '${namespace}';
      DELETE FROM workspace_permissions WHERE id = '${namespace}-workspace' AND "userId" = '${namespace}';
      -- Refuse cascades and SET NULL changes to any unexpected record, including future schema additions.
      FOR ref IN
        SELECT ns.nspname AS schema_name, rel.relname AS table_name, att.attname AS column_name
        FROM pg_constraint c JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY(c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass
      LOOP
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I::text = $1)', ref.schema_name, ref.table_name, ref.column_name)
        INTO linked USING '${namespace}';
        IF linked THEN RAISE EXCEPTION 'Unexpected fixture dependency; cleanup rolled back'; END IF;
      END LOOP;
      DELETE FROM users WHERE id = '${namespace}';
    END $cleanup$;
    ${transaction ? 'COMMIT;' : ''}
  `;
}

export async function withFixture(namespace, run) {
  const fixture = await createFixture(namespace);
  try { return await run(fixture); } finally { await removeFixture(namespace); }
}

export async function fixtureFootprint(namespace) {
  validateNamespace(namespace);
  const result = await localSql(`SELECT (
    (SELECT count(*) FROM users WHERE id = '${namespace}') +
    (SELECT count(*) FROM auth_sessions WHERE "userId" = '${namespace}') +
    (SELECT count(*) FROM workspace_permissions WHERE "userId" = '${namespace}') +
    (SELECT count(*) FROM feature_permissions WHERE "userId" = '${namespace}')
  );`);
  return Number(result);
}

export async function unrelatedFingerprint(namespaces) {
  if (!namespaces.length) throw new Error('Explicit fixture namespaces required.');
  const excluded = namespaces.map((value) => `'${validateNamespace(value)}'`).join(',');
  // Hash inside PostgreSQL; names, password hashes, session tokens and financial rows never leave it.
  const tables = [
    ['users', 'id'], ['auth_sessions', 'userId'], ['workspace_permissions', 'userId'],
    ['feature_permissions', 'userId'], ['sales_contracts', null], ['crm_customers', null],
  ];
  return localSql(tables.map(([table, owner]) => `SELECT '${table}:' || md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY id), ''))
    FROM ${table} t ${owner ? `WHERE "${owner}" NOT IN (${excluded})` : ''};`).join('\n'));
}
