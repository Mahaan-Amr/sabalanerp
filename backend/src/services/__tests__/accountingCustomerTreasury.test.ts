import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccountingCustomerTreasuryError,
  createAccountingCustomerTreasury,
  createInMemoryCustomerTreasuryRepository,
  hashCustomerTreasuryEvidence,
} from '../accountingCustomerTreasury';

const at = (value: string) => new Date(value);
const actor = { id: 'accountant-1', profile: 'ACCOUNTANT' as const };

const sale = (overrides: Record<string, unknown> = {}): any => ({
  bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1',
  contractId: 'contract-1', contractVersion: 4, partySourceId: 'customer-1',
  partyDisplayName: 'مشتری نمونه', commercialInvoiceNumber: 'فروش-۱۴۰۵-۱',
  transferredAt: at('2026-09-21T08:00:00.000Z'), dueAt: at('2026-10-21T00:00:00.000Z'),
  policy: { id: 'policy-1', version: 2, carriage: 'CUSTOMER_APPOINTED' as const, recognitionPoint: 'GUARD_EXIT' as const },
  evidence: { id: 'guard-exit-1', version: 1, type: 'GUARD_EXIT', occurredAt: at('2026-09-21T08:00:00.000Z'),
    contractId: 'contract-1', contractVersion: 4, productRows: [{ id: 'row-1', quantity: '2' }] },
  lines: [{ id: 'line-1', productRowId: 'row-1', description: 'سنگ فرآوری‌شده', quantity: '2',
    netRials: 1_000_000n, taxRials: 100_000n, costRials: 600_000n, taxRule: {
      id: 'tax-rule-1', version: 3, citation: 'ماده قانونی نمونه', rateBasisPoints: 1000, exempt: false,
    } }],
  accounts: { receivable: 'ar', revenue: 'revenue', outputTax: 'vat', inventory: 'inventory', cost: 'cogs' },
  actor, idempotencyKey: 'recognize-contract-1-v4', correlationId: 'correlation-1',
  ...overrides,
});

test('approved relationship provisions one balance-free customer accounting profile and cancellation preserves it', async () => {
  const repository = createInMemoryCustomerTreasuryRepository();
  const service = createAccountingCustomerTreasury(repository);
  const command = { legalEntityId: 'entity-1', relationshipId: 'contract-1', relationshipVersion: 1,
    partySourceId: 'customer-1', displayName: 'مشتری نمونه', approvedAt: at('2026-09-20T08:00:00Z'), actor };

  const first = await service.provisionCustomerProfile(command);
  const retried = await service.provisionCustomerProfile(command);
  await service.cancelCustomerRelationship({ relationshipId: 'contract-1', cancelledAt: at('2026-09-22T08:00:00Z'), actor });

  assert.equal(first.profile.id, retried.profile.id);
  assert.equal(first.profile.openingBalanceRials, 0n);
  assert.equal(repository.state.profiles.size, 1);
  assert.equal(repository.state.profiles.get(first.profile.id)?.cancelledRelationshipIds.has('contract-1'), true);
});

test('valid transfer evidence posts commercial, receivable, tax, inventory and cost effects exactly once', async () => {
  const repository = createInMemoryCustomerTreasuryRepository();
  const service = createAccountingCustomerTreasury(repository);
  await service.provisionCustomerProfile({ legalEntityId: 'entity-1', relationshipId: 'contract-1', relationshipVersion: 1,
    partySourceId: 'customer-1', displayName: 'مشتری نمونه', approvedAt: at('2026-09-20T08:00:00Z'), actor });
  const command = sale();
  command.evidence.hash = hashCustomerTreasuryEvidence(command.evidence);

  const first = await service.recognizeCustomerSale(command);
  const retried = await service.recognizeCustomerSale(command);

  assert.equal(first.kind, 'POSTED');
  assert.equal(retried.kind, 'POSTED');
  if (first.kind !== 'POSTED' || retried.kind !== 'POSTED') return;
  assert.equal(first.invoice.id, retried.invoice.id);
  assert.equal(first.invoice.journalVoucherId, retried.invoice.journalVoucherId);
  assert.equal(first.openItem.originalRials, 1_100_000n);
  assert.equal(first.taxInvoice.economicPostingIndependent, true);
  assert.equal(repository.state.vouchers.size, 1);
  assert.equal(repository.state.taxOutbox.size, 1);
  assert.deepEqual(first.voucher.lines.map((line) => [line.accountId, line.debitRials, line.creditRials]), [
    ['ar', 1_100_000n, 0n], ['revenue', 0n, 1_000_000n], ['vat', 0n, 100_000n],
    ['cogs', 600_000n, 0n], ['inventory', 0n, 600_000n],
  ]);
});

