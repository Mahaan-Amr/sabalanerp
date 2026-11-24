import type { Prisma } from '@prisma/client';

export type PartnerPermissionReadClient = Pick<Prisma.TransactionClient, 'user' |
  'workspacePermission' | 'roleWorkspacePermission' | 'featurePermission' | 'roleFeaturePermission' |
  'hrWorkspaceAccessGrant' | 'hrFeatureAccessGrant'>;

/** Memoize raw permission rows inside one fenced transaction. Callers still
 * resolve each decision at its original time so expiring grants cannot outlive
 * their authority. */
export function createFencedPartnerPermissionReader(tx: Prisma.TransactionClient, signal?: AbortSignal): PartnerPermissionReadClient {
  return {
    user: memoizeReads(tx.user, signal),
    workspacePermission: memoizeReads(tx.workspacePermission, signal),
    roleWorkspacePermission: memoizeReads(tx.roleWorkspacePermission, signal),
    featurePermission: memoizeReads(tx.featurePermission, signal),
    roleFeaturePermission: memoizeReads(tx.roleFeaturePermission, signal),
    hrWorkspaceAccessGrant: memoizeReads(tx.hrWorkspaceAccessGrant, signal),
    hrFeatureAccessGrant: memoizeReads(tx.hrFeatureAccessGrant, signal),
  };
}

function memoizeReads<Delegate extends object>(delegate: Delegate, signal?: AbortSignal): Delegate {
  const reads = new Map<string, Promise<unknown>>();
  return new Proxy(delegate, { get(table, method, receiver) {
    const value: unknown = Reflect.get(table, method, receiver);
    if (typeof value !== 'function' || (method !== 'findUnique' && method !== 'findMany')) return value;
    return (...args: unknown[]) => {
      signal?.throwIfAborted();
      const key = JSON.stringify([method, args]);
      let read = reads.get(key);
      if (!read) {
        read = Promise.resolve(Reflect.apply(value, table, args));
        reads.set(key, read);
      }
      return read;
    };
  } });
}
