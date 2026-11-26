import { Prisma } from '@prisma/client';
import { readBoundPricedAllocation } from './allocationPricingReadModel';
import { pricingCurrencyKind } from './approvedPricing/domain';

const Decimal = Prisma.Decimal.clone({ precision: 80 });

export const sepidarInvoiceFields = { number: true, amountRial: true } as const;
export const presentSepidarInvoices = (invoices: { number: string; amountRial: Prisma.Decimal | null }[]) =>
  invoices.map(({ number, amountRial }) => ({ number, amountRial: amountRial?.toFixed() ?? null }));

const normalizeDigits = (value: string) => value.trim().replace(/[۰-۹٠-٩]/g, digit =>
  String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 1776 ? 1776 : 1632)));

export function parseSepidarInvoices(input: unknown) {
  if (!Array.isArray(input) || input.length > 100) return null;
  const invoices: { number: string; amountRial: string }[] = [];
  const numbers = new Set<string>();
  for (const item of input) {
    if (typeof item?.number !== 'string' || typeof item?.amountRial !== 'string') return null;
    const number = normalizeDigits(item.number);
    const amountRial = normalizeDigits(item.amountRial);
    if (!/^[0-9]{1,64}$/.test(number) || !/^[0-9]{1,38}(\.[0-9]{1,12})?$/.test(amountRial) || numbers.has(number)) return null;
    numbers.add(number);
    invoices.push({ number, amountRial: new Decimal(amountRial).toFixed() });
  }
  return invoices;
}

export const sumSepidarInvoiceAmounts = (invoices: { amountRial: string }[]) =>
  invoices.reduce((total, invoice) => total.plus(invoice.amountRial), new Decimal(0)).toFixed();

export function sepidarInvoiceTotalsMatch(invoices: { amountRial: string }[], loadingTotalRial: string | null) {
  if (loadingTotalRial === null) return false;
  const loadingTotal = new Decimal(loadingTotalRial);
  if (loadingTotal.isNegative()) return false;
  const invoiceTotal = new Decimal(sumSepidarInvoiceAmounts(invoices));
  return invoiceTotal.toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
    .equals(loadingTotal.toDecimalPlaces(3, Decimal.ROUND_HALF_UP));
}

/** The net approved amount of each current finalized allocation, in rials. */
export async function readSepidarLoadingTotal(tx: Prisma.TransactionClient, loadingId: string) {
  const revisions = await tx.logisticsAllocationRevision.findMany({
    where: { loadingId },
    orderBy: [{ queueTurnId: 'asc' }, { revisionNumber: 'desc' }],
    distinct: ['queueTurnId'],
    select: { id: true, queueTurnId: true, sealedAt: true, candidate: { select: { id: true } }, _count: { select: { lines: true } } },
  });
  if (!revisions.length || revisions.some(revision => !revision.sealedAt || !revision.candidate || !revision._count.lines)) return null;
  const candidateIds = revisions.flatMap(revision => revision.candidate?.id ?? []);
  const candidates = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM accounting_dispatch_candidates
    WHERE id IN (${Prisma.join(candidateIds)}) ORDER BY id FOR SHARE`;
  if (candidates.length !== revisions.length || candidates.some(({ status }) => !['PENDING', 'ACCEPTED'].includes(status))) return null;
  let total = new Decimal(0);
  for (const revision of revisions) {
    let priced;
    try {
      priced = await readBoundPricedAllocation(tx, revision.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError) throw error;
      return null;
    }
    if (priced.lines.length !== revision._count.lines) return null;
    const kind = ['IRT', 'IRR'].includes(priced.currency)
      ? (priced.currency === 'IRT' ? 'TOMAN' : 'RIAL')
      : pricingCurrencyKind(priced.currency);
    if (kind !== 'TOMAN' && kind !== 'RIAL') return null;
    total = total.plus(new Decimal(priced.totals.netAmount).times(kind === 'TOMAN' ? 10 : 1));
  }
  return total.toFixed();
}
