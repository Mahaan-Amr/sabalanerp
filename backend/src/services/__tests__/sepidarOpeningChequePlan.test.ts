import assert from 'node:assert/strict';
import test from 'node:test';
import { previewSepidarOpeningCheques, SepidarOpeningChequePlanError, type SepidarOpeningChequeEvidence } from '../sepidarOpeningChequePlan';

import { hashAccountingEvidence } from '../accountingLedgerFoundation';
import { applySepidarOpeningBankAndCustomerReturnHistories, applySepidarOpeningBankHistories,
  applySepidarOpeningHistoricalRecipientHistories, applySepidarOpeningHistoricalSupplierHistories, inspectSepidarOpeningChequeTargets, prepareSepidarOpeningChequeVouchers,
  applySepidarOpeningChequeBatch, inspectSepidarOpeningChequeBatchAdmission, sepidarOpeningChequeBatchDigest } from '../sepidarOpeningChequeApplication';

const basis = '2026-03-20T20:30:00.000Z';
const depositAt = '2026-04-01T08:00:00.000Z';
const collectAt = '2026-04-03T08:00:00.000Z';
const hash = '9'.repeat(64);

function bankHistory(): SepidarOpeningChequeEvidence {
  return {
    snapshotSha256: hash, bookId: 'book', openingVoucherId: 'opening-voucher', sourceOpeningVoucherId: '40', basisAt: basis,
    throughAt: '2026-05-01T00:00:00.000Z',
    instruments: [{
      id: '1', sourceDetailId: '20', sourceReceiptHeaderId: '45', basisHistoryId: '30', lastHistoryId: '32', currentState: 4,
      serialNumber: '12345', sayadId: null, sourceBankId: '25', bankName: 'Example bank',
      maturityAt: collectAt, amountRials: 100n, sourceOpeningLineId: '41',
      target: { profileId: 'profile', partyId: 'party', openingPostingLineId: 'opening-line' },
    }],
    openingLines: [{ id: '41', voucherId: '40', sourceDetailId: '20', amountRials: 100n, targetAccountId: 'custody' }],
    events: [
      { id: '31', chequeId: '1', previousHistoryId: '30', occurredAt: depositAt, state: 2, type: 31,
        document: { kind: 'BANKING', type: 1, chequeId: '1', itemId: '51', headerId: '61',
          voucherId: '71', bankAccountId: '15', bankDetailId: 'bank-detail', previousItemId: null },
        posting: { voucherId: 'deposit-voucher', bookId: 'book', reference: { kind: 'BANK', sourceId: '15', targetId: 'bank' },
          lines: [{ sourceLineId: '81', targetLineId: 'deposit-credit', targetAccountId: 'custody', signedRials: -100n },
            { sourceLineId: '82', targetLineId: 'deposit-debit', targetAccountId: 'clearing', signedRials: 100n }] },
      },
      { id: '32', chequeId: '1', previousHistoryId: '31', occurredAt: collectAt, state: 4, type: 32,
        document: { kind: 'BANKING', type: 2, chequeId: '1', itemId: '52', headerId: '62',
          voucherId: '72', bankAccountId: null, bankDetailId: null, previousItemId: '51' },
        posting: { voucherId: 'collect-voucher', bookId: 'book', reference: { kind: 'BANK', sourceId: '15', targetId: 'bank' },
          lines: [{ sourceLineId: '83', targetLineId: 'collect-credit', targetAccountId: 'clearing', signedRials: -100n },
            { sourceLineId: '84', targetLineId: 'collect-debit', targetAccountId: 'cash', signedRials: 100n }] },
      },
    ],
    ledgerLines: [
      { id: '81', voucherId: '71', issuerKind: 'BANKING', issuerHeaderId: '61', accountId: 118, detailId: '20', signedRials: -100n, description: 'Deposit cheque (12345)' },
      { id: '82', voucherId: '71', issuerKind: 'BANKING', issuerHeaderId: '61', accountId: 119, detailId: '20', signedRials: 100n, description: 'Deposit cheque (12345)' },
      { id: '83', voucherId: '72', issuerKind: 'BANKING', issuerHeaderId: '62', accountId: 119, detailId: '20', signedRials: -100n, description: 'Collect cheque (12345)' },
      { id: '84', voucherId: '72', issuerKind: 'BANKING', issuerHeaderId: '62', accountId: 105, detailId: 'bank-detail', signedRials: 100n, description: 'Bank credit' },
    ],
  };
}

test('the preview carries opening custody and replays the original instrument into its cleared state', () => {
  const evidence = bankHistory();
  const preview = previewSepidarOpeningCheques(evidence);
  assert.equal(preview.instruments.length, 1);
  const cheque = preview.instruments[0];
  assert.equal(cheque.opening.historyId, '30');
  assert.equal(cheque.opening.amountRials, 100n);
  assert.equal(cheque.finalStatus, 'CLEARED');
  assert.equal(cheque.clearedRials, 100n);
  assert.equal(cheque.currentCustodyRials, 0n);
  assert.deepEqual(cheque.events.map(({ historyId, status, targetPosting }) =>
    [historyId, status, targetPosting.voucherId, targetPosting.reference.targetId]), [
    ['31', 'DEPOSITED', 'deposit-voucher', 'bank'],
    ['32', 'CLEARED', 'collect-voucher', 'bank'],
  ]);
  assert.deepEqual(previewSepidarOpeningCheques({ ...evidence, events: [...evidence.events].reverse() }), preview);
});

