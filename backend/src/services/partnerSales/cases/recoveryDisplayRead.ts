import { Prisma, type SalesContractEditSession } from '@prisma/client';

export type RecoveryDisplaySelection = { kind: 'latest' } | { kind: 'wizard' } | { kind: 'revision'; revision: number };

/** Read-only projection for consumers that already select one saved revision.
 * The caller still owns authorization, lease and full envelope verification.
 * Never use this projection for journal validation, CAS or any recovery write. */
export async function readRecoveryForDisplay(database: Pick<Prisma.TransactionClient, '$queryRaw'>,
  draftId: string, selection: RecoveryDisplaySelection): Promise<SalesContractEditSession | null> {
  const target = selection.kind === 'revision' ? Prisma.sql`${selection.revision}::numeric`
    : Prisma.sql`CASE WHEN jsonb_typeof(recovery #> '{wizardDraft,intent,recoveryRevision}') = 'number'
        THEN (recovery #>> '{wizardDraft,intent,recoveryRevision}')::numeric ELSE NULL END`;
  const targetColumn = selection.kind === 'wizard' ? Prisma.sql`(SELECT revision FROM target_revision)` : target;
  // Materialize only the scalar hint, not the document. Re-evaluating a JSON
  // path for each journal entry repeatedly decompresses the large TOAST value.
  const targetRead = selection.kind === 'wizard' ? Prisma.sql`WITH target_revision AS MATERIALIZED (
    SELECT ${target} AS revision FROM sales_contract_edit_sessions WHERE "draftId" = ${draftId})` : Prisma.empty;
  const selected = selection.kind === 'latest'
    ? Prisma.sql`CASE WHEN jsonb_array_length(recovery->'validatedSnapshots') = 0 THEN '[]'::jsonb
        ELSE jsonb_build_array(recovery->'validatedSnapshots'->-1) END`
    : Prisma.sql`COALESCE((SELECT jsonb_agg(entry ORDER BY position)
        FROM jsonb_array_elements(recovery->'validatedSnapshots') WITH ORDINALITY AS records(entry, position)
        WHERE CASE WHEN jsonb_typeof(entry #> '{payload,view,recoveryRevision}') = 'number'
          THEN (entry #>> '{payload,view,recoveryRevision}')::numeric BETWEEN (${targetColumn}) - 1 AND (${targetColumn}) + 1
          ELSE false END), '[]'::jsonb)`;
  // The inclusive numeric range is deliberately broader than equality. JSON
  // numbers can round when decoded by JS; retain every possible matching hint,
  // then let the existing JS selector and full decoder make the exact decision.
  const rows = await database.$queryRaw<SalesContractEditSession[]>`
    ${targetRead}
    SELECT id, "draftId", "contractId", "ownerUserId", purpose, "browserSessionId", "leaseToken",
      "schemaVersion", "baseRevision", "takenOverAt", "createdAt", "updatedAt",
      CASE WHEN jsonb_typeof(recovery->'validatedSnapshots') = 'array'
        THEN jsonb_set(recovery, '{validatedSnapshots}', ${selected})
        ELSE recovery END AS recovery
    FROM sales_contract_edit_sessions WHERE "draftId" = ${draftId}`;
  return rows[0] ?? null;
}
