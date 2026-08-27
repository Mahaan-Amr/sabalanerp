import { Prisma } from '@prisma/client';
import { BusinessIdentity, ContractRuntime, CurrentOutput, CustomerOutputError, Output, Snapshot } from './contracts';

// The wire allows 80-character decimals. Validate sums without changing Prisma's
// shared Decimal configuration or rounding valid large evidence to 20 digits.
const OutputDecimal = Prisma.Decimal.clone({ precision: 200 });

export function createCustomerOutputSnapshots(contract: ContractRuntime) {
  const conflict = (): never => { throw new CustomerOutputError('INTEGRITY_CONFLICT'); };

  function checkCommercialContent(content: Output): void {
    const ids = new Set(content.products.map(row => row.productRowId));
    if (ids.size !== content.products.length) conflict();
    const deliveryIds = new Set<string>();
    for (const delivery of content.deliveries) {
      if (deliveryIds.has(delivery.deliveryId)) conflict();
      deliveryIds.add(delivery.deliveryId);
      const rows = new Set<string>();
      for (const row of delivery.items) {
        if (!ids.has(row.productRowId) || rows.has(row.productRowId)) conflict();
        rows.add(row.productRowId);
      }
    }
    const totals = content.totals;
    if (!new OutputDecimal(totals.net).minus(totals.discount).plus(totals.tax).plus(totals.charges).equals(totals.payable)) conflict();
    const installments = content.customerPaymentPlan.installments;
    if (new Set(installments.map(row => row.installmentId)).size !== installments.length
      || installments.some(row => row.amount.currency !== totals.currency)) conflict();
  }

  async function content(value: unknown): Promise<Output> {
    const parsed = contract.CustomerContractOutputSchema.safeParse(value);
    if (!parsed.success) return conflict();
    const { outputHash, ...evidence } = parsed.data;
    if (await contract.canonicalHash(evidence) !== outputHash) return conflict();
    checkCommercialContent(parsed.data);
    return parsed.data;
  }

  async function read(value: unknown): Promise<Snapshot> {
    const parsed = contract.CustomerOutputSnapshotSchema.safeParse(value);
    if (!parsed.success) return conflict();
    await content(parsed.data.content);
    return parsed.data;
  }

  async function mint(input: {
    snapshotId: string;
    owner: Snapshot['owner'];
    normalizedRecipient: string;
    createdAt: string;
    expiresAt: string;
    business: BusinessIdentity;
    // Resolved by the Case owner from the immutable revision, never a Prisma entity.
    retail: Omit<Output, 'seller' | 'outputHash'>;
  }): Promise<Snapshot> {
    const seller = {
      displayName: input.business.tradeName?.trim() || input.business.legalName.trim(),
      phone: input.business.businessPhone,
      address: input.business.businessAddress,
    };
    const parsed = contract.CustomerContractOutputSchema.safeParse({
      ...input.retail, seller, outputHash: 'sha256-v1:' + '0'.repeat(64),
    });
    if (!parsed.success) return conflict();
    const { outputHash: unused, ...evidence } = parsed.data;
    const sealed = { ...evidence, outputHash: await contract.canonicalHash(evidence) };
    return read({
      schemaVersion: 1, snapshotId: input.snapshotId, owner: input.owner,
      normalizedRecipient: input.normalizedRecipient, createdAt: input.createdAt,
      expiresAt: input.expiresAt, content: sealed,
    });
  }

  function disposition(snapshot: Snapshot, current: CurrentOutput, verifiedAt: string | null, now: string) {
    contract.InstantSchema.parse(now);
    contract.RevisionRefSchema.parse(current.owner);
    if (snapshot.createdAt > now || snapshot.expiresAt <= now) throw new CustomerOutputError('NOT_FOUND');
    if (snapshot.owner.caseId !== current.owner.caseId || snapshot.content.contractNumber !== current.contractNumber) return conflict();
    if (snapshot.owner.revision > current.owner.revision) return conflict();
    if (snapshot.owner.revision === current.owner.revision && snapshot.owner.integrityHash !== current.owner.integrityHash) return conflict();
    const cancelled = current.state === 'CANCELLED' || current.state === 'VOIDED';
    const replaced = snapshot.owner.revision !== current.owner.revision
      || snapshot.normalizedRecipient !== current.normalizedRecipient;
    if (!verifiedAt && (cancelled || replaced)) throw new CustomerOutputError('ROW_STALE');
    if (verifiedAt) {
      contract.InstantSchema.parse(verifiedAt);
      if (verifiedAt < snapshot.createdAt || verifiedAt >= snapshot.expiresAt || verifiedAt > now) return conflict();
    }
    return {
      readOnly: Boolean(verifiedAt) || cancelled || replaced,
      banner: cancelled ? 'CANCELLED' as const : replaced ? 'SUPERSEDED' as const : null,
    };
  }

  return { mint, read, content, disposition };
}