test('equal amount and party cannot substitute a journal row describing another cheque', () => {
  const evidence = bankHistory();
  const [asset, ...otherRows] = evidence.ledgerLines;
  assert.throws(() => previewSepidarOpeningCheques({
    ...evidence, ledgerLines: [{ ...asset, description: 'Deposit cheque (912345)' }, ...otherRows],
  }), (error: unknown) => error instanceof SepidarOpeningChequePlanError && error.code === 'INVALID_POSTING');
});

test('the complete source chain and latest state are required before projecting current custody', () => {
  const evidence = bankHistory();
  const [deposit, collected] = evidence.events;
  const [instrument] = evidence.instruments;
  const rejects = (candidate: SepidarOpeningChequeEvidence, code: string) =>
    assert.throws(() => previewSepidarOpeningCheques(candidate),
      (error: unknown) => error instanceof SepidarOpeningChequePlanError && error.code === code);
  rejects({ ...evidence, events: [deposit] }, 'INVALID_HISTORY');
  rejects({ ...evidence, instruments: [{ ...instrument, lastHistoryId: deposit.id, currentState: 2 }], events: [deposit] }, 'OPEN_HISTORY');
  rejects({ ...evidence, events: [deposit, { ...collected, document: { ...collected.document, chequeId: 'another-cheque' } }] }, 'INVALID_DOCUMENT');
  rejects({ ...evidence, events: [deposit, { ...collected, posting: {
    ...collected.posting, reference: { ...collected.posting.reference, targetId: 'unrelated-bank' },
  } }] }, 'INVALID_POSTING');
  rejects({ ...evidence, ledgerLines: evidence.ledgerLines.slice(0, 3) }, 'INVALID_POSTING');
});

test('a grouped source bank row can be split across exact cheque postings with any remainder disclosed', () => {
  const original = bankHistory();
  const [first] = original.instruments;
  const sharedLineId = '84';
  const evidence: SepidarOpeningChequeEvidence = {
    ...original,
    openingLines: original.openingLines.map(line => ({ ...line, amountRials: 200n })),
    instruments: [first, { ...first, id: '2', serialNumber: '54321', sourceReceiptHeaderId: '46',
      basisHistoryId: '30b', lastHistoryId: '32b' }],
    events: [...original.events, ...original.events.map(event => ({
      ...event, id: `${event.id}b`, chequeId: '2', previousHistoryId: `${event.previousHistoryId}b`,
      document: { ...event.document, chequeId: '2', itemId: `${event.document.itemId}b`,
        ...(event.document.kind === 'BANKING' && event.document.previousItemId
          ? { previousItemId: `${event.document.previousItemId}b` } : {}) },
      posting: { ...event.posting, voucherId: `${event.posting.voucherId}-b`,
        lines: event.posting.lines.map(line => ({ ...line, targetLineId: `${line.targetLineId}-b`,
          sourceLineId: line.sourceLineId === sharedLineId ? sharedLineId : `${line.sourceLineId}b` })) },
    }))],
    ledgerLines: [...original.ledgerLines.map(line => line.id === sharedLineId ? { ...line, signedRials: 215n } : line),
      ...original.ledgerLines.filter(line => line.id !== sharedLineId)
        .map(line => ({ ...line, id: `${line.id}b`, description: line.description.replace('12345', '54321') }))],
  };
  const preview = previewSepidarOpeningCheques(evidence);
  assert.deepEqual(preview.instruments.map(cheque => cheque.finalStatus), ['CLEARED', 'CLEARED']);
  assert.deepEqual(preview.sourceLedgerResiduals, [{ sourceLineId: '84', voucherId: '72', signedRials: 15n }]);
  assert.throws(() => previewSepidarOpeningCheques({ ...evidence,
    ledgerLines: evidence.ledgerLines.map(line => line.id === sharedLineId ? { ...line, signedRials: 199n } : line),
  }), (error: unknown) => error instanceof SepidarOpeningChequePlanError && error.code === 'INVALID_POSTING');
});

