import {
  calculateProductOperations,
  type CalculatedFinishingSelection,
  type CalculatedToolSelection,
  type OperationEdge,
  type ProductOperationsInput
} from '@sabalanerp/contract-product-graph';

type OperationCalculation = ReturnType<
  typeof calculateProductOperations
>;
type OperationConflict = Extract<
  OperationCalculation,
  { ok: false }
>['conflicts'][number];

const edgeLabels: Record<OperationEdge, string> = {
  front: 'جلو',
  back: 'عقب',
  left: 'چپ',
  right: 'راست'
};

export const getPersianOperationEdgeLabel = (
  edge: OperationEdge
): string => edgeLabels[edge];

export type OperationCollectionPresentation = {
  complete: boolean;
  totalAmountToman: string | null;
  toolsById: Map<string, CalculatedToolSelection>;
  finishingsById: Map<string, CalculatedFinishingSelection>;
  conflictByEntityId: Map<string, OperationConflict>;
};

export const buildOperationCollectionPresentation = (
  input: ProductOperationsInput
): OperationCollectionPresentation => {
  const aggregate = calculateProductOperations(input);
  const conflicts = aggregate.ok ? [] : aggregate.conflicts;
  const conflictByEntityId = new Map<string, OperationConflict>();
  conflicts.forEach(conflict => {
    if (conflict.entityId) {
      conflictByEntityId.set(conflict.entityId, conflict);
    }
  });

  const toolsById = new Map<string, CalculatedToolSelection>();
  input.tools.forEach(tool => {
    const isolated = calculateProductOperations({
      ...input,
      tools: [tool],
      finishings: []
    });
    if (isolated.ok) {
      const calculated = isolated.result.tools[0];
      if (calculated) {
        toolsById.set(tool.toolSelectionId, calculated);
      }
    }
  });

  const finishingsById =
    new Map<string, CalculatedFinishingSelection>();
  input.finishings.forEach(finishing => {
    const isolated = calculateProductOperations({
      ...input,
      tools: [],
      finishings: [finishing]
    });
    if (isolated.ok) {
      const calculated = isolated.result.finishings[0];
      if (calculated) {
        finishingsById.set(
          finishing.finishingSelectionId,
          calculated
        );
      }
    }
  });

  return {
    complete: aggregate.ok,
    totalAmountToman: aggregate.ok
      ? aggregate.result.totalAmountToman
      : null,
    toolsById,
    finishingsById,
    conflictByEntityId
  };
};
