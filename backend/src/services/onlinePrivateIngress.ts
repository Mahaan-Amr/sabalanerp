import { networkInterfaces } from 'node:os';

export type OnlineHttpIngress = Readonly<{ bindHost: string; port: number }>;
const fail = (): never => { throw new Error('ONLINE_PRIVATE_INGRESS_UNPROVEN'); };

/** Pure data validation grants no listener or controller authority. The host
 * signer must derive this tuple from its original inspected private slot. */
export function parseOnlineHttpIngress(value: unknown): OnlineHttpIngress {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'bindHost,port') return fail();
  const input = value as Record<string, unknown>;
  if (typeof input.bindHost !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(input.bindHost)
    || typeof input.port !== 'number' || !Number.isSafeInteger(input.port) || input.port < 1024 || input.port > 65535) return fail();
  const octets = input.bindHost.split('.').map(Number);
  if (octets.some(part => part < 0 || part > 255) || octets.join('.') !== input.bindHost
    || !(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168))) return fail();
  return Object.freeze({ bindHost: input.bindHost, port: input.port });
}

/** Observe the current process's actual interfaces immediately before listen.
 * No caller-supplied interface inventory, environment bind or DNS resolution
 * substitutes for the signed private address being assigned to this process. */
export function assertOnlineHttpIngressAssigned(ingress: OnlineHttpIngress): void {
  const expected = parseOnlineHttpIngress(ingress);
  const assigned = Object.values(networkInterfaces()).some(entries => entries?.some(entry =>
    entry.family === 'IPv4' && entry.internal === false && entry.address === expected.bindHost));
  if (!assigned) fail();
}
