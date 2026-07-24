import assert from 'node:assert/strict';
import {
  parseCanonicalDecimal,
  parseCanonicalProductGraph,
  parseStableIdentity,
  serializeCanonicalProductGraph
} from '@sabalanerp/contract-product-graph';
import {
  persistProductGraphCommand,
  type ProductGraphAtomicStore,
  type ProductGraphAuditEvent,
  type ProductGraphTransaction,
  type StoredProductGraphState
} from '../contractProductGraphPersistence';

class InMemoryAtomicStore implements ProductGraphAtomicStore {
  state: StoredProductGraphState | null = null;
  audits: ProductGraphAuditEvent[] = [];
  totalAmountToman = '0';

  async transaction<T>(
    work: (transaction: ProductGraphTransaction) => Promise<T>
  ): Promise<T> {
    let draftState = this.state ? {
      ...this.state,
      graph: parseCanonicalProductGraph(serializeCanonicalProductGraph(this.state.graph))
    } : null;
    const draftAudits = [...this.audits];
    let draftTotal = this.totalAmountToman;
    const transaction: ProductGraphTransaction = {
      loadState: async () => draftState,
      compareAndSetState: async (_contractId, expectedRevision, state, total) => {
        const currentRevision = draftState?.graph.revision ?? 0;
        if (currentRevision !== expectedRevision) return false;
        draftState = {
          ...state,
          graph: parseCanonicalProductGraph(serializeCanonicalProductGraph(state.graph))
        };
        draftTotal = total;
        return true;
      },
      appendAudit: async event => {
        if (draftAudits.some(audit => audit.commandId === event.commandId)) {
          throw new Error('Duplicate immutable audit command identity.');
        }
        draftAudits.push(structuredClone(event));
      }
    };
    const result = await work(transaction);
    this.state = draftState;
    this.audits = draftAudits;
    this.totalAmountToman = draftTotal;
    return result;
  }
}

const policy = {
  calculation: 'calculation-v1',
  packing: 'packing-guillotine-v1',
  pricing: 'pricing-decimal-v1',
  rounding: 'toman-half-up-v1'
};

const command = (baseRevision = 0, commandId = 'command-1') => ({
  commandId: parseStableIdentity('audit-mutation', commandId),
  type: 'add-row' as const,
  baseRevision,
  calculationPolicy: policy,
  sellerIntent: {
    row: {
      productRowId: parseStableIdentity('product-row', `row-${commandId}`),
      catalogProductId: 'catalog-stone',
      catalogSnapshotVersion: 'inventory-1',
      productType: 'longitudinal' as const,
      contractualTitle: 'Stone row',
      commercial: {
        requestedAreaSquareMeters: parseCanonicalDecimal('2.5'),
        baseRateToman: parseCanonicalDecimal('1000'),
        totalAmountToman: parseCanonicalDecimal('1')
      }
    }
  },
  catalogSnapshots: [{
    catalogProductId: 'catalog-stone',
    snapshotVersion: 'inventory-1',
    facts: {
      motherLengthMeters: parseCanonicalDecimal('3'),
      motherWidthMeters: parseCanonicalDecimal('0.4')
    }
  }]
});

const run = async () => {
{
  const store = new InMemoryAtomicStore();
  const result = await persistProductGraphCommand(store, {
    contractId: 'contract-1',
    actorId: 'seller-1',
    command: command()
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected graph command to persist.');
  assert.equal(result.graph.revision, 1);
  assert.equal(result.graph.rows[0].commercial.totalAmountToman, '2500');
  assert.equal(result.totalAmountToman, '2500');
  assert.equal(store.totalAmountToman, '2500');
  assert.equal(store.audits.length, 1);
  assert.deepEqual(store.state?.graph, result.graph);
  assert.deepEqual(
    parseCanonicalProductGraph(serializeCanonicalProductGraph(store.state?.graph)),
    result.graph
  );

  const before = structuredClone({
    state: store.state,
    audits: store.audits,
    total: store.totalAmountToman
  });
  const stale = await persistProductGraphCommand(store, {
    contractId: 'contract-1',
    actorId: 'seller-2',
    command: command(0, 'stale-command')
  });
  assert.equal(stale.ok, false);
  assert.deepEqual({ state: store.state, audits: store.audits, total: store.totalAmountToman }, before);
}

for (const failureInjection of ['after-state-write', 'after-audit-write'] as const) {
  const store = new InMemoryAtomicStore();
  await assert.rejects(
    persistProductGraphCommand(store, {
      contractId: 'contract-failure',
      actorId: 'seller-1',
      command: command(),
      failureInjection
    }),
    /Injected failure/
  );
  assert.equal(store.state, null);
  assert.equal(store.audits.length, 0);
  assert.equal(store.totalAmountToman, '0');
}

{
  const store: ProductGraphAtomicStore = {
    transaction: async work => work({
      loadState: async () => null,
      compareAndSetState: async () => false,
      appendAudit: async () => {
        throw new Error('Audit must not run after a failed compare-and-set.');
      }
    })
  };
  const result = await persistProductGraphCommand(store, {
    contractId: 'contract-race',
    actorId: 'seller-1',
    command: command()
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected compare-and-set race to fail.');
  assert.equal(result.conflicts[0].code, 'revision-conflict');
}

console.log('contract product graph persistence tests passed');
};

void run();
