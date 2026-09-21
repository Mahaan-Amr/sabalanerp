import assert from 'node:assert/strict';
import test from 'node:test';
import { saveCanonicalLoadingDraft } from './canonicalLoadingDraftWorkflow';

test('saves canonical driver selections without sending retired legacy references', async () => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const response = { data: { success: true, data: { id: 'loading-1', refreshed: true } } };
  const api = {
    updateLoading: async (...args: unknown[]) => {
      calls.push({ name: 'updateLoading', args });
      return { data: { success: true, data: { id: 'loading-1' } } };
    },
    reserveCanonicalDriver: async (...args: unknown[]) => {
      calls.push({ name: 'reserveCanonicalDriver', args });
      return { data: { success: true } };
    },
    releaseCanonicalDriver: async (...args: unknown[]) => {
      calls.push({ name: 'releaseCanonicalDriver', args });
      return { data: { success: true } };
    },
    saveCanonicalAllocation: async (...args: unknown[]) => {
      calls.push({ name: 'saveCanonicalAllocation', args });
      return { data: { success: true } };
    },
    getLoading: async (...args: unknown[]) => {
      calls.push({ name: 'getLoading', args });
      return response;
    },
  };

  const result = await saveCanonicalLoadingDraft({
    api,
    loadingId: 'loading-1',
    loadingPayload: { notes: 'draft', lines: [{ sourceContractItemId: 'item-1', quantity: 3 }] },
    selectedTurnIds: ['turn-new'],
    reservedTurnIds: ['turn-old'],
    allocations: [{ queueTurnId: 'turn-new', lines: [{ sourceContractItemId: 'item-1', unit: 'count', quantity: 3 }] }],
  });

  assert.equal(result, response);
  assert.deepEqual(calls.map((call) => call.name), [
    'updateLoading',
    'releaseCanonicalDriver',
    'reserveCanonicalDriver',
    'saveCanonicalAllocation',
    'getLoading',
  ]);
  const updatePayload = calls[0].args[1] as Record<string, unknown>;
  assert.equal('driverTurnIds' in updatePayload, false);
  assert.equal('driverAllocations' in updatePayload, false);
  assert.deepEqual(calls[1].args, ['turn-old', 'loading-1', 'راننده از پیش‌نویس بارگیری حذف شد.']);
  assert.deepEqual(calls[2].args, ['turn-new', 'loading-1']);
  assert.deepEqual(calls[3].args, ['loading-1', 'turn-new', {
    lines: [{ sourceContractItemId: 'item-1', unit: 'count', quantity: 3 }],
  }]);
});

test('does not create allocation drafts before positive quantities are entered', async () => {
  let allocationWrites = 0;
  const api = {
    updateLoading: async () => ({ data: { success: true } }),
    reserveCanonicalDriver: async () => ({ data: { success: true } }),
    releaseCanonicalDriver: async () => ({ data: { success: true } }),
    saveCanonicalAllocation: async () => {
      allocationWrites += 1;
      return { data: { success: true } };
    },
    getLoading: async () => ({ data: { success: true, data: { id: 'loading-1' } } }),
  };

  await saveCanonicalLoadingDraft({
    api,
    loadingId: 'loading-1',
    loadingPayload: { lines: [{ sourceContractItemId: 'item-1', quantity: 0 }] },
    selectedTurnIds: ['turn-new'],
    reservedTurnIds: [],
    allocations: [],
  });

  assert.equal(allocationWrites, 0);
});
