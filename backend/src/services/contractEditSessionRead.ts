import { Prisma, type SalesContractEditSession } from '@prisma/client';

type ReadDatabase = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** Materialize the complete persisted session. This transport boundary does not
 * select, cache or validate evidence; owning readers keep all their checks. */
export async function readContractEditSession(database: ReadDatabase, draftId: string): Promise<SalesContractEditSession | null> {
  return readSessionDocument(database, draftId, Prisma.sql`recovery::text`);
}

/** Navigation metadata only. Never pass this result to owning journal checks or
 * a recovery writer/CAS; those use readContractEditSession's complete document. */
export function readContractEditSessionMetadata(database: ReadDatabase, draftId: string) {
  return readSessionDocument(database, draftId, Prisma.sql`(CASE WHEN jsonb_typeof(recovery) = 'object'
    THEN recovery - 'validatedSnapshots' ELSE recovery END)::text`);
}

async function readSessionDocument(database: ReadDatabase, draftId: string, document: Prisma.Sql): Promise<SalesContractEditSession | null> {
  const rows = await database.$queryRaw<Array<Omit<SalesContractEditSession, 'recovery'> & { recovery: Uint8Array | null }>>`
    SELECT id, "draftId", "contractId", "ownerUserId", purpose, "browserSessionId", "leaseToken",
      "schemaVersion", "baseRevision", "takenOverAt", "createdAt", "updatedAt",
      convert_to(${document}, 'UTF8') AS recovery
    FROM sales_contract_edit_sessions WHERE "draftId" = ${draftId}`;
  const row = rows[0];
  return row ? { ...row, recovery: row.recovery === null ? null
    : JSON.parse(Buffer.from(row.recovery.buffer, row.recovery.byteOffset, row.recovery.byteLength).toString('utf8')) } : null;
}
