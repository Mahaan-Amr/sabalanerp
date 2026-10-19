import { Prisma } from '@prisma/client';

type LegacyCleanupRow = { id: string; storageName: string; originalPath: string; stagedPath: string;
  status: string; legacyFileState: boolean };

/** Call only while holding the parent deletion-receipt lock. ACCESS SHARE
 * keeps the catalog decision stable through this transaction without blocking
 * ordinary row writes. Only actual SQL NULL is legacy; JSONB null, arrays,
 * scalars and objects remain declared versioned/unknown state. */
export async function readHrLegacyFileCleanupRows(tx: Prisma.TransactionClient, receiptId: string) {
  await tx.$executeRaw`LOCK TABLE public.hr_deletion_file_cleanups IN ACCESS SHARE MODE`;
  const column = await tx.$queryRaw<Array<{ knownShape: boolean }>>`SELECT
      atttypid='pg_catalog.jsonb'::pg_catalog.regtype AND NOT attnotnull AND NOT atthasdef AND attgenerated='' AND attidentity='' AS "knownShape"
    FROM pg_catalog.pg_attribute WHERE attrelid='public.hr_deletion_file_cleanups'::pg_catalog.regclass
      AND attname='versionedFileState' AND attnum>0 AND NOT attisdropped`;
  if (column.length > 1 || (column.length === 1 && column[0].knownShape !== true)) throw Object.assign(
    new Error('ساختار سوابق پاک‌سازی با نسخهٔ برنامه هماهنگ نیست؛ مدیر سامانه باید وضعیت به‌روزرسانی را بررسی کند.'),
    { code: 'HR_FILE_CLEANUP_SCHEMA_UNRECOGNIZED', statusCode: 409 });
  const legacy = column.length === 0 ? Prisma.sql`TRUE` : Prisma.sql`c."versionedFileState" IS NULL`;
  return tx.$queryRaw<LegacyCleanupRow[]>(Prisma.sql`SELECT id,"storageName","originalPath","stagedPath",status,
      ${legacy} AS "legacyFileState" FROM public.hr_deletion_file_cleanups c
    WHERE "receiptId"=${receiptId} ORDER BY "createdAt",id`);
}