test('a nontrade assignment returns to custody before the separate return to the original customer', async () => {
  const original = bankHistory();
  const assignmentAt = '2026-04-14T08:00:00.000Z';
  const evidence: SepidarOpeningChequeEvidence = {
    ...original,
    instruments: [{ ...original.instruments[0], currentState: 64, lastHistoryId: '33' }],
    events: [
      { id: '31', chequeId: '1', previousHistoryId: '30', occurredAt: depositAt, state: 32, type: 23,
        document: { kind: 'PAYMENT', type: 1, chequeId: '1', itemId: '51', headerId: '61',
          voucherId: '71', recipientDetailId: 'recipient-detail' },
        posting: { voucherId: 'assignment-voucher', bookId: 'book',
          reference: { kind: 'PAYMENT_RECIPIENT', sourceId: 'recipient-detail', targetId: 'recipient' },
          lines: [{ sourceLineId: '81', targetLineId: 'assignment-credit', targetAccountId: 'custody', signedRials: -100n },
            { sourceLineId: '82', targetLineId: 'assignment-debit', targetAccountId: 'partner-current', signedRials: 100n }] },
      },
      { id: '32', chequeId: '1', previousHistoryId: '31', occurredAt: collectAt, state: 1, type: 53,
        document: { kind: 'REFUND', type: 4, chequeId: '1', itemId: '52', headerId: '62',
          voucherId: '72', recipientDetailId: 'recipient-detail' },
        posting: { voucherId: 'reversal-voucher', bookId: 'book',
          reference: { kind: 'PAYMENT_RECIPIENT', sourceId: 'recipient-detail', targetId: 'recipient' },
          lines: [{ sourceLineId: '83', targetLineId: 'reversal-debit', targetAccountId: 'custody', signedRials: 100n },
            { sourceLineId: '84', targetLineId: 'reversal-credit', targetAccountId: 'partner-current', signedRials: -100n }] },
      },
      { id: '33', chequeId: '1', previousHistoryId: '32', occurredAt: assignmentAt, state: 64, type: 51,
        document: { kind: 'REFUND', type: 1, chequeId: '1', itemId: '53', headerId: '63',
          voucherId: '73', recipientDetailId: '20' },
        posting: { voucherId: 'return-voucher', bookId: 'book',
          reference: { kind: 'CUSTOMER', sourceId: '20', targetId: 'party' },
          lines: [{ sourceLineId: '85', targetLineId: 'return-credit', targetAccountId: 'custody', signedRials: -100n },
            { sourceLineId: '86', targetLineId: 'receivable-debit', targetAccountId: 'receivable', signedRials: 100n }] },
      },
    ],
    ledgerLines: [
      { id: '81', voucherId: '71', issuerKind: 'PAYMENT', issuerHeaderId: '61', accountId: 118, detailId: '20', signedRials: -100n, description: 'Assigned (12345)' },
      { id: '82', voucherId: '71', issuerKind: 'PAYMENT', issuerHeaderId: '61', accountId: 124, detailId: 'recipient-detail', signedRials: 100n, description: 'Pay recipient' },
      { id: '83', voucherId: '72', issuerKind: 'REFUND', issuerHeaderId: '62', accountId: 118, detailId: '20', signedRials: 100n, description: 'Refund (12345)' },
      { id: '84', voucherId: '72', issuerKind: 'REFUND', issuerHeaderId: '62', accountId: 124, detailId: 'recipient-detail', signedRials: -100n, description: 'Refund from recipient' },
      { id: '85', voucherId: '73', issuerKind: 'REFUND', issuerHeaderId: '63', accountId: 118, detailId: '20', signedRials: -100n, description: 'Return (12345)' },
      { id: '86', voucherId: '73', issuerKind: 'REFUND', issuerHeaderId: '63', accountId: 117, detailId: '20', signedRials: 100n, description: 'Return to customer' },
    ],
  };
  const [cheque] = previewSepidarOpeningCheques(evidence).instruments;
  assert.deepEqual(cheque.events.map(event => [event.eventType, event.status]), [
    ['ENDORSED', 'ENDORSED'], ['RECIPIENT_RETURNED', 'RECEIVED'], ['RETURNED', 'RETURNED'],
  ]);
  assert.equal(cheque.currentCustodyRials, 0n);
  assert.equal(cheque.clearedRials, 0n);

  const [assigned] = evidence.events;
  const trade: SepidarOpeningChequeEvidence = {
    ...evidence, instruments: [{ ...evidence.instruments[0], currentState: 32, lastHistoryId: '31',
      sayadId: '1234567890123456' }], events: [{ ...assigned,
      document: { ...assigned.document, type: 256 },
      posting: { ...assigned.posting, reference: { kind: 'SUPPLIER', sourceId: 'recipient-detail',
        targetId: 'supplier', supplierCheckId: 'supplier-check' } },
    }], ledgerLines: evidence.ledgerLines.slice(0, 2).map(line => line.accountId === 124 ? { ...line, accountId: 193 } : line),
  };
  assert.equal(previewSepidarOpeningCheques(trade).instruments[0].finalStatus, 'ENDORSED');
  await assert.rejects(bankApplicationFixture(trade).run, { code: 'UNSUPPORTED_POSTING_OWNER' });
  await assert.rejects(() => bankApplicationFixture(evidence).run(applySepidarOpeningBankAndCustomerReturnHistories),
    { code: 'UNSUPPORTED_POSTING_OWNER' });
  const recipientFixture = bankApplicationFixture(evidence);
  const apply = () => recipientFixture.run(applySepidarOpeningHistoricalRecipientHistories);
  const counter = recipientFixture.vouchers.get('assignment-voucher')!.lines.find(line => line.accountId === 'partner-current')!;
  counter.dimensions[0].memberId = 'another-recipient';
  await assert.rejects(apply, { code: 'INVALID_TARGET' });
  counter.dimensions[0].memberId = 'recipient';
  const [rule] = counter.account.dimensionRules.splice(0);
  await assert.rejects(apply, { code: 'INVALID_TARGET' });
  counter.account.dimensionRules.push(rule);
  assert.equal(Boolean(recipientFixture.state.instrument), false);
  const migrated = await apply();
  const events = recipientFixture.state.instrument?.events as Array<Record<string, unknown>>;
  assert.deepEqual(events.map(event => [event.eventType, event.fromCustodianId, event.toCustodianId]), [
    ['RECEIVED', null, 'till'], ['ENDORSED', 'till', null], ['RECIPIENT_RETURNED', null, 'till'], ['RETURNED', 'till', null],
  ]);
  assert.equal((events[1].evidence as { recipientDimensionMemberId: string }).recipientDimensionMemberId, 'recipient');
  assert.equal(migrated.planSha256, hashAccountingEvidence({ plan: previewSepidarOpeningCheques(evidence),
    custodyFinancialAccountId: 'till', lane: 'HISTORICAL_RECIPIENT' }));
  assert.equal((await apply()).instruments[0].replayed, true);
  assert.throws(() => previewSepidarOpeningCheques({ ...trade,
    instruments: [{ ...trade.instruments[0], sayadId: null }],
  }), (error: unknown) => error instanceof SepidarOpeningChequePlanError && error.code === 'INVALID_POSTING');
});

