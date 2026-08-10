import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { resolveEffectiveNarrowAuthority } from '../../narrowFeatureAccess';

export const createAuthorizedActorFixture = async (prisma: PrismaClient, input: {
  runId: string; workspace: 'security' | 'logistics'; feature: string; withSecurityPersonnel?: boolean;
}) => {
  const id = randomUUID();
  const actor = await prisma.user.create({ data: { id, email: `${input.workspace}-${id}@issue260.invalid`,
    username: `issue260-${input.workspace}-${id}`, password: 'test-only-not-a-login', firstName: 'Issue260',
    lastName: input.workspace, role: 'USER', isActive: true,
    workspacePermissions: { create: { workspace: input.workspace, permissionLevel: 'edit', isActive: true } },
    featurePermissions: { create: { workspace: input.workspace, feature: input.feature,
      permissionLevel: 'edit', isActive: true } } } });
  if (input.withSecurityPersonnel) {
    const shift = await prisma.shift.create({ data: { name: `issue260-${input.runId}-${id}`,
      namePersian: `issue260-${input.runId}-${id}-fa`, startTime: '00:00', endTime: '23:59', duration: 1439 } });
    await prisma.securityPersonnel.create({ data: { userId: actor.id, shiftId: shift.id,
      position: 'Dispatch gate operator', isActive: true } });
  }
  const authority = await resolveEffectiveNarrowAuthority(prisma, { userId: actor.id,
    workspace: input.workspace, feature: input.feature, requiredPermission: 'edit' });
  return { actor, authority };
};
