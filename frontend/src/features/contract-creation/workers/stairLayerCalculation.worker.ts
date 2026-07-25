/// <reference lib="webworker" />

import {
  calculateStairLayerConfiguration
} from '@sabalanerp/contract-product-graph';
import type {
  CanonicalLayerCalculationRequest
} from '../services/stairCalculationService';

type WorkerRequest = {
  id: number;
  input: CanonicalLayerCalculationRequest;
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    self.postMessage({
      id: event.data.id,
      calculation: calculateStairLayerConfiguration(event.data.input)
    });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : 'Calculation failed'
    });
  }
};

export {};