function bankApplicationFixture(evidence = bankHistory()) {
  const plan = previewSepidarOpeningCheques(evidence);
  const [cheque] = plan.instruments;
  const ledgerLine = (id: string, accountId: string, amount: bigint, bank = false, evidencePayload?: unknown) => {
    const historicalRecipient = accountId === 'partner-current';
    const codes: Record<string, string> = { custody: '111202', receivable: '111201', 'partner-current': '111303', payable: '211001' };
    return {
      id, accountId, partyId: accountId === 'payable' ? 'supplier' : bank || historicalRecipient ? null : 'party', financialAccountId: bank ? 'bank' : null,
      dimensions: historicalRecipient ? [{ dimensionTypeId: 'historical-detail', memberId: 'recipient' }] : [],
      account: { bookId: 'book', code: codes[accountId] ?? accountId,
        dimensionRules: historicalRecipient ? [{ dimensionTypeId: 'historical-detail', requirement: 'OPTIONAL' }] : [] },
      debitRials: amount > 0n ? amount : 0n, creditRials: amount < 0n ? -amount : 0n,
      evidenceType: 'SEPIDAR_ACC_VOUCHER_ITEM', evidencePayload, evidenceHash: evidencePayload ? hashAccountingEvidence(evidencePayload) : null,
    };
  };
  const voucher = (at: string, sourceType: string, sourceId: string, sourcePayload: unknown,
    lines: ReturnType<typeof ledgerLine>[]) => ({
    bookId: 'book', status: 'POSTED', documentDate: new Date(at), occurredAt: new Date(at), reversalOfId: null,
    sourceType, sourceId, sourceVersion: 1, sourceHash: hashAccountingEvidence(sourcePayload), lines, reversals: [] as { id: string }[],
  });
  const voucherSource = (event: typeof cheque.events[number]) => ({
    snapshotSha256: plan.snapshotSha256, sourceInstrumentId: cheque.instrument.id, historyId: event.historyId,
    previousHistoryId: event.previousHistoryId, document: event.document,
    ...(event.targetPosting.reference.historicalSupplierSettlement ? { supplierPartyId: 'supplier', ...event.targetPosting.reference.historicalSupplierSettlement }
      : event.targetPosting.reference.kind === 'PAYMENT_RECIPIENT' ? { recipientDimensionMemberId: 'recipient' }
        : event.targetPosting.reference.kind === 'CUSTOMER' ? { customerPartyId: 'party' } : { bankFinancialAccountId: 'bank' }),
    allocations: event.targetPosting.lines.map(({ sourceLineId, signedRials, targetAccountId, tracking }) =>
      ({ sourceLineId, signedRials: signedRials.toString(), targetAccountId, ...(tracking ? { tracking } : {}) })),
  });
  const vouchers = new Map([
    [plan.openingVoucherId, voucher(basis, 'SEPIDAR_CHEQUE_OPENING', plan.sourceOpeningVoucherId, {
      snapshotSha256: plan.snapshotSha256, sourceOpeningVoucherId: plan.sourceOpeningVoucherId, basisAt: plan.basisAt,
    }, [ledgerLine(cheque.opening.targetLineId, cheque.opening.targetAccountId, 100n)])],
    ...cheque.events.map(event => [event.targetPosting.voucherId, voucher(event.occurredAt, 'SEPIDAR_CHEQUE_EVENT', event.historyId, voucherSource(event),
      event.targetPosting.lines.map(line => ledgerLine(line.targetLineId, line.targetAccountId,
      line.signedRials, line.targetAccountId === 'cash', line.tracking ? { snapshotSha256: plan.snapshotSha256,
        row: { VoucherItemId: line.sourceLineId, VoucherRef: event.document.voucherId, ...line.tracking } } : undefined)))] as const),
  ]);
  const active = { legalEntityId: 'entity', activeFrom: new Date('2020-01-01'), activeTo: null };
  const supplierEvent = cheque.events.find(event => event.targetPosting.reference.historicalSupplierSettlement);
  const historical = supplierEvent?.targetPosting.reference.historicalSupplierSettlement;
  const supplierBinding = { targetId: 'supplier', reviewStatus: 'USER_APPROVED', reviewedBy: 'reviewer', reviewEvidence: historical?.reviewSha256 };
  const supplierSettlement = supplierEvent && { voucherId: supplierEvent.targetPosting.voucherId,
    supplierPartyId: 'supplier', kind: 'ASSIGNED_CUSTOMER_CHECK', financialAccountId: null,
    amountRials: cheque.instrument.amountRials, occurredAt: new Date(supplierEvent.occurredAt),
    sourceType: 'SEPIDAR_CHEQUE_SUPPLIER_ENDORSEMENT', sourceId: supplierEvent.historyId, sourceVersion: 1,
    sourcePayload: voucherSource(supplierEvent), sourceHash: hashAccountingEvidence(voucherSource(supplierEvent)),
    allocations: [] as { id: string }[], payableChecks: [] as { id: string }[],
  };
  const state = { allowed: true, failOnAnchor: false, rejectDuplicate: false, locks: 0, readOnlyTransactions: 0,
    instrument: null as Record<string, unknown> | null, anchor: null as Record<string, unknown> | null };
  const database = {
    $transaction: async (operation: (tx: unknown) => unknown, options: { isolationLevel: string }) => {
      assert.ok(['Serializable', 'RepeatableRead'].includes(options.isolationLevel));
      const txState = structuredClone(state);
      const tx = {
        $queryRaw: async (sql: TemplateStringsArray) => {
          if (options.isolationLevel === 'RepeatableRead') assert.match(sql.join(' '), /sepidar_opening_cheques_runtime_admitted/);
          return [{ admitted: txState.allowed }];
        },
        $executeRaw: async (sql: TemplateStringsArray) => {
          if (options.isolationLevel === 'RepeatableRead') {
            assert.equal(sql[0], 'SET TRANSACTION READ ONLY');
            txState.readOnlyTransactions++;
          } else {
            txState.locks++;
          }
        },
        accountingBook: { findUnique: async () => ({ legalEntityId: 'entity' }) },
        accountingFinancialAccount: { findUnique: async ({ where: { id } }) =>
          ({ ...active, id, kind: id === 'till' ? 'CASH' : 'BANK', currency: 'IRR' }) },
        accountingCustomerProfile: { findUnique: async () => ({ ...active, accountingPartyId: 'party' }) },
        accountingParty: { findUnique: async ({ where: { id } }) => id === 'supplier' ? {
          ...active, id, roles: [{ role: 'SUPPLIER', effectiveFrom: active.activeFrom, effectiveTo: null }],
        } : null },
        accountingSepidarTargetLink: { findUnique: async ({ where: { bookId_sourceTable_sourceKey_targetKind: ids } }) =>
          ids.sourceTable === 'GNR.Party' && ids.sourceKey === historical?.sourcePartyId ? supplierBinding : null },
        accountingSupplierSettlementTransaction: { findUnique: async ({ where: { id } }) => id === historical?.settlementId ? supplierSettlement : null },
        accountingDimensionMember: { findUnique: async ({ where: { id } }) => id === 'recipient' ? ({
          id, sourceId: 'recipient-detail', dimensionTypeId: 'historical-detail', effectiveFrom: active.activeFrom, effectiveTo: null,
          dimensionType: { bookId: 'book', code: 'SEPIDAR_DL', sourceKind: 'SEPIDAR_ACC_DL', effectiveFrom: active.activeFrom, effectiveTo: null },
        }) : null },
        accountingLedgerVoucher: { findUnique: async ({ where: { id } }) => vouchers.get(id) },
        accountingSepidarOpeningCheque: {
          findMany: async () => txState.anchor ? [txState.anchor] : [],
          findUnique: async () => txState.anchor ? { ...txState.anchor, instrument: txState.instrument } : null,
          create: async ({ data }) => {
            if (txState.failOnAnchor) throw new Error('anchor write failed');
            txState.anchor = data;
          },
        },
        accountingCheckInstrument: {
          findFirst: async () => txState.rejectDuplicate ? { id: 'existing-check' } : null,
          create: async ({ data: { events, ...record } }) => {
            txState.instrument = { id: 'instrument', ...record, receipt: null,
              events: events.create.map(event => ({ ...event, id: 'event-' + event.sequence, postingRuleVersion: null })) };
            return { id: 'instrument', events: [{ id: 'event-1' }] };
          },
        },
      };
      const result = await operation(tx);
      Object.assign(state, txState);
      return result;
    },
  } as unknown as Parameters<typeof applySepidarOpeningBankHistories>[0];
  const input = { evidence, custodyFinancialAccountId: 'till', actor: { id: 'accountant', profile: 'ACCOUNTANT' as const } };
  const run = async (apply = applySepidarOpeningBankHistories) => {
    const previous = process.env.DEPLOYMENT_RELEASE_ID;
    process.env.DEPLOYMENT_RELEASE_ID = 'fixture-release';
    try {
      return await apply(database, input);
    } finally {
      if (previous === undefined) delete process.env.DEPLOYMENT_RELEASE_ID;
      else process.env.DEPLOYMENT_RELEASE_ID = previous;
    }
  };
  return { run, inspect: () => inspectSepidarOpeningChequeTargets(database, input), state, vouchers, supplierBinding, supplierSettlement };
}

