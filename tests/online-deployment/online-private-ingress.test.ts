import assert from 'node:assert/strict';
import test from 'node:test';
import { networkInterfaces } from 'node:os';
import { parseOnlineHttpIngress, assertOnlineHttpIngressAssigned } from '../../backend/src/services/onlinePrivateIngress';

test('only an exact canonical RFC1918 IPv4 tuple with an unprivileged port is valid data', () => {
  for (const bindHost of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1']) {
    assert.deepEqual(parseOnlineHttpIngress({ bindHost, port: 1024 }), { bindHost, port: 1024 });
  }
  for (const bindHost of ['0.0.0.0', '127.0.0.1', '::', '::ffff:10.0.0.1', 'localhost', '8.8.8.8',
    '169.254.1.1', '172.15.0.1', '172.32.0.1', '192.169.1.1', '10.000.0.1', ' 10.0.0.1', '10.0.0.256']) {
    assert.throws(() => parseOnlineHttpIngress({ bindHost, port: 5000 }), /ONLINE_PRIVATE_INGRESS_UNPROVEN/);
  }
  for (const port of [0, 1023, 65536, 5000.1, '5000', NaN, Infinity]) {
    assert.throws(() => parseOnlineHttpIngress({ bindHost: '10.0.0.1', port }));
  }
  for (const value of [null, [], {}, { bindHost: '10.0.0.1', port: 5000, allowPublic: true }]) {
    assert.throws(() => parseOnlineHttpIngress(value));
  }
});

test('private data for an actually unassigned address cannot open this process ingress', () => {
  const current = new Set(Object.values(networkInterfaces()).flatMap(entries => entries?.map(entry => entry.address) ?? []));
  const absent = Array.from({ length: 254 }, (_, index) => `10.254.253.${index + 1}`).find(address => !current.has(address));
  assert.ok(absent);
  assert.throws(() => assertOnlineHttpIngressAssigned(parseOnlineHttpIngress({ bindHost: absent, port: 5000 })), /ONLINE_PRIVATE_INGRESS_UNPROVEN/);
});

test('assignment assertion observes the real current interface inventory without injected authority', context => {
  const assigned = Object.values(networkInterfaces()).flatMap(entries => entries ?? []).find(entry => {
    if (entry.family !== 'IPv4' || entry.internal) return false;
    try { parseOnlineHttpIngress({ bindHost: entry.address, port: 5000 }); return true; } catch { return false; }
  });
  if (!assigned) { context.skip('This host has no assigned RFC1918 interface; native lane must supply its actual private slot.'); return; }
  assert.doesNotThrow(() => assertOnlineHttpIngressAssigned(parseOnlineHttpIngress({ bindHost: assigned.address, port: 5000 })));
});
