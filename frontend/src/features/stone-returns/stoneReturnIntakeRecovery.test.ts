import assert from 'node:assert/strict';
import test from 'node:test';
import { createStoneReturnIntakeClient } from './stoneReturnIntakeRecovery';
import type { StoneReturnIntakeCommand } from './stoneReturnApi';

test('after a lost reply and reload only the submitting actor can resume the same physical receipt', async () => {
  const rows = new Map<string, string>();
  const storage = {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); },
  };
  const commands: StoneReturnIntakeCommand[] = [];
  const record = async (command: StoneReturnIntakeCommand, actorId: string) => {
    assert.equal(actorId, 'warehouse-a');
    commands.push(command);
    if (commands.length === 1) throw new Error('connection lost after commit');
    return { receiptId: 'receipt-1' };
  };
  const open = (actor: string) => createStoneReturnIntakeClient(actor, storage, record);
  const input = { customerId: 'customer-a', productId: 'stone-a', unit: 'meter', receivedQuantity: '2.125',
    acceptedQuantity: '2.12', rejectionReason: 'لب‌پریدگی', guardReturnMovementId: null };
  await assert.rejects(open('warehouse-a').submit(input), /connection lost/);
  assert.equal(open('warehouse-b').hasPending(), false);
  await assert.rejects(open('warehouse-b').resume());
  const resumed = open('warehouse-a');
  assert.equal(resumed.hasPending(), true);
  assert.deepEqual(await resumed.resume(), { receiptId: 'receipt-1' });
  assert.match(commands[0].requestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(commands[1], { ...input, requestId: commands[0].requestId });
  assert.equal(resumed.hasPending(), false);
});
