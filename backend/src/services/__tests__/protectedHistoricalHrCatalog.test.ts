import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyHistoricalHrCatalog } from '../protectedHistoricalHrCatalog';

// Public structural fixture reconstructed from the byte-exact c0dea DDL, not
// a captured production catalog hash. PostgreSQL pretty=true expression form.
function catalog() {
  const table = 'driver_vehicle_assignment_plans';
  const columns = [
    ['id', 'text', true, null], ['driverId', 'text', true, null], ['vehicleId', 'text', true, null],
    ['assignmentId', 'text', false, null], ['action', 'text', true, "'ASSIGN'::text"],
    ['status', 'text', true, "'PLANNED'::text"], ['effectiveFrom', 'timestamp(3) without time zone', true, null],
    ['effectiveTo', 'timestamp(3) without time zone', false, null], ['blockedReason', 'text', false, null],
    ['expectedAssignmentIds', 'text[]', true, "'{}'::text[]"], ['createdBy', 'text', true, null],
    ['createdAt', 'timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'], ['updatedAt', 'timestamp(3) without time zone', true, null],
  ].map(([name, type, notNull, defaultValue], index) => ({ name, number: index + 1, type, notNull,
    identity: '', generated: '', collation: type === 'text' || type === 'text[]' ? '"default"' : '-', default: defaultValue }));
  const constraints = [
    ['assignment_plan_period', 'CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")'],
    [table + '_action_check', "CHECK (action = ANY (ARRAY['ASSIGN'::text, 'END'::text]))"],
    [table + '_assignmentId_fkey', 'FOREIGN KEY ("assignmentId") REFERENCES driver_vehicle_assignments(id) ON DELETE RESTRICT'],
    [table + '_driverId_fkey', 'FOREIGN KEY ("driverId") REFERENCES internal_driver_profiles(id) ON DELETE RESTRICT'],
    [table + '_pkey', 'PRIMARY KEY (id)'],
    [table + '_status_check', "CHECK (status = ANY (ARRAY['PLANNED'::text, 'NEEDS_ATTENTION'::text, 'APPLIED'::text, 'CANCELLED'::text]))"],
    [table + '_vehicleId_fkey', 'FOREIGN KEY ("vehicleId") REFERENCES company_vehicles(id) ON DELETE RESTRICT'],
  ].map(([name, definition]) => ({ name, definition, validated: true, deferrable: false, initiallyDeferred: false }));
  const indexes = [
    `CREATE INDEX "${table}_driverId_status_idx" ON public.${table} USING btree ("driverId", status)`,
    `CREATE UNIQUE INDEX ${table}_pkey ON public.${table} USING btree (id)`,
    `CREATE INDEX "${table}_status_effectiveFrom_idx" ON public.${table} USING btree (status, "effectiveFrom")`,
    `CREATE INDEX "${table}_vehicleId_status_idx" ON public.${table} USING btree ("vehicleId", status)`,
  ].map(definition => ({ definition, valid: true, ready: true }));
  const foreignKeyEnforcement = [['assignmentId', 'driver_vehicle_assignments'], ['driverId', 'internal_driver_profiles'],
    ['vehicleId', 'company_vehicles']].flatMap(([column, referenced]) => [
    [table, 'RI_FKey_check_ins', 5], [table, 'RI_FKey_check_upd', 17],
    [referenced, 'RI_FKey_restrict_del', 9], [referenced, 'RI_FKey_noaction_upd', 17],
  ].map(([onTable, fn, type]) => ({ constraint: `${table}_${column}_fkey`, table: onTable, schema: 'public',
    function: fn, functionSchema: 'pg_catalog', functionArguments: '', type, arguments: '', columns: '', when: null,
    internal: true, enabled: 'O', deferrable: false, initiallyDeferred: false, oldTransition: null, newTransition: null })));
  return { name: table, details: { kind: 'r', persistence: 'p', owner: 'app_owner', rls: false, forceRls: false,
    replicaIdentity: 'd', columns, constraints, indexes, foreignKeyEnforcement, triggers: null, policies: null, inheritance: 0 } };
}

test('a complete finite c0dea HR catalog yields a structural inspection digest', () => {
  assert.match(verifyHistoricalHrCatalog(catalog(), 'app_owner'), /^[a-f0-9]{64}$/);
});

test('counts and an observed hash cannot bless changed HR structure or RI enforcement', () => {
  const mutations = [
    (v: any) => { v.details.rls = true; }, (v: any) => { v.details.forceRls = true; },
    (v: any) => { v.details.owner = 'other'; }, (v: any) => { v.details.persistence = 'u'; },
    (v: any) => { v.details.replicaIdentity = 'f'; }, (v: any) => { v.details.inheritance = 1; },
    (v: any) => { v.details.policies = ['public']; }, (v: any) => { v.details.triggers = [{ name: 'unexpected' }]; },
    (v: any) => { v.details.columns[0].notNull = false; }, (v: any) => { v.details.columns[4].default = "'END'::text"; },
    (v: any) => { v.details.columns[0].collation = 'C'; }, (v: any) => { v.details.columns[0].identity = 'a'; },
    (v: any) => { v.details.columns[0].generated = 's'; }, (v: any) => { v.details.columns[0].number = 99; },
    (v: any) => { v.details.columns[6].type = 'timestamp without time zone'; },
    (v: any) => { v.details.constraints[0].validated = false; },
    (v: any) => { v.details.constraints[0].definition = 'CHECK (true)'; },
    (v: any) => { v.details.constraints[0].deferrable = true; },
    (v: any) => { v.details.indexes[0].valid = false; }, (v: any) => { v.details.indexes[0].ready = false; },
    (v: any) => { v.details.foreignKeyEnforcement[0].enabled = 'D'; },
    (v: any) => { v.details.foreignKeyEnforcement[0].functionSchema = 'public'; },
    (v: any) => { v.details.foreignKeyEnforcement[0].type = 9; },
    (v: any) => { v.details.foreignKeyEnforcement.pop(); },
    (v: any) => { v.details.foreignKeyEnforcement[0].arguments = '00'; },
    (v: any) => { v.details.columns.push({ ...v.details.columns[0], name: 'unexpected' }); },
  ];
  for (const mutate of mutations) { const value = catalog(); mutate(value); assert.throws(() => verifyHistoricalHrCatalog(value, 'app_owner')); }
  assert.throws(() => verifyHistoricalHrCatalog({ catalogSha256: 'a'.repeat(64) }, 'app_owner'));
});
