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
    if (commands.length === 2) throw Object.assign(new Error('refresh required'), {
      response: { status: 409, data: { code: 'API_BUILD_REFRESH_REQUIRED' } },
    });
    if (commands.length === 3) throw Object.assign(new Error('route unavailable'), { response: { status: 404 } });
    return { receiptId: 'receipt-1' };
  };
  const open = (actor: string) => createStoneReturnIntakeClient(actor, storage, record);
  const input = { customerId: 'customer-a', productId: 'stone-a', unit: 'meter', receivedQuantity: '2.125',
    acceptedQuantity: '2.12', rejectionReason: 'لب‌پریدگی', guardReturnMovementId: null };
  await assert.rejects(open('warehouse-a').submit(input), /connection lost/);
  assert.equal(open('warehouse-b').hasPending(), false);
  await assert.rejects(open('warehouse-b').resume());
  await assert.rejects(open('warehouse-a').resume(), /refresh required/);
  await assert.rejects(open('warehouse-a').resume(), /route unavailable/);
  const resumed = open('warehouse-a');
  assert.equal(resumed.hasPending(), true);
  assert.deepEqual(await resumed.resume(), { receiptId: 'receipt-1' });
  assert.match(commands[0].requestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(commands.slice(1), Array(3).fill({ ...input, requestId: commands[0].requestId }));
  assert.equal(resumed.hasPending(), false);
});

test('only a receipt-domain rejection for this request unlocks a new intake', async () => {
  const state = new Map<string, string>();
  const storage = { getItem: (key: string) => state.get(key) ?? null,
    setItem: (key: string, value: string) => { state.set(key, value); },
    removeItem: (key: string) => { state.delete(key); } };
  let first = true;
  const client = createStoneReturnIntakeClient('warehouse-a', storage, async command => {
    const requestId = first ? 'different-request' : command.requestId;
    first = false;
    throw Object.assign(new Error('رد دریافت'), { response: { status: 409,
      data: { code: 'STONE_RETURN_INTAKE_REJECTED', requestId } } });
  });
  await assert.rejects(client.submit({ customerId: 'a', productId: 'b', unit: 'meter', receivedQuantity: '1',
    acceptedQuantity: '1', rejectionReason: '', guardReturnMovementId: null }));
  assert.equal(client.hasPending(), true);
  await assert.rejects(client.resume());
  assert.equal(client.hasPending(), false);
});
