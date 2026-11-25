import assert from 'node:assert/strict';
import test from 'node:test';
import { previewSepidarOpeningCheques, SepidarOpeningChequePlanError, type SepidarOpeningChequeEvidence } from '../sepidarOpeningChequePlan';

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

test('a nontrade assignment returns to custody before the separate return to the original customer', () => {
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
  assert.throws(() => previewSepidarOpeningCheques({ ...trade,
    instruments: [{ ...trade.instruments[0], sayadId: null }],
  }), (error: unknown) => error instanceof SepidarOpeningChequePlanError && error.code === 'INVALID_POSTING');
});