test('historical supplier endorsement retains the payable and accepts a source cheque without Sayad', async () => {
  const original = bankHistory();
  const [deposit] = original.events;
  const historicalSupplierSettlement = { settlementId: 'historical-settlement', sourcePartyId: 'supplier-source', reviewSha256: hash };
  const evidence: SepidarOpeningChequeEvidence = {
    ...original, instruments: [{ ...original.instruments[0], lastHistoryId: '31', currentState: 32 }],
    events: [{ ...deposit, state: 32, type: 23, document: { kind: 'PAYMENT', type: 256, chequeId: '1', itemId: '51',
      headerId: '61', voucherId: '71', recipientDetailId: 'supplier-detail' },
    posting: { ...deposit.posting, reference: { kind: 'SUPPLIER', sourceId: 'supplier-detail', targetId: 'supplier', historicalSupplierSettlement },
      lines: deposit.posting.lines.map(line => line.signedRials > 0n ? { ...line, targetAccountId: 'payable' } : line) } }],
    ledgerLines: original.ledgerLines.slice(0, 2).map(line => ({ ...line, issuerKind: 'PAYMENT', ...(line.signedRials > 0n
      ? { accountId: 193, detailId: 'supplier-detail' } : {}) })),
  };
  const { run, state, supplierSettlement, supplierBinding, vouchers } = bankApplicationFixture(evidence);
  assert.ok(supplierSettlement);
  const apply = () => run(applySepidarOpeningHistoricalSupplierHistories);
  await assert.rejects(() => run(applySepidarOpeningHistoricalRecipientHistories), { code: 'UNSUPPORTED_POSTING_OWNER' });
  supplierBinding.reviewEvidence = 'wrong-review';
  await assert.rejects(apply, { code: 'INVALID_TARGET' });
  supplierBinding.reviewEvidence = hash;
  supplierSettlement.allocations.push({ id: 'invented-allocation' });
  await assert.rejects(apply, { code: 'INVALID_TARGET' });
  supplierSettlement.allocations.pop();
  const payable = vouchers.get(deposit.posting.voucherId)!.lines.find(line => line.accountId === 'payable')!;
  payable.account.code = '211002';
  await assert.rejects(apply, { code: 'INVALID_TARGET' });
  payable.account.code = '211001';
  assert.equal(Boolean(state.instrument), false);
  assert.equal((await apply()).instruments[0].replayed, false);
  assert.equal(state.instrument?.status, 'ENDORSED');
  assert.equal(state.instrument?.sayadId, null);
  assert.equal(state.instrument?.custodianId, null);
  const events = state.instrument?.events as Array<Record<string, unknown>>;
  assert.equal((events[1].evidence as { settlementId: string }).settlementId, historicalSupplierSettlement.settlementId);
  assert.equal((await apply()).instruments[0].replayed, true);
});

