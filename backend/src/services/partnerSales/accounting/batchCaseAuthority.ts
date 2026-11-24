import type { Prisma } from '@prisma/client';
import type { PartnerActionV2 } from '@sabalanerp/partner-sales-contracts';
import type { AuthorizationEvidence, AuthorizationRoot, AuthorizationSource } from '../authorization/contracts';
import { readPartnerAccountingScopedAuthority } from '../authorization/centralAuthority';

/** Read-only list evidence. The caller already owns the operations-control
 * boundary and repeatable-read snapshot. Share all root locks before profiles and
 * users, then resolve central authority behind the same fence. */
export async function batchAccountingCaseAuthority(tx: Prisma.TransactionClient, actorId: string,
  caseIds: string[]): Promise<AuthorizationSource<PartnerActionV2>> {
  // SQL takes locks in the same sorted ID order as the command's User loop,
  // regardless of the database collation.
  const ids = [...new Set(caseIds)].sort();
  if (ids.length) await tx.$queryRaw`SELECT c.id FROM partner_sale_cases c
    JOIN unnest(${ids}::text[]) WITH ORDINALITY AS ordered(id, position) ON ordered.id = c.id
    ORDER BY ordered.position FOR SHARE OF c`;
  const cases = await tx.partnerSaleCase.findMany({ where: { id: { in: ids } },
    select: { id: true, profileId: true, customerContractId: true } });
  if (cases.length !== ids.length) throw new Error('Accounting Case authority evidence changed');
  const profileIds = [...new Set(cases.map(row => row.profileId))].sort();
  if (profileIds.length) await tx.$queryRaw`SELECT p.id FROM partner_profiles p
    JOIN unnest(${profileIds}::text[]) WITH ORDINALITY AS ordered(id, position) ON ordered.id = p.id
    ORDER BY ordered.position FOR SHARE OF p`;
  const profiles = await tx.partnerProfile.findMany({ where: { id: { in: profileIds } },
    select: { id: true, userId: true, state: true, revision: true } });
  if (profiles.length !== profileIds.length) throw new Error('Accounting profile authority evidence changed');
  const userIds = [...new Set([actorId, ...profiles.map(row => row.userId)])].sort();
  await tx.$queryRaw`SELECT u.id FROM users u
    JOIN unnest(${userIds}::text[]) WITH ORDINALITY AS ordered(id, position) ON ordered.id = u.id
    ORDER BY ordered.position FOR SHARE OF u`;
  const [users, deletions] = await Promise.all([
    tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, isActive: true, role: true,
      departmentId: true, partnerProfile: { select: { state: true, revision: true } } } }),
    tx.contractLifecycleRequest.findMany({ where: { contractId: { in: cases.flatMap(row =>
      row.customerContractId ? [row.customerContractId] : []) }, kind: 'DELETE', status: 'EXECUTED' },
      select: { contractId: true } }),
  ]);
  const byCase = new Map(cases.map(row => [row.id, row]));
  const byProfile = new Map(profiles.map(row => [row.id, row]));
  const byUser = new Map(users.map(row => [row.id, row]));
  const deleted = new Set(deletions.map(row => row.contractId));
  const actor = byUser.get(actorId);
  // Keep the same transaction-scoped central result as the former list path.
  let central: Awaited<ReturnType<typeof readPartnerAccountingScopedAuthority>> | undefined;
  const readDisabledFeatures = () => tx.featurePermission.findMany({ where: {
    userId: actorId, isActive: true, permissionLevel: 'none',
  }, select: { feature: true, expiresAt: true } });
  let disabled: Awaited<ReturnType<typeof readDisabledFeatures>> | undefined;
  return { read: async (requestedActor, root: AuthorizationRoot): Promise<AuthorizationEvidence<PartnerActionV2>> => {
    if (requestedActor !== actorId || root.kind !== 'CASE' || !byCase.has(root.id)) {
      throw new Error('Accounting Case authority evidence missing');
    }
    const sale = byCase.get(root.id)!;
    const profile = byProfile.get(sale.profileId);
    const owner = profile && byUser.get(profile.userId);
    const resource: AuthorizationEvidence['resource'] = profile && sale.customerContractId &&
      !deleted.has(sale.customerContractId)
      ? { root, partnerSellerId: profile.userId, partnerStatus: profile.state,
        lifecycleRevision: profile.revision,
        ...(owner?.departmentId ? { departmentId: owner.departmentId } : {}) }
      : null;
    if (actor?.isActive && resource) central ??= await readPartnerAccountingScopedAuthority(tx, { actorId, root });
    disabled ??= await readDisabledFeatures();
    // Expiry is evaluated for each action, including READ followed by WRITE.
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    return { ...(actor?.isActive && resource ? central! : { grants: [], authorizationRevision: 1 }),
      evaluatedAt: clock.now.toISOString(), resource, actor: {
        id: actorId, active: actor?.isActive ?? false, role: actor?.role ?? 'USER',
        disabledFeatures: disabled.filter(row => !row.expiresAt || row.expiresAt > clock.now).map(row => row.feature),
        ...(actor?.departmentId ? { departmentId: actor.departmentId } : {}),
        ...(actor?.partnerProfile ? { partnerProfile: actor.partnerProfile } : {}),
      } };
  } };
}