test('contradictory or unlinked transfer evidence creates an assigned exception with no ledger effect', async () => {
  const repository = createInMemoryCustomerTreasuryRepository();
  const service = createAccountingCustomerTreasury(repository);
  await service.provisionCustomerProfile({ legalEntityId: 'entity-1', relationshipId: 'contract-1', relationshipVersion: 1,
    partySourceId: 'customer-1', displayName: 'مشتری نمونه', approvedAt: at('2026-09-20T08:00:00Z'), actor });
  const command = sale({ evidence: { ...sale().evidence, contractId: 'another-contract' } });
  command.evidence.hash = hashCustomerTreasuryEvidence(command.evidence);

  const result = await service.recognizeCustomerSale(command);

  assert.equal(result.kind, 'EXCEPTION');
  if (result.kind !== 'EXCEPTION') return;
  assert.equal(result.exception.assignedProfile, 'ACCOUNTANT');
  assert.match(result.exception.messagePersian, /شواهد/);
  assert.equal(repository.state.vouchers.size, 0);
  assert.equal(repository.state.openItems.size, 0);
});

test('receipt remains an advance until immutable allocations settle several open items and projection uses posted facts', async () => {
  const repository = createInMemoryCustomerTreasuryRepository();
  const service = createAccountingCustomerTreasury(repository);
  const profile = (await service.provisionCustomerProfile({ legalEntityId: 'entity-1', relationshipId: 'contract-1', relationshipVersion: 1,
    partySourceId: 'customer-1', displayName: 'مشتری نمونه', approvedAt: at('2026-09-20T08:00:00Z'), actor })).profile;
  for (const [contractId, invoiceNumber, key, net] of [
    ['contract-1', 'فروش-۱', 'sale-1', 1_000_000n], ['contract-2', 'فروش-۲', 'sale-2', 500_000n],
  ] as const) {
    const command = sale({ contractId, commercialInvoiceNumber: invoiceNumber, idempotencyKey: key,
      correlationId: key, evidence: { ...sale().evidence, id: `${contractId}-exit`, contractId },
      lines: [{ ...sale().lines[0], id: `${contractId}-line`, netRials: net, taxRials: 0n, costRials: 0n,
        taxRule: { ...sale().lines[0].taxRule, rateBasisPoints: 0, exempt: true } }] });
    command.evidence.hash = hashCustomerTreasuryEvidence(command.evidence);
    await service.recognizeCustomerSale(command);
  }
  const receipt = await service.recordReceipt({ profileId: profile.id, contractId: 'contract-1', amountRials: 1_700_000n,
    occurredAt: at('2026-09-25T08:00:00Z'), financialAccountId: 'bank-1', source: { type: 'BANK_RECEIPT', id: 'receipt-1', version: 1 },
    idempotencyKey: 'receipt-1', actor });
  let projection = await service.projectCustomerAccount({ profileId: profile.id, asOf: at('2026-09-26T00:00:00Z') });
  assert.equal(projection.receivableRials, 1_500_000n);
  assert.equal(projection.unallocatedCreditRials, 1_700_000n);

  const items = [...repository.state.openItems.values()];
  const allocation = await service.allocateReceipt({ receiptId: receipt.id, actor, allocations: [
    { openItemId: items[0].id, amountRials: 1_000_000n }, { openItemId: items[1].id, amountRials: 500_000n },
  ] });
  projection = await service.projectCustomerAccount({ profileId: profile.id, asOf: at('2026-09-26T00:00:00Z') });
  assert.equal(projection.receivableRials, 0n);
  assert.equal(projection.unallocatedCreditRials, 200_000n);
  assert.equal(projection.openItems.length, 0);

  await service.reverseAllocation({ allocationId: allocation.id, reason: 'تخصیص به فاکتور نادرست انجام شده بود', actor });
  projection = await service.projectCustomerAccount({ profileId: profile.id, asOf: at('2026-09-26T00:00:00Z') });
  assert.equal(projection.receivableRials, 1_500_000n);
  assert.equal(projection.unallocatedCreditRials, 1_700_000n);
});

test('destination carriage never recognizes on timeout and requires immutable destination acceptance', async () => {
  const repository = createInMemoryCustomerTreasuryRepository();
  const service = createAccountingCustomerTreasury(repository);
  await service.provisionCustomerProfile({ legalEntityId: 'entity-1', relationshipId: 'contract-1', relationshipVersion: 1,
    partySourceId: 'customer-1', displayName: 'مشتری نمونه', approvedAt: at('2026-09-20T08:00:00Z'), actor });
  const command = sale({ policy: { id: 'policy-2', version: 1, carriage: 'SABALAN_APPOINTED', recognitionPoint: 'DESTINATION_ACCEPTANCE' },
    evidence: { ...sale().evidence, type: 'DELIVERY_TIMEOUT', occurredAt: at('2026-09-30T08:00:00Z') } });
  command.evidence.hash = hashCustomerTreasuryEvidence(command.evidence);

  const result = await service.recognizeCustomerSale(command);
  assert.equal(result.kind, 'EXCEPTION');
  if (result.kind === 'EXCEPTION') assert.equal(result.exception.code, 'DESTINATION_ACCEPTANCE_REQUIRED');
});

test('allocation rejects cross-customer and over-allocation without mutating history', async () => {
  const repository = createInMemoryCustomerTreasuryRepository();
  const service = createAccountingCustomerTreasury(repository);
  await assert.rejects(
    () => service.allocateReceipt({ receiptId: 'missing', actor, allocations: [{ openItemId: 'missing', amountRials: 1n }] }),
    (error: unknown) => error instanceof AccountingCustomerTreasuryError && error.code === 'RECEIPT_NOT_FOUND',
  );
  assert.equal(repository.state.allocations.size, 0);
});