test('direct historical customer return links the exact posted voucher and releases custody', async () => {
  const original = bankHistory();
  const [deposit] = original.events;
  const evidence: SepidarOpeningChequeEvidence = {
    ...original, instruments: [{ ...original.instruments[0], lastHistoryId: '31', currentState: 64 }],
    events: [{ ...deposit, state: 64, type: 51,
      document: { kind: 'REFUND', type: 1, chequeId: '1', itemId: '51', headerId: '61', voucherId: '71', recipientDetailId: '20' },
      posting: { ...deposit.posting, voucherId: 'return-voucher', reference: { kind: 'CUSTOMER', sourceId: '20', targetId: 'party' },
        lines: deposit.posting.lines.map(line => line.signedRials > 0n ? { ...line, targetAccountId: 'receivable' } : line) } }],
    ledgerLines: original.ledgerLines.slice(0, 2).map(line => ({ ...line, issuerKind: 'REFUND', accountId: line.signedRials > 0n ? 117 : 118 })),
  };
  const { run, state, vouchers } = bankApplicationFixture(evidence);
  const apply = () => run(applySepidarOpeningBankAndCustomerReturnHistories);
  state.allowed = false;
  await assert.rejects(apply, { code: 'ADMISSION_CLOSED' });
  assert.equal(state.locks, 0);
  state.allowed = true;
  await assert.rejects(run, { code: 'UNSUPPORTED_POSTING_OWNER' });
  const voucher = vouchers.get('return-voucher')!;
  const debit = voucher.lines.find(line => line.accountId === 'receivable')!;
  debit.account.code = '111203';
  await assert.rejects(apply, { code: 'INVALID_TARGET' });
  debit.account.code = '111201';
  debit.partyId = 'other-customer';
  await assert.rejects(apply, { code: 'INVALID_TARGET' });
  debit.partyId = 'party';
  voucher.reversals.push({ id: 'already-reversed' });
  await assert.rejects(apply, { code: 'INVALID_TARGET' });
  assert.equal(Boolean(state.instrument), false);
  voucher.reversals.pop();
  const result = await apply();
  assert.equal(result.planSha256, hashAccountingEvidence({ plan: previewSepidarOpeningCheques(evidence),
    custodyFinancialAccountId: 'till', lane: 'BANK_AND_CUSTOMER_RETURN' }));
  assert.equal(state.instrument?.status, 'RETURNED');
  assert.equal(state.instrument?.clearedRials, '0');
  assert.equal(state.instrument?.receipt, null);
  const events = state.instrument?.events as Array<Record<string, unknown>>;
  assert.deepEqual(events.map(event => [event.eventType, event.ledgerVoucherId, event.fromCustodianId, event.toCustodianId]), [
    ['RECEIVED', null, null, 'till'], ['RETURNED', 'return-voucher', 'till', null],
  ]);
  assert.deepEqual((await apply()).instruments, [{ instrumentId: 'instrument', replayed: true }]);
});

