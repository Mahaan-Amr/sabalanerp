import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

type Client = Pick<PrismaClient, '$queryRawUnsafe'>;
export type RecoveryBusinessTableProof = { table: string; columns: string[]; rows: string; sha256: string };
const mismatch = () => Object.assign(new Error('Restored business records differ from the staged checkpoint.'), {
  code: 'DEPLOYMENT_DRILL_BUSINESS_DATA_MISMATCH',
});
const identifier = (value: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw mismatch();
  return `"${value}"`;
};

/** Compare acknowledged commercial identities and exact stored amounts, not
 * readiness alone. Recovery/session/notification and privacy-erasure stores
 * deliberately have different finalization semantics and separate gates. */
export async function captureRecoveryBusinessProof(client: Client, expected?: readonly RecoveryBusinessTableProof[]) {
  const available = await client.$queryRawUnsafe<Array<{ table: string; column: string }>>(`
    SELECT c.table_name AS "table", c.column_name AS "column"
    FROM information_schema.columns c JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.table_name ~ '^((contract|accounting|partner|crm)_|contracts$|customers$)'
    ORDER BY c.table_name COLLATE "C", c.column_name COLLATE "C"`);
  const inventory = new Map<string, string[]>();
  for (const row of available) inventory.set(row.table, [...(inventory.get(row.table) ?? []), row.column]);
  const selections = expected ?? [...inventory].map(([table, columns]) => ({ table, columns }));
  if (!selections.length) throw mismatch();
  const proof: RecoveryBusinessTableProof[] = [];
  for (const { table, columns } of selections) {
    if (!columns.length || !columns.every(column => inventory.get(table)?.includes(column))) throw mismatch();
    const [result] = await client.$queryRawUnsafe<Array<{ rows: string; sha256: string }>>(`
      SELECT count(*)::text AS rows,
        encode(sha256(convert_to(coalesce(string_agg(row_hash, E'\\n' ORDER BY row_hash COLLATE "C"), ''), 'UTF8')), 'hex') AS sha256
      FROM (SELECT encode(sha256(convert_to(to_jsonb(record)::text, 'UTF8')), 'hex') AS row_hash
        FROM (SELECT ${columns.map(identifier).join(', ')} FROM public.${identifier(table)}) record) hashes`);
    if (!result || !/^\d+$/.test(result.rows) || !/^[a-f0-9]{64}$/.test(result.sha256)) throw mismatch();
    proof.push({ table, columns: [...columns], ...result });
  }
  return proof;
}

export async function assertRecoveryBusinessProof(client: Client, expected: readonly RecoveryBusinessTableProof[]) {
  const actual = await captureRecoveryBusinessProof(client, expected);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw mismatch();
  return { tables: actual.length, records: actual.reduce((sum, row) => sum + BigInt(row.rows), 0n).toString(),
    sha256: createHash('sha256').update(JSON.stringify(actual)).digest('hex') };
}
