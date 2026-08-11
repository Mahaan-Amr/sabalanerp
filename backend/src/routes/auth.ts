import { prisma } from '../lib/prisma';
import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { protect, AuthRequest } from '../middleware/auth';
import { failedLoginAlertKind } from '../services/identitySecurityPolicy';
import { createAuthoritativeSession, cookieOptions, DEVICE_COOKIE, parseCookies, revokeSessions, serializeSession, SESSION_COOKIE } from '../services/identitySessionService';
import { describeClient, privateNetworkLabel } from '../services/sessionClientMetadata';
import { publishNotificationEvent } from '../services/notificationService';

const router = express.Router();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ALERT_DEDUP_MS = 60 * 60 * 1000;

export const normalizeLoginPhone = (value: string) => value
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[\s\-().]/g, '');

const requestContext = (req: Request) => {
  const ipAddress = req.ip || req.socket.remoteAddress || null;
  const userAgent = String(req.headers['user-agent'] || '');
  return { ipAddress, userAgent, ...describeClient(userAgent), approximateLocation: privateNetworkLabel(ipAddress || '') };
};

const recordFailedLogin = async (req: Request, attemptedIdentifier: string, userId: string | null, safeCategory: string) => {
  const context = requestContext(req);
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MS);
  await prisma.authenticationEvent.create({ data: { type: 'LOGIN_FAILED', userId, attemptedIdentifier, safeCategory, ...context } });
  const identityWhere = userId ? { userId } : { attemptedIdentifier };
  const latestSuccess = await prisma.authenticationEvent.findFirst({ where: { type: 'LOGIN_SUCCEEDED', ...identityWhere, createdAt: { gte: windowStart } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  const counterStart = latestSuccess?.createdAt && latestSuccess.createdAt > windowStart ? latestSuccess.createdAt : windowStart;
  const [identifierFailures, ipFailures] = await Promise.all([
    prisma.authenticationEvent.count({ where: { type: 'LOGIN_FAILED', ...identityWhere, createdAt: { gte: counterStart } } }),
    context.ipAddress ? prisma.authenticationEvent.count({ where: { type: 'LOGIN_FAILED', ipAddress: context.ipAddress, createdAt: { gte: windowStart } } }) : Promise.resolve(0),
  ]);
  const kind = failedLoginAlertKind({ identifierFailures, ipFailures });
  if (!kind) return;
  const alertKey = kind === 'IDENTIFIER_THRESHOLD' ? attemptedIdentifier : context.ipAddress || 'unknown';
  const duplicateSince = new Date(now.getTime() - ALERT_DEDUP_MS);
  const duplicate = await prisma.authenticationEvent.findFirst({
    where: { type: 'FAILED_LOGIN_ALERT', safeCategory: kind, attemptedIdentifier: alertKey, createdAt: { gte: duplicateSince } },
  });
  if (duplicate) return;
  await prisma.$transaction(async (tx) => {
    const alert = await tx.authenticationEvent.create({ data: { type: 'FAILED_LOGIN_ALERT', safeCategory: kind, attemptedIdentifier: alertKey, ipAddress: context.ipAddress, details: { identifierFailures, ipFailures } } });
    const admins = await tx.user.findMany({ where: { role: 'ADMIN', isActive: true, erasedAt: null }, select: { id: true } });
    if (admins.length) await publishNotificationEvent(tx, {
      type: 'FAILED_LOGIN_ALERT',
      deduplicationKey: `authentication-event:${alert.id}`,
      recipientIds: admins.map((admin) => admin.id),
      resourceType: 'AuthenticationEvent',
      resourceId: alert.id,
      referenceId: alertKey,
      actionUrl: '/dashboard/admin/security',
      payload: { alertKey },
    });
  });
};

// Public registration is intentionally disabled; users are provisioned through User Management.
router.all('/register', (_req, res) => res.status(404).json({ success: false, error: 'Public registration is disabled' }));

router.post('/login', [
  body('identifier').optional().isString().trim(),
  body('email').optional().isString().trim(),
  body('password').exists(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    const identifier = String(req.body.identifier || req.body.email || '').trim();
    if (!errors.isEmpty() || !identifier) return res.status(400).json({ success: false, error: 'Validation failed' });
    const normalizedEmail = identifier.includes('@') ? identifier.toLowerCase() : identifier;
    const normalizedPhone = normalizeLoginPhone(identifier);
    const canonicalIdentifier = identifier.includes('@') ? normalizedEmail : normalizedPhone !== identifier ? normalizedPhone : identifier;
    const phoneCandidates = Array.from(new Set([identifier, normalizedPhone].filter(Boolean)));
    const users = await prisma.user.findMany({
      where: { OR: [{ email: normalizedEmail }, { username: identifier }, ...phoneCandidates.map((phone) => ({ profile: { is: { phone } } }))] },
      take: 2,
      select: { id: true, email: true, username: true, password: true, firstName: true, lastName: true, role: true, isActive: true, erasedAt: true, mustChangePassword: true },
    });
    const user = users.length === 1 ? users[0] : null;
    if (!user || !user.isActive || user.erasedAt || users.length > 1) {
      await recordFailedLogin(req, canonicalIdentifier, user?.id || null, !user ? 'UNKNOWN_OR_AMBIGUOUS' : 'INACTIVE_ACCOUNT');
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    if (!(await bcrypt.compare(req.body.password, user.password))) {
      await recordFailedLogin(req, canonicalIdentifier, user.id, 'INVALID_PASSWORD');
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    const context = requestContext(req);
    const cookies = parseCookies(req.headers.cookie);
    const created = await prisma.$transaction(async (tx) => {
      const authoritativeSession = await createAuthoritativeSession(tx, user.id, { ...context, devicePublicId: cookies[DEVICE_COOKIE] });
      await tx.authenticationEvent.create({ data: { type: 'LOGIN_SUCCEEDED', userId: user.id, attemptedIdentifier: canonicalIdentifier, sessionIdSnapshot: authoritativeSession.session.id, ...context } });
      if (authoritativeSession.isNewBrowser) await publishNotificationEvent(tx, {
        type: 'NEW_BROWSER_LOGIN',
        deduplicationKey: `new-browser-login:${authoritativeSession.session.id}`,
        recipientIds: [user.id],
        resourceType: 'AuthSession',
        resourceId: authoritativeSession.session.id,
        referenceId: authoritativeSession.session.id,
        actionUrl: `/dashboard/personal/security?session=${encodeURIComponent(authoritativeSession.session.id)}`,
        payload: {
          browser: context.browser,
          operatingSystem: context.operatingSystem,
          ipAddress: context.ipAddress || 'IP نامشخص',
        },
      });
      return authoritativeSession;
    });
    res.cookie(SESSION_COOKIE, created.token, cookieOptions());
    res.cookie(DEVICE_COOKIE, created.browserProfile.publicId, { ...cookieOptions(), httpOnly: true, maxAge: 365 * 24 * 60 * 60 * 1000 });
    const { password: _password, erasedAt: _erasedAt, ...safeUser } = user;
    res.json({ success: true, data: { user: safeUser, mustChangePassword: user.mustChangePassword } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Server error during login' });
  }
});

router.get('/me', protect, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: {
    id: true, email: true, username: true, firstName: true, lastName: true, role: true, isActive: true,
    mustChangePassword: true, createdAt: true, updatedAt: true, profile: true,
    personnel: { select: { id: true, firstName: true, lastName: true, isActive: true, department: { select: { id: true, name: true, namePersian: true } } } },
  } });
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, data: user });
});

router.post('/logout', protect, async (req: AuthRequest, res) => {
  await revokeSessions(prisma, { userId: req.user!.id, actorId: req.user!.id, sessionId: req.sessionId, reason: 'USER_LOGOUT' });
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ success: true });
});