test('review and application bind original tracking to its allocated ledger row', async () => {
  const original = bankHistory();
  const tracking = { TrackingNumber: ' 001234 ', TrackingDate: '2026-04-03T00:00:00.0000000' };
  const evidence = { ...original, ledgerLines: original.ledgerLines.map(line =>
    line.id === '84' ? { ...line, tracking } : line) };
  const [cheque] = previewSepidarOpeningCheques(evidence).instruments;
  assert.deepEqual(cheque.events[1].targetPosting.lines.find(line => line.sourceLineId === '84')?.tracking, tracking);
  const eventsWithTargetTracking = original.events.map(event => ({ ...event, posting: {
    ...event.posting, lines: event.posting.lines.map(line => ({ ...line, tracking })),
  } }));
  assert.deepEqual(previewSepidarOpeningCheques({ ...original, events: eventsWithTargetTracking }),
    previewSepidarOpeningCheques(original));
  assert.throws(() => previewSepidarOpeningCheques({ ...original, ledgerLines: original.ledgerLines.map(line =>
    line.id === '84' ? { ...line, tracking: { ...tracking, TrackingDate: '2026-02-30' } } : line) }), { code: 'INVALID_POSTING' });

  const fixture = bankApplicationFixture(evidence);
  const trackedLine = fixture.vouchers.get('collect-voucher')!.lines.find(line => line.id === 'collect-debit')!;
  const originalPayload = trackedLine.evidencePayload;
  trackedLine.evidencePayload = { row: { ...tracking, TrackingNumber: '999999' } };
  await assert.rejects(fixture.run, { code: 'INVALID_TARGET' });
  assert.equal(fixture.state.instrument, null);
  trackedLine.evidencePayload = originalPayload;
  assert.equal((await fixture.run()).instruments[0].replayed, false);
});

test('bank history application closes admission before locking or writing', async () => {
  const { run, state } = bankApplicationFixture();
  state.allowed = false;
  await assert.rejects(run, { code: 'ADMISSION_CLOSED' });
  assert.equal(state.locks, 0);
  assert.equal(state.instrument, null);
  assert.equal(state.anchor, null);
});

test('bank history application anchors the opening amount and replays only the exact terminal outcome', async () => {
  const { run, state } = bankApplicationFixture();
  const applied = await run();
  assert.deepEqual(applied.instruments, [{ instrumentId: 'instrument', replayed: false }]);
  assert.equal(state.anchor?.amountRials, '100');
  assert.equal(state.anchor?.openingLedgerLineId, 'opening-line');
  assert.equal(state.anchor?.openingEventId, 'event-1');
  assert.equal(state.instrument?.status, 'CLEARED');
  assert.equal(state.instrument?.clearedRials, '100');
  assert.equal(state.instrument?.custodianId, null);
  assert.equal(state.instrument?.receipt, null);
  const events = state.instrument?.events as Array<Record<string, unknown>>;
  assert.deepEqual(events.map(event => [event.eventType, event.ledgerVoucherId, event.fromCustodianId, event.toCustodianId]), [
    ['RECEIVED', null, null, 'till'],
    ['DEPOSITED', 'deposit-voucher', 'till', 'bank'],
    ['CLEARED', 'collect-voucher', 'bank', null],
  ]);
  assert.deepEqual((await run()).instruments, [{ instrumentId: 'instrument', replayed: true }]);
  assert(state.anchor);
  state.anchor.planSha256 = 'different';
  await assert.rejects(run, { code: 'REPLAY_CONFLICT' });
});

