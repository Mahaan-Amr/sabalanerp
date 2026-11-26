type ChequeStatus = 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'ENDORSED' | 'RETURNED';
type DocumentKind = 'BANKING' | 'PAYMENT' | 'REFUND';
type ReferenceKind = 'BANK' | 'SUPPLIER' | 'PAYMENT_RECIPIENT' | 'CUSTOMER';

type SourceDocument = Readonly<{
  chequeId: string; itemId: string; headerId: string; voucherId: string;
}> & (
  | Readonly<{ kind: 'BANKING'; type: number; bankAccountId: string | null; bankDetailId: string | null; previousItemId: string | null }>
  | Readonly<{ kind: 'PAYMENT' | 'REFUND'; type: number; recipientDetailId: string }>
);

type PostingReference = Readonly<{
  kind: ReferenceKind; sourceId: string; targetId: string; supplierCheckId?: string;
}>;
type PostingLine = Readonly<{
  sourceLineId: string; targetLineId: string; targetAccountId: string; signedRials: bigint;
}>;
type SourceTracking = Readonly<{ TrackingNumber: string | null; TrackingDate: string | null }>;
type ReviewedPosting = Readonly<{
  voucherId: string; bookId: string; reference: PostingReference; lines: readonly PostingLine[];
}>;

type SourceEvent = Readonly<{
  id: string; chequeId: string; previousHistoryId: string; occurredAt: string; state: number; type: number;
  document: SourceDocument; posting: ReviewedPosting;
}>;

type SourceInstrument = Readonly<{
  id: string; sourceDetailId: string; sourceReceiptHeaderId: string; basisHistoryId: string; lastHistoryId: string; currentState: number;
  serialNumber: string; sayadId: string | null; sourceBankId: string; bankName: string; maturityAt: string;
  amountRials: bigint; sourceOpeningLineId: string;
  target: Readonly<{ profileId: string; partyId: string; openingPostingLineId: string }>;
}>;

type SourceLedgerLine = Readonly<{
  id: string; voucherId: string; issuerKind: DocumentKind; issuerHeaderId: string;
  accountId: number; detailId: string | null; signedRials: bigint; description: string; tracking?: SourceTracking;
}>;

function validTrackingDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z?)?$/.test(value)) return false;
  const parsed = new Date(value.includes('T') && !value.endsWith('Z') ? `${value}Z` : value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value.slice(0, 10));
}

export type SepidarOpeningChequeEvidence = Readonly<{
  snapshotSha256: string; bookId: string; openingVoucherId: string; sourceOpeningVoucherId: string; basisAt: string; throughAt: string;
  instruments: readonly SourceInstrument[];
  openingLines: readonly Readonly<{ id: string; voucherId: string; sourceDetailId: string; amountRials: bigint; targetAccountId: string }>[];
  events: readonly SourceEvent[];
  ledgerLines: readonly SourceLedgerLine[];
}>;

type Effect = Readonly<{
  eventType: 'DEPOSITED' | 'CLEARED' | 'ENDORSED' | 'RECIPIENT_RETURNED' | 'RETURNED';
  status: ChequeStatus; referenceKind: ReferenceKind; sourceReferenceId: string;
  asset: number; assetSign: 1n | -1n; counterAccounts: readonly number[]; counterDetailId?: string;
}>;

type PlannedChequeEvent = {
  historyId: string;
  previousHistoryId: string;
  sequence: number;
  eventType: Effect['eventType'];
  status: ChequeStatus;
  occurredAt: string;
  document: SourceDocument;
  targetPosting: Omit<ReviewedPosting, 'lines'> & { lines: readonly (PostingLine & { tracking?: SourceTracking })[] };
};

type ErrorCode = 'INVALID_SCOPE' | 'INVALID_INSTRUMENT' | 'INVALID_OPENING_LINE' | 'INVALID_HISTORY'
  | 'UNSUPPORTED_HISTORY' | 'INVALID_DOCUMENT' | 'INVALID_POSTING' | 'OPEN_HISTORY';

export class SepidarOpeningChequePlanError extends Error {
  constructor(readonly code: ErrorCode, readonly sourceId: string) {
    super(`${code}: ${sourceId}`);
  }
}

