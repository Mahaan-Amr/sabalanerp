import { PrismaClient } from '@prisma/client';
import { FAILED_EVENT_DAYS, SESSION_HISTORY_DAYS } from './identitySessionService';

const DAY_MS = 24 * 60 * 60 * 1000;

export const cleanupAuthenticationEvidence = async (prisma: PrismaClient, now = new Date()) => {
  const sessionCutoff = new Date(now.getTime() - SESSION_HISTORY_DAYS * DAY_MS);
  const failureCutoff = new Date(now.getTime() - FAILED_EVENT_DAYS * DAY_MS);
  const [sessions, failedEvents, successfulEvents] = await prisma.$transaction([
    prisma.authSession.deleteMany({ where: { OR: [{ revokedAt: { lt: sessionCutoff } }, { absoluteExpiresAt: { lt: sessionCutoff } }] } }),
    prisma.authenticationEvent.deleteMany({ where: { type: 'LOGIN_FAILED', createdAt: { lt: failureCutoff } } }),
    prisma.authenticationEvent.deleteMany({ where: { type: 'LOGIN_SUCCEEDED', createdAt: { lt: sessionCutoff } } }),
  ]);
  await prisma.recognizedBrowserProfile.deleteMany({ where: { sessions: { none: {} }, lastSeenAt: { lt: sessionCutoff } } });
  return { sessions: sessions.count, failedEvents: failedEvents.count, successfulEvents: successfulEvents.count };
};

export const startAuthenticationRetentionCleanup = (prisma: PrismaClient) => {
  const run = () => cleanupAuthenticationEvidence(prisma).catch((error) => console.error('Authentication retention cleanup failed:', error));
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
};