test('bank history rejects a mismatched opening amount or bank dimension before any write', async () => {
  const { run, state, vouchers } = bankApplicationFixture();
  const opening = vouchers.get('opening-voucher')!;
  opening.lines[0].debitRials = 99n;
  await assert.rejects(run, { code: 'OPENING_AMOUNT_CONFLICT' });
  opening.lines[0].debitRials = 100n;
  const collected = vouchers.get('collect-voucher')!;
  collected.lines.find(line => line.accountId === 'cash')!.financialAccountId = 'unreviewed-bank';
  await assert.rejects(run, { code: 'INVALID_TARGET' });
  assert.equal(state.instrument, null);
  assert.equal(state.anchor, null);
});

test('bank history fails on existing instruments and rolls back its canonical rows if anchoring fails', async () => {
  const { run, state } = bankApplicationFixture();
  state.rejectDuplicate = true;
  await assert.rejects(run, { code: 'IDENTITY_CONFLICT' });
  state.rejectDuplicate = false;
  state.failOnAnchor = true;
  await assert.rejects(run, /anchor write failed/);
  assert.equal(state.instrument, null);
  assert.equal(state.anchor, null);
  state.failOnAnchor = false;
  assert.equal((await run()).instruments[0].replayed, false);
});

test('inspecting cheque targets stays read-only and flags a reversed voucher while admission is closed', async () => {
  const { inspect, state, vouchers } = bankApplicationFixture();
  state.allowed = false;
  const inspected = await inspect();
  assert.equal(inspected.instruments, 1);
  assert.equal(inspected.subsequentEvents, 2);
  assert.equal(state.readOnlyTransactions, 1);
  assert.equal(state.locks, 0);
  assert.equal(state.anchor, null);
  assert.equal(state.instrument, null);
  const eventVoucher = [...vouchers.values()].find(voucher => voucher.sourceType === 'SEPIDAR_CHEQUE_EVENT');
  assert.ok(eventVoucher);
  eventVoucher.reversals.push({ id: 'reversal' });
  await assert.rejects(inspect, { code: 'INVALID_TARGET' });
});

test('cheque voucher preparation balances custody against the approved clearing and preserves event owners', () => {
  const evidence = bankHistory();
  const prepared = prepareSepidarOpeningChequeVouchers(evidence, { clearingAccountId: 'opening-transfer' });
  assert.equal(prepared.opening.source.type, 'SEPIDAR_CHEQUE_OPENING');
  assert.equal(prepared.events.length, 2);
  assert.deepEqual(prepared.opening.lines.map(({ accountId, debitRials, creditRials, partyId }) =>
    [accountId, debitRials, creditRials, partyId]), [
    ['custody', 100n, 0n, 'party'], ['opening-transfer', 0n, 100n, undefined],
  ]);
  const bankLine = prepared.events[1].lines.find(line => line.financialAccountId === 'bank');
  assert.equal(bankLine?.debitRials, 100n);
  assert.equal(bankLine?.partyId, undefined);
  for (const command of prepared.events) {
    assert.equal(command.source.hash, hashAccountingEvidence(command.source.payload));
    assert.equal(command.lines.reduce((net, line) => net + line.debitRials - line.creditRials, 0n), 0n);
  }
  assert.throws(() => prepareSepidarOpeningChequeVouchers(evidence, { clearingAccountId: 'custody' }), { code: 'INVALID_TARGET' });
});

test('the combined cheque batch binds the prepared ledger period and closes before acquiring write locks', async () => {
  const fixture = bankApplicationFixture();
  const actor = { id: 'accountant', profile: 'ACCOUNTANT' as const };
  const evidence = bankHistory();
  const target = { evidence, custodyFinancialAccountId: 'till', clearingAccountId: 'opening-transfer',
    fiscalYearId: 'fiscal-year', periodId: 'opening-period' };
  assert.notEqual(sepidarOpeningChequeBatchDigest(target),
    sepidarOpeningChequeBatchDigest({ ...target, periodId: 'different-period' }));
  fixture.state.allowed = false;
  await assert.rejects(fixture.run(database => applySepidarOpeningChequeBatch(database, { ...target, actor })),
    { code: 'ADMISSION_CLOSED' });
  assert.equal(fixture.state.locks, 0);
  assert.equal(fixture.state.instrument, null);
});

test('combined cheque admission preview reads the exact batch without posting', async () => {
  const fixture = bankApplicationFixture();
  const target = { evidence: bankHistory(), custodyFinancialAccountId: 'till', clearingAccountId: 'opening-transfer',
    fiscalYearId: 'fiscal-year', periodId: 'opening-period' };
  const actor = { id: 'accountant', profile: 'ACCOUNTANT' as const };
  const inspect = () => fixture.run(async database => {
    const preview = await inspectSepidarOpeningChequeBatchAdmission(database, { ...target, actor });
    assert.deepEqual(preview, { planSha256: sepidarOpeningChequeBatchDigest(target), instrumentCount: 1, eventCount: 2 });
    // Match the fixture's application runner result type.
    return { planSha256: preview.planSha256, instruments: [] };
  });
  await inspect();
  assert.equal(fixture.state.readOnlyTransactions, 1);
  assert.equal(fixture.state.locks, 0);
  assert.equal(fixture.state.instrument, null);
  fixture.state.allowed = false;
  await assert.rejects(inspect, { code: 'ADMISSION_CLOSED' });
});
