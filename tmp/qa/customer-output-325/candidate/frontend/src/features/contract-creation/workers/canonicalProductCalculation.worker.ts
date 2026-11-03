/// <reference lib="webworker" />

import {
  calculateLongitudinalProduct,
  calculateSlab,
  type LongitudinalProductInput,
  type SlabPolicyInput
} from '@sabalanerp/contract-product-graph';

type WorkerRequest =
  | {
      id: number;
      kind: 'longitudinal';
      input: LongitudinalProductInput;
    }
  | {
      id: number;
      kind: 'slab';
      input: SlabPolicyInput;
    };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const calculation = request.kind === 'longitudinal'
      ? calculateLongitudinalProduct(request.input)
      : calculateSlab(request.input);
    self.postMessage({
      id: request.id,
      kind: request.kind,
      calculation
    });
  } catch (error) {
    self.postMessage({
      id: request.id,
      kind: request.kind,
      error: error instanceof Error ? error.message : 'Calculation failed'
    });
  }
};

export {};
