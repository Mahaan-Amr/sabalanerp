import type { PartnerProfile, PartnerSaleCase, Prisma } from '@prisma/client';
import type { PartnerActionV2 } from '@sabalanerp/partner-sales-contracts';
import { lockScopedActionRevisionForRead } from '../../effectiveAuthorization/scopedActions';
import type { AuthorizationEvidence, AuthorizationRoot, AuthorizationSource } from '../authorization/contracts';
import { readPartnerAccountingAuthoritySchedule, readPartnerAccountingScopedAuthority } from '../authorization/centralAuthority';
import { createFencedPartnerPermissionReader, type PartnerPermissionReadClient } from '../authorization/fencedPermissionReads';

/** Read-only list evidence. The caller already owns the operations-control
 * boundary and repeatable-read snapshot. Share all root locks before profiles and
 * users, then resolve central authority behind the same fence. */
export async function batchAccountingCaseAuthority(tx: Prisma.TransactionClient, actorId: string, caseIds: string[],
  options: { permissionClient?: PartnerPermissionReadClient; includeUnlinkedCases?: boolean; signal?: AbortSignal } = {}) {
  const { signal } = options;
  signal?.throwIfAborted();
  // SQL takes locks in the same sorted ID order as the command's User loop,
  // regardless of the database collation.
  const ids = [...new Set(caseIds)].sort();
  const cases = ids.length ? await tx.$queryRaw<Array<Pick<PartnerSaleCase, 'id' | 'profileId' | 'customerContractId'>>>`
    SELECT c.id, c."profileId", c."customerContractId" FROM partner_sale_cases c
    JOIN unnest(${ids}::text[]) WITH ORDINALITY AS ordered(id, position) ON ordered.id = c.id
    ORDER BY ordered.position FOR SHARE OF c` : [];
  signal?.throwIfAborted();
  if (cases.length !== ids.length) throw new Error('Accounting Case authority evidence changed');
  const profileIds = [...new Set(cases.map(row => row.profileId))].sort();
  const profiles = profileIds.length ? await tx.$queryRaw<Array<Pick<PartnerProfile, 'id' | 'userId' | 'state' | 'revision'>>>`
    SELECT p.id, p."userId", p.state::text AS state, p.revision FROM partner_profiles p
    JOIN unnest(${profileIds}::text[]) WITH ORDINALITY AS ordered(id, position) ON ordered.id = p.id
    ORDER BY ordered.position FOR SHARE OF p` : [];
  signal?.throwIfAborted();
  if (profiles.length !== profileIds.length) throw new Error('Accounting profile authority evidence changed');
  const userIds = [...new Set([actorId, ...profiles.map(row => row.userId)])].sort();
  await tx.$queryRaw`SELECT u.id FROM users u
    JOIN unnest(${userIds}::text[]) WITH ORDINALITY AS ordered(id, position) ON ordered.id = u.id
    ORDER BY ordered.position FOR SHARE OF u`;
  signal?.throwIfAborted();
  // Fence the central revision even when no Case can yield a decision.
  const version = await lockScopedActionRevisionForRead(tx);
  signal?.throwIfAborted();
  const [users, deletions] = cases.length ? await Promise.all([
    tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, isActive: true, role: true,
      departmentId: true, partnerProfile: { select: { state: true, revision: true } } } }),
    tx.contractLifecycleRequest.findMany({ where: { contractId: { in: cases.flatMap(row =>
      row.customerContractId ? [row.customerContractId] : []) }, kind: 'DELETE', status: 'EXECUTED' },
      select: { contractId: true } }),
  ]) : [[], []];
  signal?.throwIfAborted();
  const byCase = new Map(cases.map(row => [row.id, row]));
  const byProfile = new Map(profiles.map(row => [row.id, row]));
  const byUser = new Map(users.map(row => [row.id, row]));
  const deleted = new Set(deletions.map(row => row.contractId));
  const actor = byUser.get(actorId);
  // Shared by the list-only sources and advisory actions in this snapshot.
  // Scoped grants and the decision clock are still read by each policy.
  const permissionClient = options.permissionClient ?? createFencedPartnerPermissionReader(tx, signal);
  const resolveScopedAuthority = (root: AuthorizationRoot) =>
    readPartnerAccountingScopedAuthority(tx, { actorId, root }, permissionClient, version);
  // Keep the same transaction-scoped central result as the former list path.
  let central: ReturnType<typeof readPartnerAccountingScopedAuthority> | undefined;
  let scheduled: ReturnType<typeof readPartnerAccountingAuthoritySchedule> | undefined;
  const readClock = async () => (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;
  let preparation: ReturnType<typeof readPartnerAccountingScopedAuthority> | undefined;
  const readDisabledFeatures = () => tx.featurePermission.findMany({ where: {
    userId: actorId, isActive: true, permissionLevel: 'none',
  }, select: { feature: true, expiresAt: true } });
  let disabled: Awaited<ReturnType<typeof readDisabledFeatures>> | undefined;
  const read = async (requestedActor: string, root: AuthorizationRoot,
    resolveAuthority: (root: AuthorizationRoot) => ReturnType<typeof resolveScopedAuthority>,
    fresh = false): Promise<AuthorizationEvidence<PartnerActionV2>> => {
    signal?.throwIfAborted();
    if (requestedActor !== actorId || root.kind !== 'CASE' || !byCase.has(root.id)) {
      throw new Error('Accounting Case authority evidence missing');
    }
    const sale = byCase.get(root.id)!;
    const profile = byProfile.get(sale.profileId);
    const owner = profile && byUser.get(profile.userId);
    const contractVisible = sale.customerContractId
      ? !deleted.has(sale.customerContractId) : options.includeUnlinkedCases;
    const resource: AuthorizationEvidence['resource'] = profile && contractVisible
      ? { root, partnerSellerId: profile.userId, partnerStatus: profile.state,
        lifecycleRevision: profile.revision,
        ...(owner?.departmentId ? { departmentId: owner.departmentId } : {}) }
      : null;
    let authority: Awaited<ReturnType<typeof resolveScopedAuthority>> = { grants: [], authorizationRevision: version.revision };
    const hasAuthorityEvidence = actor?.isActive && resource;
    if (hasAuthorityEvidence) {
      if (fresh) scheduled ??= readPartnerAccountingAuthoritySchedule(tx, actorId, permissionClient, version, signal);
      else authority = await resolveAuthority(root);
    }
    const scheduledAuthority = fresh && hasAuthorityEvidence ? await scheduled : undefined;
    signal?.throwIfAborted();
    disabled ??= await readDisabledFeatures();
    signal?.throwIfAborted();
    const now = await readClock();
    signal?.throwIfAborted();
    if (scheduledAuthority) authority = await scheduledAuthority(now);
    signal?.throwIfAborted();
    return { ...authority,
      evaluatedAt: now.toISOString(), resource, actor: {
        id: actorId, active: actor?.isActive ?? false, role: actor?.role ?? 'USER',
        disabledFeatures: disabled.filter(row => !row.expiresAt || row.expiresAt > now).map(row => row.feature),
        ...(actor?.departmentId ? { departmentId: actor.departmentId } : {}),
        ...(actor?.partnerProfile ? { partnerProfile: actor.partnerProfile } : {}),
      } };
  };
  const source: AuthorizationSource<PartnerActionV2> = { read: (actor, root) => read(actor, root,
    root => central ??= resolveScopedAuthority(root)) };
  // Preparation grants start at the first preparation decision, as before.
  const preparationSource: AuthorizationSource<PartnerActionV2> = { read: (actor, root) => read(actor, root,
    root => preparation ??= resolveScopedAuthority(root)) };
  // Paper signature availability previously resolved grant expiry independently.
  // Preserve that decision time through the same fenced Case membership.
  const signatureSource: AuthorizationSource<PartnerActionV2> = { read: (actor, root) =>
    read(actor, root, resolveScopedAuthority) };
  const scheduledSource: AuthorizationSource<PartnerActionV2> = { read: (actor, root) =>
    read(actor, root, resolveScopedAuthority, true) };
  return { source, preparationSource, signatureSource, scheduledSource, permissionClient, hasCase: (caseId: string) => byCase.has(caseId) };
}

export type AccountingCaseAuthority = Awaited<ReturnType<typeof batchAccountingCaseAuthority>>;
