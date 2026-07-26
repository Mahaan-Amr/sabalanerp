import {
  calculatePricing,
  executeProductGraphCommand,
  parseCanonicalDecimal,
  parseCanonicalProductGraph,
  parseProductGraphCommand,
  serializeCanonicalProductGraph,
  type CanonicalProductGraph,
  type ProductGraphCommand,
  type ProductGraphCommandResult
} from '@sabalanerp/contract-product-graph';
import { Prisma, PrismaClient } from '@prisma/client';

export interface StoredProductGraphState {
  readonly graph: CanonicalProductGraph;
  readonly inputHash: string;
  readonly resultHash: string;
}

export interface ProductGraphAuditEvent {
  readonly commandId: string;
  readonly contractId: string;
  readonly actorId: string;
  readonly baseRevision: number;
  readonly resultRevision: number;
  readonly command: ProductGraphCommand;
  readonly resultGraph: CanonicalProductGraph;
  readonly inputHash: string;
  readonly resultHash: string;
}

export interface ProductGraphTransaction {
  loadState(contractId: string): Promise<StoredProductGraphState | null>;
  compareAndSetState(
    contractId: string,
    expectedRevision: number,
    state: StoredProductGraphState,
    totalAmountToman: string
  ): Promise<boolean>;
  appendAudit(event: ProductGraphAuditEvent): Promise<void>;
}

export interface ProductGraphAtomicStore {
  transaction<T>(work: (transaction: ProductGraphTransaction) => Promise<T>): Promise<T>;
}

export interface PersistProductGraphCommandInput {
  readonly contractId: string;
  readonly actorId: string;
  readonly command: unknown;
  readonly failureInjection?: 'after-state-write' | 'after-audit-write';
}

export type PersistProductGraphCommandResult =
  | {
      readonly ok: true;
      readonly graph: CanonicalProductGraph;
      readonly audit: ProductGraphAuditEvent;
      readonly totalAmountToman: string;
    }
  | Extract<ProductGraphCommandResult, { readonly ok: false }>;

class ProductGraphConcurrentWriteError extends Error {}

const emptyGraphFor = (command: ProductGraphCommand): CanonicalProductGraph => ({
  schemaVersion: 1,
  revision: 0,
  calculationPolicy: { ...command.calculationPolicy },
  catalogSnapshots: [],
  rows: [],
  stairSystems: [],
  layerConfigurations: [],
  sourceBatches: [],
  remainingStones: [],
  allocations: [],
  operationGroups: [],
  toolSelections: [],
  finishingSelections: []
});

const totalGraphAmount = (graph: CanonicalProductGraph): string => calculatePricing({
  policyVersion: graph.calculationPolicy.pricing,
  roundingPolicyVersion: graph.calculationPolicy.rounding,
  lines: graph.rows.map(row => ({
    lineId: row.productRowId,
    quantity: row.commercial.totalAmountToman ?? parseCanonicalDecimal('0'),
    rateToman: parseCanonicalDecimal('1')
  }))
}).totalAmountToman;

export const persistProductGraphCommand = async (
  store: ProductGraphAtomicStore,
  input: PersistProductGraphCommandInput
): Promise<PersistProductGraphCommandResult> => {
  const command = parseProductGraphCommand(input.command);
  try {
    return await store.transaction(async transaction => {
      const current = await transaction.loadState(input.contractId);
      const graph = current?.graph ?? emptyGraphFor(command);
      const commandResult = executeProductGraphCommand({ graph, command });
      if (!commandResult.ok) return commandResult;

      const totalAmountToman = totalGraphAmount(commandResult.graph);
      const nextState: StoredProductGraphState = {
        graph: commandResult.graph,
        inputHash: commandResult.appliedCommand.inputHash,
        resultHash: commandResult.appliedCommand.resultHash
      };
      const written = await transaction.compareAndSetState(
        input.contractId,
        command.baseRevision,
        nextState,
        totalAmountToman
      );
      if (!written) {
        return {
          ok: false,
          conflicts: [{
            code: 'revision-conflict',
            path: ['revision'],
            message: 'Contract product graph changed before the transaction committed.',
            expected: command.baseRevision
          }]
        };
      }
      if (input.failureInjection === 'after-state-write') {
        throw new Error('Injected failure after state write.');
      }

      const audit: ProductGraphAuditEvent = {
        commandId: command.commandId,
        contractId: input.contractId,
        actorId: input.actorId,
        baseRevision: command.baseRevision,
        resultRevision: commandResult.graph.revision,
        command,
        resultGraph: commandResult.graph,
        inputHash: commandResult.appliedCommand.inputHash,
        resultHash: commandResult.appliedCommand.resultHash
      };
      await transaction.appendAudit(audit);
      if (input.failureInjection === 'after-audit-write') {
        throw new Error('Injected failure after audit write.');
      }
      return { ok: true, graph: commandResult.graph, audit, totalAmountToman };
    });
  } catch (error) {
    if (error instanceof ProductGraphConcurrentWriteError) {
      return {
        ok: false,
        conflicts: [{
          code: 'revision-conflict',
          path: ['revision'],
          message: 'Contract product graph changed before the transaction committed.',
          expected: command.baseRevision
        }]
      };
    }
    throw error;
  }
};

const toJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

class PrismaProductGraphTransaction implements ProductGraphTransaction {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async loadState(contractId: string): Promise<StoredProductGraphState | null> {
    const state = await this.transaction.salesContractProductGraphState.findUnique({
      where: { contractId }
    });
    if (!state) return null;
    return {
      graph: parseCanonicalProductGraph(state.graph),
      inputHash: state.inputHash,
      resultHash: state.resultHash
    };
  }

  async compareAndSetState(
    contractId: string,
    expectedRevision: number,
    state: StoredProductGraphState,
    totalAmountToman: string
  ): Promise<boolean> {
    const graphJson = toJson(JSON.parse(serializeCanonicalProductGraph(state.graph)));
    const stateData = {
      schemaVersion: state.graph.schemaVersion,
      revision: state.graph.revision,
      graph: graphJson,
      policySnapshot: toJson(state.graph.calculationPolicy),
      inputHash: state.inputHash,
      resultHash: state.resultHash,
      totalAmountToman: new Prisma.Decimal(totalAmountToman)
    };
    let written = 0;
    if (expectedRevision === 0) {
      const created = await this.transaction.salesContractProductGraphState.createMany({
        data: [{ contractId, ...stateData }],
        skipDuplicates: true
      });
      written = created.count;
    } else {
      const updated = await this.transaction.salesContractProductGraphState.updateMany({
        where: { contractId, revision: expectedRevision },
        data: stateData
      });
      written = updated.count;
    }
    if (written !== 1) return false;
    await this.transaction.salesContract.update({
      where: { id: contractId },
      data: { totalAmount: new Prisma.Decimal(totalAmountToman) }
    });
    return true;
  }

  async appendAudit(event: ProductGraphAuditEvent): Promise<void> {
    await this.transaction.salesContractProductGraphAudit.create({
      data: {
        commandId: event.commandId,
        contractId: event.contractId,
        actorId: event.actorId,
        baseRevision: event.baseRevision,
        resultRevision: event.resultRevision,
        command: toJson(event.command),
        resultGraph: toJson(event.resultGraph),
        inputHash: event.inputHash,
        resultHash: event.resultHash
      }
    });
  }
}

export class PrismaProductGraphAtomicStore implements ProductGraphAtomicStore {
  constructor(private readonly prisma: PrismaClient) {}

  async transaction<T>(
    work: (transaction: ProductGraphTransaction) => Promise<T>
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(
        transaction => work(new PrismaProductGraphTransaction(transaction)),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ProductGraphConcurrentWriteError();
      }
      throw error;
    }
  }
}

const prisma = new PrismaClient();
export const persistSalesContractProductGraphCommand = (
  input: PersistProductGraphCommandInput
) => persistProductGraphCommand(new PrismaProductGraphAtomicStore(prisma), input);

export const loadSalesContractProductGraph = async (
  contractId: string
): Promise<StoredProductGraphState | null> => {
  const state = await prisma.salesContractProductGraphState.findUnique({
    where: { contractId }
  });
  if (!state) return null;
  return {
    graph: parseCanonicalProductGraph(state.graph),
    inputHash: state.inputHash,
    resultHash: state.resultHash
  };
};