router.get('/sessions', protect, async (req: AuthRequest, res) => {
  const sessions = await prisma.authSession.findMany({ where: { userId: req.user!.id }, include: { browserProfile: true }, orderBy: { lastActivityAt: 'desc' } });
  res.json({ success: true, data: sessions.map((session) => serializeSession(session, req.sessionId)) });
});

router.delete('/sessions/:id', protect, async (req: AuthRequest, res) => {
  const count = await revokeSessions(prisma, { userId: req.user!.id, actorId: req.user!.id, sessionId: req.params.id, reason: 'USER_REVOKED_SESSION' });
  if (!count) return res.status(404).json({ success: false, error: 'Session not found' });
  if (req.params.id === req.sessionId) res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ success: true });
});

router.post('/sessions/revoke-others', protect, async (req: AuthRequest, res) => {
  const count = await revokeSessions(prisma, { userId: req.user!.id, actorId: req.user!.id, exceptSessionId: req.sessionId, reason: 'USER_REVOKED_OTHER_SESSIONS' });
  res.json({ success: true, data: { revoked: count } });
});

router.post('/change-password', protect, [body('currentPassword').isString(), body('newPassword').isLength({ min: 8 })], async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { password: true } });
  if (!user || !(await bcrypt.compare(req.body.currentPassword, user.password))) return res.status(400).json({ success: false, error: 'Current password is incorrect' });
  const password = await bcrypt.hash(req.body.newPassword, 12);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: req.user!.id }, data: { password, mustChangePassword: false } });
    await revokeSessions(tx, { userId: req.user!.id, actorId: req.user!.id, exceptSessionId: req.sessionId, reason: 'PASSWORD_CHANGED' });
    await tx.authenticationEvent.create({ data: { type: 'PASSWORD_CHANGED', userId: req.user!.id, actorId: req.user!.id, sessionIdSnapshot: req.sessionId } });
  });
  res.json({ success: true });
});

router.get('/security-notifications', protect, async (req: AuthRequest, res) => {
  const data = await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ success: true, data });
});

router.put('/security-notifications/:id/read', protect, async (req: AuthRequest, res) => {
  const result = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: { readAt: new Date() } });
  if (!result.count) return res.status(404).json({ success: false, error: 'Notification not found' });
  res.json({ success: true });
});

export default router;
