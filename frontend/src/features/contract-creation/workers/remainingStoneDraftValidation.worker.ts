/// <reference lib="webworker" />

import { getRemainingStoneDraftFieldErrors } from '../services/remainingStoneAllocationReplayService';
import type { ContractProduct } from '../types/contract.types';
import type { RemainingStoneDraftField } from '../services/remainingStoneAllocationReplayService';

type Request = {
  id: number;
  products: ContractProduct[];
  draftProduct: ContractProduct;
  lastEditedField: RemainingStoneDraftField;
};

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, products, draftProduct, lastEditedField } = event.data;
  self.postMessage({
    id,
    errors: getRemainingStoneDraftFieldErrors({
      products,
      draftProduct,
      lastEditedField
    })
  });
};

export {};