function requireEvidence(condition: unknown, code: ErrorCode, id: string): asserts condition {
  if (!condition) throw new SepidarOpeningChequePlanError(code, id);
}

const present = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim() !== '';
const normalizedInstant = (value: string) => {
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
};

function addUnique(values: Set<string>, value: string, code: ErrorCode, id: string) {
  requireEvidence(present(value) && !values.has(value), code, id);
  values.add(value);
}

function indexById<T extends { id: string }>(rows: readonly T[], code: ErrorCode) {
  const ids = new Set<string>();
  return new Map(rows.map(row => {
    addUnique(ids, row.id, code, row.id);
    return [row.id, row];
  }));
}

// Account IDs and document enums are from the reviewed 1405 Sepidar source.
const custody = 118;
const inCollection = 119;
const bank = 105;
const customerReceivable = 117;
const tradePayable = 193;
const payableDocuments = 194;
const paymentAccounts = [103, 124, payableDocuments];
const returnedPaymentAccounts = [103, 124];

function classify(event: SourceEvent, previous: SourceEvent | undefined, status: ChequeStatus, detail: string): Effect {
  const { document, state, type, id } = event;
  if (state === 2 && type === 31 && status === 'RECEIVED') {
    requireEvidence(document.kind === 'BANKING' && document.type === 1 && present(document.bankAccountId) && present(document.bankDetailId)
      && document.previousItemId === null, 'INVALID_DOCUMENT', id);
    return { eventType: 'DEPOSITED', status: 'DEPOSITED', referenceKind: 'BANK', sourceReferenceId: document.bankAccountId,
      asset: custody, assetSign: -1n, counterAccounts: [inCollection], counterDetailId: detail };
  }
  if (state === 4 && type === 32 && status === 'DEPOSITED') {
    requireEvidence(document.kind === 'BANKING' && document.type === 2
      && previous?.document.kind === 'BANKING' && present(previous.document.bankAccountId)
      && present(previous.document.bankDetailId)
      && document.previousItemId === previous.document.itemId
      && (document.bankAccountId === null || document.bankAccountId === previous.document.bankAccountId)
      && (document.bankDetailId === null || document.bankDetailId === previous.document.bankDetailId), 'INVALID_DOCUMENT', id);
    return { eventType: 'CLEARED', status: 'CLEARED', referenceKind: 'BANK', sourceReferenceId: previous.document.bankAccountId,
      asset: inCollection, assetSign: -1n, counterAccounts: [bank], counterDetailId: previous.document.bankDetailId };
  }
  if (state === 32 && type === 23 && status === 'RECEIVED') {
    requireEvidence(document.kind === 'PAYMENT' && [1, 256].includes(document.type) && present(document.recipientDetailId),
      'INVALID_DOCUMENT', id);
    const trade = document.type === 256;
    return { eventType: 'ENDORSED', status: 'ENDORSED', referenceKind: trade ? 'SUPPLIER' : 'PAYMENT_RECIPIENT',
      sourceReferenceId: document.recipientDetailId, asset: custody, assetSign: -1n,
      counterAccounts: trade ? [tradePayable] : paymentAccounts, counterDetailId: document.recipientDetailId };
  }
  if (state === 1 && type === 53 && status === 'ENDORSED') {
    requireEvidence(document.kind === 'REFUND' && document.type === 4 && previous?.document.kind === 'PAYMENT'
      && previous.document.type === 1 && document.recipientDetailId === previous.document.recipientDetailId, 'INVALID_DOCUMENT', id);
    return { eventType: 'RECIPIENT_RETURNED', status: 'RECEIVED', referenceKind: 'PAYMENT_RECIPIENT',
      sourceReferenceId: document.recipientDetailId, asset: custody, assetSign: 1n,
      counterAccounts: returnedPaymentAccounts, counterDetailId: document.recipientDetailId };
  }
  if (state === 64 && type === 51 && status === 'RECEIVED') {
    requireEvidence(document.kind === 'REFUND' && document.type === 1 && document.recipientDetailId === detail, 'INVALID_DOCUMENT', id);
    return { eventType: 'RETURNED', status: 'RETURNED', referenceKind: 'CUSTOMER', sourceReferenceId: detail,
      asset: custody, assetSign: -1n, counterAccounts: [customerReceivable], counterDetailId: detail };
  }
  throw new SepidarOpeningChequePlanError('UNSUPPORTED_HISTORY', id);
}

