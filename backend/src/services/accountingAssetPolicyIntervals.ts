import { Prisma } from '@prisma/client';

export type AssetPolicyInterval = { version: number; effectiveFrom: Date; effectiveTo: Date | null };

/** Endpoints are inclusive; historical overlapping policies cannot be extended silently. */
export function assertAssetPolicyIntervals(existing: AssetPolicyInterval[], next: AssetPolicyInterval): void {
  const latest = existing.reduce<AssetPolicyInterval | undefined>((result, item) =>
    !result || item.version > result.version ? item : result, undefined);
  if (next.version !== (latest?.version ?? 0) + 1 || (latest && next.effectiveFrom <= latest.effectiveFrom)) {
    throw new Error('نسخه و تاریخ اثر سیاست باید پس از آخرین نسخه همان طبقه باشد.');
  }
  if ((next.effectiveTo && next.effectiveTo < next.effectiveFrom) || existing.some(item =>
    (!item.effectiveTo || item.effectiveTo >= next.effectiveFrom) &&
    (!next.effectiveTo || item.effectiveFrom <= next.effectiveTo))) {
    throw new Error('بازه اثر نسخه‌های سیاست دارایی نباید معکوس یا هم‌پوشان باشد.');
  }
}

/** Call inside a transaction. A book row exists before any policy and provides a stable lock. */
export async function createAssetPolicyWithinTransaction(tx: Prisma.TransactionClient, data: Prisma.AccountingAssetClassPolicyUncheckedCreateInput) {
  const books = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "accounting_books" WHERE "id" = ${data.bookId} FOR UPDATE`);
  if (!books.length) throw new Error('دفتر حسابداری معتبر نیست.');
  const existing = await tx.accountingAssetClassPolicy.findMany({ where: { bookId: data.bookId, classCode: data.classCode } });
  assertAssetPolicyIntervals(existing, { version: data.version, effectiveFrom: new Date(data.effectiveFrom),
    effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null });
  return tx.accountingAssetClassPolicy.create({ data });
}
