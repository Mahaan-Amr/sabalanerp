import { Prisma, PrismaClient } from '@prisma/client';
import { startBackgroundJob } from './backgroundJobLifecycle';

/** Expected abandonment erases only temporary ciphertext; command evidence remains. */
export const purgeExpiredBiometricCaptures = (prisma: PrismaClient | Prisma.TransactionClient, now = new Date()) =>
  prisma.biometricConnectorChallenge.updateMany({ where: { status: 'STAGED', stagedExpiresAt: { lte: now } },
    data: { status: 'EXPIRED', protectedCapture: Prisma.DbNull, completedAt: now } });

export const startBiometricStagedCaptureMaintenance = (prisma: PrismaClient) =>
  startBackgroundJob({name:'startBiometricStagedCaptureMaintenance',intervalMs:30_000,
    run:async()=>{await purgeExpiredBiometricCaptures(prisma);}});
