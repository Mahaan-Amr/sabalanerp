import type { Prisma } from '@prisma/client';

/** Shared by ordinary and Case loading writers. The transaction retains this
 * lock until insertion, preserving the existing L-YYYYMMDD-NNNN format without
 * allocating an already-used suffix after draft deletion or concurrent create. */
export async function allocateLoadingNumber(tx: Prisma.TransactionClient, now = new Date()) {
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `L-${datePart}-`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`LOGISTICS_LOADING_NUMBER:${datePart}`}))`;
  const rows = await tx.logisticsLoading.findMany({ where: { loadingNumber: { startsWith: prefix } }, select: { loadingNumber: true } });
  let highest = 0n;
  for (const row of rows) {
    const suffix = row.loadingNumber.slice(prefix.length);
    if (/^\d+$/.test(suffix) && BigInt(suffix) > highest) highest = BigInt(suffix);
  }
  return `${prefix}${String(highest + 1n).padStart(4, '0')}`;
}
