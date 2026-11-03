import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { sessionExpiry, shouldPersistActivity } from './identitySecurityPolicy';
import { describeClient, privateNetworkLabel } from './sessionClientMetadata';

export const SESSION_COOKIE = 'sabalan_session';
export const DEVICE_COOKIE = 'sabalan_device';
export const SESSION_HISTORY_DAYS = 180;
export const FAILED_EVENT_DAYS = 90;

type Db = PrismaClient | Prisma.TransactionClient;

export const digestToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export const newOpaqueToken = () => crypto.randomBytes(32).toString('base64url');

export const parseCookies = (header?: string) => Object.fromEntries(
  String(header || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? [part, ''] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
  })
);

export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  devicePublicId?: string | null;
}

export const createAuthoritativeSession = async (db: Db, userId: string, context: SessionContext) => {
  const now = new Date();
  const token = newOpaqueToken();
  const metadata = describeClient(context.userAgent || '');
  const publicId = context.devicePublicId || newOpaqueToken();
  const existingProfile = context.devicePublicId
    ? await db.recognizedBrowserProfile.findFirst({ where: { publicId, userId } })
    : null;
  const browserProfile = existingProfile
    ? await db.recognizedBrowserProfile.update({
      where: { id: existingProfile.id },
      data: { ...metadata, lastSeenAt: now, lastIp: context.ipAddress || null },
    })
    : await db.recognizedBrowserProfile.create({
      data: {
        publicId,
        userId,
        ...metadata,
        firstIp: context.ipAddress || null,
        lastIp: context.ipAddress || null,
      },
    });
  const expiry = sessionExpiry(now);
  const session = await db.authSession.create({
    data: {
      tokenHash: digestToken(token),
      userId,
      browserProfileId: browserProfile.id,
      ipAddress: context.ipAddress || null,
      userAgent: context.userAgent || null,
      ...metadata,
      approximateLocation: privateNetworkLabel(context.ipAddress || ''),
      isNewBrowser: !existingProfile,
      authenticatedAt: now,
      lastActivityAt: now,
      ...expiry,
    },
  });
  return { token, session, browserProfile, isNewBrowser: !existingProfile };
};

export const resolveAuthoritativeSession = async (db: Db, token: string) => {
  const now = new Date();
  const session = await db.authSession.findUnique({
    where: { tokenHash: digestToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.user.erasedAt || !session.user.isActive
    || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) return null;
  if (shouldPersistActivity(session.lastActivityAt, now)) {
    const nextIdle = new Date(Math.min(now.getTime() + 12 * 60 * 60 * 1000, session.absoluteExpiresAt.getTime()));
    await db.authSession.update({ where: { id: session.id }, data: { lastActivityAt: now, idleExpiresAt: nextIdle } });
  }
  return session;
};

export const revokeSessions = async (db: Db, params: {
  userId: string;
  actorId?: string | null;
  reason: string;
  exceptSessionId?: string;
  sessionId?: string;
}) => {
  const now = new Date();
  const where: Prisma.AuthSessionWhereInput = {
    userId: params.userId,
    revokedAt: null,
    ...(params.sessionId ? { id: params.sessionId } : {}),
    ...(params.exceptSessionId ? { id: { not: params.exceptSessionId } } : {}),
  };
  const targets = await db.authSession.findMany({ where, select: { id: true } });
  if (!targets.length) return 0;
  await db.authSession.updateMany({
    where: { id: { in: targets.map((item) => item.id) } },
    data: { revokedAt: now, revokedById: params.actorId || null, revocationReason: params.reason },
  });
  await db.authenticationEvent.createMany({
    data: targets.map((item) => ({
      type: 'SESSION_REVOKED', userId: params.userId, actorId: params.actorId || null,
      sessionIdSnapshot: item.id, reason: params.reason,
    })),
  });
  return targets.length;
};

export const serializeSession = (session: any, currentSessionId?: string) => ({
  id: session.id,
  browser: session.browser,
  operatingSystem: session.operatingSystem,
  deviceCategory: session.deviceCategory,
  ipAddress: session.ipAddress,
  approximateLocation: session.approximateLocation,
  authenticatedAt: session.authenticatedAt,
  lastActivityAt: session.lastActivityAt,
  idleExpiresAt: session.idleExpiresAt,
  absoluteExpiresAt: session.absoluteExpiresAt,
  revokedAt: session.revokedAt,
  revocationReason: session.revocationReason,
  isCurrent: session.id === currentSessionId,
  isNewBrowser: Boolean(session.isNewBrowser),
});