const orderById = <T extends { id: string }>(a: T, b: T) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function chequeSerialInDescription(serial: string) {
  const literalSerial = serial.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${literalSerial}(?![\\p{L}\\p{N}])`, 'u');
}

/**
 * Compiles reviewed, source-bound evidence for the protected opening preview.
 * The caller must extract the complete reviewed instrument histories through the
 * given cutoff and resolve their document item/header, issuer and voucher rows
 * from the pinned snapshot. Destination IDs are accounting-reviewed bindings
 * for the target book. They carry no authorization to post or change custody.
 */
export function previewSepidarOpeningCheques(evidence: SepidarOpeningChequeEvidence) {
  const { snapshotSha256, bookId, openingVoucherId, sourceOpeningVoucherId, basisAt, throughAt } = evidence;
  requireEvidence(/^[a-f0-9]{64}$/.test(snapshotSha256) && present(bookId) && present(openingVoucherId)
    && present(sourceOpeningVoucherId) && normalizedInstant(basisAt) && normalizedInstant(throughAt) && basisAt < throughAt
    && evidence.instruments.length > 0, 'INVALID_SCOPE', bookId);
  const openingLines = indexById(evidence.openingLines, 'INVALID_OPENING_LINE');
  const ledgerLines = indexById(evidence.ledgerLines, 'INVALID_POSTING');
  const instruments = indexById(evidence.instruments, 'INVALID_INSTRUMENT');
  const historyIds = new Set<string>();
  const documentItemIds = new Set<string>();
  const targetVoucherIds = new Set([openingVoucherId]);
  const targetLineIds = new Set<string>();
  const sayadIds = new Set<string>();
  const openingUsage = new Map<string, { amountRials: bigint; targetLineId: string; partyId: string; profileId: string }>();
  const ledgerUsage = new Map<string, bigint>();
  const targetAccounts = new Map<number, string>();
  const targetReferences = new Map<string, string>();
  const supplierCheckOwners = new Map<string, string>();
  const targetCustomers = new Map<string, SourceInstrument['target']>();
  const eventsByInstrument = new Map<string, Map<string, SourceEvent>>();
  for (const event of [...evidence.events].sort(orderById)) {
    requireEvidence(instruments.has(event.chequeId), 'INVALID_HISTORY', event.id);
    addUnique(historyIds, event.id, 'INVALID_HISTORY', event.id);
    requireEvidence(present(event.previousHistoryId), 'INVALID_HISTORY', event.id);
    const chain = eventsByInstrument.get(event.chequeId) ?? new Map<string, SourceEvent>();
    requireEvidence(!chain.has(event.previousHistoryId), 'INVALID_HISTORY', event.id);
    chain.set(event.previousHistoryId, event);
    eventsByInstrument.set(event.chequeId, chain);
  }

  const plan = [...instruments.values()].sort(orderById).map(instrument => {
    const { id, sourceDetailId, basisHistoryId, lastHistoryId, amountRials, target } = instrument;
    addUnique(historyIds, basisHistoryId, 'INVALID_INSTRUMENT', id);
    requireEvidence(present(sourceDetailId) && present(instrument.sourceReceiptHeaderId)
      && present(instrument.serialNumber) && present(instrument.sourceBankId)
      && present(instrument.bankName) && normalizedInstant(instrument.maturityAt) && amountRials > 0n
      && present(target.profileId) && present(target.partyId), 'INVALID_INSTRUMENT', id);
    const customer = targetCustomers.get(sourceDetailId);
    requireEvidence(!customer || (customer.profileId === target.profileId && customer.partyId === target.partyId), 'INVALID_INSTRUMENT', id);
    targetCustomers.set(sourceDetailId, target);
    if (instrument.sayadId !== null) {
      requireEvidence(/^\d{16}$/.test(instrument.sayadId), 'INVALID_INSTRUMENT', id);
      addUnique(sayadIds, instrument.sayadId, 'INVALID_INSTRUMENT', id);
    }
    const opening = openingLines.get(instrument.sourceOpeningLineId);
    requireEvidence(opening && opening.voucherId === sourceOpeningVoucherId
      && opening.sourceDetailId === sourceDetailId && present(opening.targetAccountId), 'INVALID_OPENING_LINE', id);
    const priorCustodyAccount = targetAccounts.get(custody);
    requireEvidence(!priorCustodyAccount || priorCustodyAccount === opening.targetAccountId, 'INVALID_OPENING_LINE', id);
    targetAccounts.set(custody, opening.targetAccountId);
    const openingUsed = openingUsage.get(opening.id);
    if (!openingUsed) addUnique(targetLineIds, target.openingPostingLineId, 'INVALID_OPENING_LINE', id);
    requireEvidence(!openingUsed || (openingUsed.targetLineId === target.openingPostingLineId
      && openingUsed.partyId === target.partyId && openingUsed.profileId === target.profileId), 'INVALID_OPENING_LINE', id);
    openingUsage.set(opening.id, { amountRials: (openingUsed?.amountRials ?? 0n) + amountRials,
      targetLineId: target.openingPostingLineId, partyId: target.partyId, profileId: target.profileId });

    const chain = eventsByInstrument.get(id) ?? new Map<string, SourceEvent>();
    const serial = chequeSerialInDescription(instrument.serialNumber);
    let status: ChequeStatus = 'RECEIVED';
    let last: SourceEvent | undefined;
    const events: PlannedChequeEvent[] = [];
    for (let index = 0; index < chain.size; index++) {
      const event = chain.get(last?.id ?? basisHistoryId);
      requireEvidence(event && normalizedInstant(event.occurredAt) && event.occurredAt >= basisAt
        && event.occurredAt >= (last?.occurredAt ?? basisAt) && event.occurredAt <= throughAt, 'INVALID_HISTORY', id);
      const { document, posting } = event;
      requireEvidence(document && document.chequeId === id && present(document.itemId)
        && present(document.headerId) && present(document.voucherId), 'INVALID_DOCUMENT', event.id);
      addUnique(documentItemIds, `${document.kind}:${document.itemId}`, 'INVALID_DOCUMENT', event.id);
      const effect = classify(event, last, status, sourceDetailId);
      requireEvidence(posting && posting.bookId === bookId && posting.reference
        && posting.reference.kind === effect.referenceKind && posting.reference.sourceId === effect.sourceReferenceId
        && present(posting.reference.targetId), 'INVALID_POSTING', event.id);
      const reference = posting.reference;
      requireEvidence(effect.referenceKind === 'SUPPLIER' ? present(reference.supplierCheckId) && instrument.sayadId !== null
        : reference.supplierCheckId === undefined,
        'INVALID_POSTING', event.id);
      const referenceKey = `${reference.kind}:${reference.sourceId}`;
      const reviewedTarget = targetReferences.get(referenceKey);
      requireEvidence(!reviewedTarget || reviewedTarget === reference.targetId, 'INVALID_POSTING', event.id);
      targetReferences.set(referenceKey, reference.targetId);
      if (reference.supplierCheckId) {
        const owner = supplierCheckOwners.get(reference.supplierCheckId);
        requireEvidence(!owner || owner === id, 'INVALID_POSTING', event.id);
        supplierCheckOwners.set(reference.supplierCheckId, id);
      }
      if (effect.eventType === 'CLEARED' || effect.eventType === 'RECIPIENT_RETURNED') {
        requireEvidence(last && reference.targetId === last.posting.reference.targetId
          && reference.supplierCheckId === last.posting.reference.supplierCheckId, 'INVALID_POSTING', event.id);
      }
      if (effect.referenceKind === 'CUSTOMER') requireEvidence(reference.targetId === target.partyId, 'INVALID_POSTING', event.id);
      addUnique(targetVoucherIds, posting.voucherId, 'INVALID_POSTING', event.id);

      let assets = 0n;
      let counterparts = 0n;
      const sourceLineIds = new Set<string>();
      const allocations = [...posting.lines].sort((a, b) => orderById({ id: a.sourceLineId }, { id: b.sourceLineId }));
      const lines = allocations.map(allocation => {
        const source = ledgerLines.get(allocation.sourceLineId);
        requireEvidence(source && source.voucherId === document.voucherId && source.issuerKind === document.kind
          && source.issuerHeaderId === document.headerId && allocation.signedRials !== 0n
          && (allocation.signedRials > 0n) === (source.signedRials > 0n), 'INVALID_POSTING', event.id);
        addUnique(sourceLineIds, source.id, 'INVALID_POSTING', event.id);
        addUnique(targetLineIds, allocation.targetLineId, 'INVALID_POSTING', event.id);
        const used = (ledgerUsage.get(source.id) ?? 0n) + allocation.signedRials;
        requireEvidence(source.signedRials > 0n ? used <= source.signedRials : used >= source.signedRials, 'INVALID_POSTING', source.id);
        ledgerUsage.set(source.id, used);
        const existingAccount = targetAccounts.get(source.accountId);
        requireEvidence(present(allocation.targetAccountId) && (!existingAccount || allocation.targetAccountId === existingAccount)
          && ![...targetAccounts].some(([account, targetId]) => account !== source.accountId && targetId === allocation.targetAccountId),
        'INVALID_POSTING', event.id);
        targetAccounts.set(source.accountId, allocation.targetAccountId);
        if (source.accountId === effect.asset) {
          requireEvidence(source.detailId === sourceDetailId && serial.test(source.description)
            && source.signedRials === amountRials * effect.assetSign && allocation.signedRials === source.signedRials,
          'INVALID_POSTING', event.id);
          assets += allocation.signedRials;
        } else {
          const counterSign = source.accountId === payableDocuments ? effect.assetSign : -effect.assetSign;
          requireEvidence(effect.counterAccounts.includes(source.accountId)
            && allocation.signedRials * counterSign > 0n
            && (effect.counterDetailId === undefined || source.detailId === effect.counterDetailId), 'INVALID_POSTING', event.id);
          counterparts += allocation.signedRials;
        }
        const tracking = source.tracking;
        const { sourceLineId, targetLineId, targetAccountId, signedRials } = allocation;
        const plannedLine = { sourceLineId, targetLineId, targetAccountId, signedRials };
        if (tracking === undefined) return plannedLine;
        requireEvidence(tracking, 'INVALID_POSTING', source.id);
        const { TrackingNumber, TrackingDate } = tracking;
        const hasNumber = typeof TrackingNumber === 'string' && TrackingNumber.trim().length > 0;
        const hasDate = validTrackingDate(TrackingDate);
        requireEvidence((hasNumber || TrackingNumber === null) && (hasDate || TrackingDate === null)
          && (hasNumber || hasDate), 'INVALID_POSTING', source.id);
        return { ...plannedLine, tracking: { TrackingNumber, TrackingDate } };
      });
      requireEvidence(assets === amountRials * effect.assetSign && assets + counterparts === 0n, 'INVALID_POSTING', event.id);
      status = effect.status;
      events.push({ historyId: event.id, previousHistoryId: event.previousHistoryId, sequence: index + 2,
        eventType: effect.eventType, status, occurredAt: event.occurredAt, document, targetPosting: { ...posting, lines } });
      last = event;
    }

    requireEvidence(last && last.id === lastHistoryId && last.state === instrument.currentState, 'INVALID_HISTORY', id);
    requireEvidence(status === 'CLEARED' || status === 'ENDORSED' || status === 'RETURNED', 'OPEN_HISTORY', id);
    return { instrument, opening: { historyId: basisHistoryId, sequence: 1, amountRials,
      sourceLineId: opening.id, targetVoucherId: openingVoucherId, targetAccountId: opening.targetAccountId,
      targetLineId: target.openingPostingLineId }, events, finalStatus: status, clearedRials: status === 'CLEARED' ? amountRials : 0n,
      currentCustodyRials: 0n };
  });

  for (const line of openingLines.values()) {
    requireEvidence(openingUsage.get(line.id)?.amountRials === line.amountRials, 'INVALID_OPENING_LINE', line.id);
  }
  const sourceLedgerResiduals = [...ledgerLines.values()].sort(orderById).flatMap(line => {
    const signedRials = line.signedRials - (ledgerUsage.get(line.id) ?? 0n);
    return signedRials === 0n ? [] : [{ sourceLineId: line.id, voucherId: line.voucherId, signedRials }];
  });
  return { snapshotSha256, bookId, openingVoucherId, sourceOpeningVoucherId, basisAt, throughAt,
    instruments: plan, sourceLedgerResiduals };
}
