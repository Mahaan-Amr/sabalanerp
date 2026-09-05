import { PrismaClient } from '@prisma/client';
import { reconcileBiometricConnectorChallenges } from '../src/services/biometricConnectorReconciliation';

const prisma = new PrismaClient();
const main = async () => {
  const actorId = String(process.env.BIOMETRIC_RECONCILIATION_ACTOR_ID || '').trim();
  if (!actorId) throw new Error('BIOMETRIC_RECONCILIATION_ACTOR_ID is required');
  const actor = await prisma.user.findFirst({ where: { id: actorId, role: 'ADMIN', isActive: true, erasedAt: null }, select: { id: true } });
  if (!actor) throw new Error('BIOMETRIC_RECONCILIATION_ACTOR_ID must identify an active system administrator');
  console.log(JSON.stringify(await reconcileBiometricConnectorChallenges(prisma, { actorId }), null, 2));
};

main().finally(() => prisma.$disconnect());
