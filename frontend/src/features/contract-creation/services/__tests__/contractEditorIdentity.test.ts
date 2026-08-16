import assert from 'node:assert/strict';
import {
  decideContractRecoveryDelivery,
  getOrCreateContractBrowserSessionId,
} from '../../hooks/useContractEditRecovery';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { sessionStorage: new MemoryStorage(), localStorage: new MemoryStorage() },
});
Object.defineProperty(globalThis, 'performance', {
  configurable: true,
  value: { getEntriesByType: () => [{ type: 'navigate' }] },
});

const first = getOrCreateContractBrowserSessionId();
const second = getOrCreateContractBrowserSessionId();
assert.equal(second, first, 'same-document route re-entry must retain the current editor identity');

assert.equal(decideContractRecoveryDelivery({
  mode: 'offer',
  recoveryKey: 'draft:1',
  lastRestoredKey: null,
}), 'offer');
assert.equal(decideContractRecoveryDelivery({
  mode: 'restore',
  recoveryKey: 'draft:1',
  lastRestoredKey: null,
}), 'restore', 'offering a recovery must not consume the later takeover restore');
assert.equal(decideContractRecoveryDelivery({
  mode: 'restore',
  recoveryKey: 'draft:1',
  lastRestoredKey: 'draft:1',
}), 'skip');

console.log('Contract editor identity tests passed.');
