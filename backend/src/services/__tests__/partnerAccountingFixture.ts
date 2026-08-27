import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { contracts, type PartnerEvent } from '../partnerSales/accounting/contracts';
import type { PartnerAccountingSource } from '../partnerSales/accounting/source';
import { preparePartnerFinancialSource } from '../partnerSales/accounting/source';
import type { AccountingQueueEntry, PartnerAccountingRepository, PartnerAccountingTransaction, PartnerInvoiceEvidence, PartnerReceivable, PartnerAccountPurchase, PartnerAccountingFact } from '../partnerSales/accounting/repository';
import type { PartnerErrorCode, Result } from '../partnerSales/accounting/contracts';

const requireFoundation = createRequire(resolve(__dirname, '../../../../packages/partner-sales-contracts/package.json'));
const { createPartnerFixtures } = requireFoundation('@sabalanerp/partner-sales-contracts/testing') as
  typeof import('../../../../packages/partner-sales-contracts/dist/testing');

/** In-memory persistence boundary only. Never imported by runtime code. */
export class PartnerAccountingFixture implements PartnerAccountingRepository {
  readonly fixtures = createPartnerFixtures();
  source: PartnerAccountingSource = { view: { ...this.fixtures.accounting, state: 'COMMITTED' }, partnerSellerId: this.fixtures.case.partnerSellerId };
  commitment: Extract<PartnerEvent, { type: 'CASE_COMMITTED' }> = contracts.PartnerEventSchema.parse({
    schemaVersion: 1, type: 'CASE_COMMITTED', eventId: 'fixture-322-commitment', commandId: 'fixture-322-commit-command',
    correlationId: 'fixture-322-correlation', actorId: 'fixture-313-partner', recordedAt: '2026-08-27T09:00:00.000Z',
    effectiveDate: '2026-08-27', owner: this.source.view.owner, internalRecordId: this.source.view.recordId,
    trigger: 'SIGNED', salesCreditOwnerId: this.source.partnerSellerId, sabalanNetAmount: { amount: '1600', currency: 'IRR' },
  }) as Extract<PartnerEvent, { type: 'CASE_COMMITTED' }>;
  queues: AccountingQueueEntry[] = [];
  receivables: PartnerReceivable[] = [];
  events: PartnerEvent[] = [];
  invoices: PartnerInvoiceEvidence[] = [];
  purchases: PartnerAccountPurchase[] | null = null;
  facts = new Map<string, PartnerAccountingFact>();
  voidedReceivableIds = new Set<string>();
  denial: PartnerErrorCode | null = null;
  failEventWrite = false;
  private tail: Promise<unknown> = Promise.resolve();
  async invoice(approved = true) {
    const prepared = await preparePartnerFinancialSource(this.source, this.source.view.owner);
    if (!prepared.ok) throw new Error('Invalid test preparation');
    const invoice: PartnerInvoiceEvidence = { invoiceRecordId: 'fixture-322-invoice', preparation: prepared.value, amount: { ...prepared.value.amount },
      kind: 'INVOICE_CANDIDATE', status: approved ? 'ISSUED' : 'DRAFT', approval: approved ? {
        eventId: 'fixture-322-financial-approval', commandId: 'fixture-322-approve', correlationId: 'fixture-322-approval-correlation',
        actorId: 'fixture-322-accountant', recordedAt: '2026-08-29T09:00:00.000Z', effectiveDate: '2026-08-28',
        financialApprovalEvidenceId: 'fixture-322-approval-evidence',
      } : null };
    this.invoices.push(invoice);
    return invoice;
  }
  async transaction<T>(operation: (tx: PartnerAccountingTransaction) => Promise<Result<T>>): Promise<Result<T>> {
    const run = this.tail.then(async () => {
      const before = structuredClone({ queues: this.queues, receivables: this.receivables, events: this.events });
      try {
        const result = await operation({
          readAuthorizedSource: async () => this.denial ? { ok: false, error: contracts.partnerError(this.denial) } : ({ ok: true, value: { ...this.source, commitment: this.commitment } }),
          findQueue: async () => this.queues[0] || null,
          insertQueue: async row => { this.queues.push(structuredClone(row)); },
          readInvoice: async id => this.invoices.find(row => row.invoiceRecordId === id) || null,
          findReceivable: async id => this.receivables.find(row => row.invoiceRecordId === id) || null,
          findActiveReceivable: async id => this.receivables.find(row => row.internalRecordId === id && !this.voidedReceivableIds.has(row.id)) || null,
          insertReceivable: async row => { this.receivables.push(structuredClone(row)); },
          appendEvent: async event => {
            if (this.failEventWrite) throw new Error('Injected event persistence failure');
            const existing = this.events.find(row => row.eventId === event.eventId);
            if (existing && contracts.canonicalJson(existing) !== contracts.canonicalJson(event)) throw new Error('Changed immutable event');
            if (!existing) this.events.push(structuredClone(event));
          },
          readOwnAccount: async () => ({ ok: true, value: { partnerSellerId: this.source.partnerSellerId,
            purchases: this.purchases || [{ source: this.source, official: null }] } }),
          readAccountingFact: async id => this.facts.get(id) || null,
        });
        if (!result.ok) Object.assign(this, before);
        return result;
      } catch (error) { Object.assign(this, before); throw error; }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
