import type { Prisma } from '@prisma/client';

export type PartnerPermissionReadClient = Pick<Prisma.TransactionClient, 'user' |
  'workspacePermission' | 'roleWorkspacePermission' | 'featurePermission' | 'roleFeaturePermission' |
  'hrWorkspaceAccessGrant' | 'hrFeatureAccessGrant'>;

/** Memoize raw permission rows inside one fenced transaction. Callers still
 * resolve each decision at its original time so expiring grants cannot outlive
 * their authority. */
export function createFencedPartnerPermissionReader(tx: Prisma.TransactionClient): PartnerPermissionReadClient {
  return {
    user: memoizeReads(tx.user),
    workspacePermission: memoizeReads(tx.workspacePermission),
    roleWorkspacePermission: memoizeReads(tx.roleWorkspacePermission),
    featurePermission: memoizeReads(tx.featurePermission),
    roleFeaturePermission: memoizeReads(tx.roleFeaturePermission),
    hrWorkspaceAccessGrant: memoizeReads(tx.hrWorkspaceAccessGrant),
    hrFeatureAccessGrant: memoizeReads(tx.hrFeatureAccessGrant),
  };
}

function memoizeReads<Delegate extends object>(delegate: Delegate): Delegate {
  const reads = new Map<string, Promise<unknown>>();
  return new Proxy(delegate, { get(table, method, receiver) {
    const value = Reflect.get(table, method, receiver);
    if (method !== 'findUnique' && method !== 'findMany') return value;
    return (...args: unknown[]) => {
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
