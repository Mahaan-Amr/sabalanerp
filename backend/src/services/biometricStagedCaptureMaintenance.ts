import { Prisma, PrismaClient } from '@prisma/client';

/** Expected abandonment erases only temporary ciphertext; command evidence remains. */
export const purgeExpiredBiometricCaptures = (prisma: PrismaClient | Prisma.TransactionClient, now = new Date()) =>
  prisma.biometricConnectorChallenge.updateMany({ where: { status: 'STAGED', stagedExpiresAt: { lte: now } },
    data: { status: 'EXPIRED', protectedCapture: Prisma.DbNull, completedAt: now } });

export const startBiometricStagedCaptureMaintenance = (prisma: PrismaClient) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await purgeExpiredBiometricCaptures(prisma); }
    catch { console.error('Temporary biometric capture expiry cleanup failed.'); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
};
