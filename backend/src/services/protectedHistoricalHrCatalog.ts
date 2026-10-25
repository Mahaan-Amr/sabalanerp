import { createHash } from 'node:crypto';

const table = 'driver_vehicle_assignment_plans';
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical(v[key])])) : v;
const encode = (v: unknown) => JSON.stringify(canonical(v));
function fail(): never { throw Error('PROTECTED_HR_HISTORICAL_CATALOG_UNPROVEN'); }

/** Complete finite structural expectations for the reviewed c0dea DDL. These
 * are source expectations, never a caller-provided observed-catalog hash.
 * Constraint definitions use pg_get_constraintdef(oid, true); RI names/OIDs
 * are omitted, but every enforcement trigger's stable semantics is retained.
 */
export function verifyHistoricalHrCatalog(value: unknown, owner: string): string {
  if (typeof owner !== 'string' || !owner || owner.length > 63) fail();
  const columns: Array<[string, string, boolean, string | null]> = [
    ['id', 'text', true, null], ['driverId', 'text', true, null], ['vehicleId', 'text', true, null],
    ['assignmentId', 'text', false, null], ['action', 'text', true, "'ASSIGN'::text"],
    ['status', 'text', true, "'PLANNED'::text"], ['effectiveFrom', 'timestamp(3) without time zone', true, null],
    ['effectiveTo', 'timestamp(3) without time zone', false, null], ['blockedReason', 'text', false, null],
    ['expectedAssignmentIds', 'text[]', true, "'{}'::text[]"], ['createdBy', 'text', true, null],
    ['createdAt', 'timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'], ['updatedAt', 'timestamp(3) without time zone', true, null],
  ];
  const constraints = [
    ['assignment_plan_period', 'CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")'],
    [table + '_action_check', "CHECK (action = ANY (ARRAY['ASSIGN'::text, 'END'::text]))"],
    [table + '_assignmentId_fkey', 'FOREIGN KEY ("assignmentId") REFERENCES driver_vehicle_assignments(id) ON DELETE RESTRICT'],
    [table + '_driverId_fkey', 'FOREIGN KEY ("driverId") REFERENCES internal_driver_profiles(id) ON DELETE RESTRICT'],
    [table + '_pkey', 'PRIMARY KEY (id)'],
    [table + '_status_check', "CHECK (status = ANY (ARRAY['PLANNED'::text, 'NEEDS_ATTENTION'::text, 'APPLIED'::text, 'CANCELLED'::text]))"],
    [table + '_vehicleId_fkey', 'FOREIGN KEY ("vehicleId") REFERENCES company_vehicles(id) ON DELETE RESTRICT'],
  ];
  const indexes = [
    `CREATE INDEX "${table}_driverId_status_idx" ON public.${table} USING btree ("driverId", status)`,
    `CREATE UNIQUE INDEX ${table}_pkey ON public.${table} USING btree (id)`,
    `CREATE INDEX "${table}_status_effectiveFrom_idx" ON public.${table} USING btree (status, "effectiveFrom")`,
    `CREATE INDEX "${table}_vehicleId_status_idx" ON public.${table} USING btree ("vehicleId", status)`,
  ];
  const foreignKeyEnforcement = [['assignmentId', 'driver_vehicle_assignments'], ['driverId', 'internal_driver_profiles'],
    ['vehicleId', 'company_vehicles']].flatMap(([column, referenced]) => [
    [table, 'RI_FKey_check_ins', 5], [table, 'RI_FKey_check_upd', 17],
    [referenced, 'RI_FKey_restrict_del', 9], [referenced, 'RI_FKey_noaction_upd', 17],
  ].map(([onTable, fn, type]) => ({ constraint: `${table}_${column}_fkey`, table: onTable, schema: 'public',
    function: fn, functionSchema: 'pg_catalog', functionArguments: '', type, arguments: '', columns: '', when: null,
    internal: true, enabled: 'O', deferrable: false, initiallyDeferred: false, oldTransition: null, newTransition: null })));
  const expected = { name: table, details: {
    kind: 'r', persistence: 'p', owner, rls: false, forceRls: false, replicaIdentity: 'd',
    columns: columns.map(([name, type, notNull, defaultValue], index) => ({ name, number: index + 1, type, notNull,
      identity: '', generated: '', collation: type === 'text' || type === 'text[]' ? '"default"' : '-', default: defaultValue })),
    constraints: constraints.map(([name, definition]) => ({ name, definition, validated: true, deferrable: false, initiallyDeferred: false })),
    indexes: indexes.map(definition => ({ definition, valid: true, ready: true })),
    foreignKeyEnforcement, triggers: null, policies: null, inheritance: 0,
  } };
  // PostgreSQL catalog queries order arrays; compare unordered sets explicitly
  // only where catalog enumeration has no intrinsic position. Column attnums
  // remain ordered and exact, including gaps caused by dropped columns.
  const normalize = (v: any) => {
    if (!v || !v.details) fail();
    const copy = structuredClone(v);
    for (const key of ['constraints', 'indexes', 'foreignKeyEnforcement']) {
      if (!Array.isArray(copy.details[key])) fail();
      copy.details[key].sort((a: unknown, b: unknown) => encode(a).localeCompare(encode(b)));
    }
    return copy;
  };
  const normalized = normalize(value);
  if (encode(normalized) !== encode(normalize(expected))) fail();
  return createHash('sha256').update(encode(normalized)).digest('hex');
}
