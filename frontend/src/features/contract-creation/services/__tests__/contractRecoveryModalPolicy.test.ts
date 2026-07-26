import assert from 'node:assert/strict';
import { resolveProductModalRecoveryState } from '../../utils/contractRecoveryModalPolicy';

const staleOpenModal = {
  showProductModal: true,
  selectedProduct: { id: 'product-1' },
  returnToProductModalAfterRemainder: true
};

assert.deepEqual(
  resolveProductModalRecoveryState(staleOpenModal, true),
  {
    showProductModal: false,
    selectedProduct: null,
    returnToProductModalAfterRemainder: false
  },
  'a competing edit session must discard transient product-modal state'
);

assert.deepEqual(
  resolveProductModalRecoveryState(staleOpenModal, false),
  staleOpenModal,
  'an owned edit session may preserve its active product modal'
);

console.log('contractRecoveryModalPolicy tests passed');
