import crypto from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import type { AuthRequest } from './auth';

const prisma = new PrismaClient();
const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let lastExpiredRecordCleanupAt = 0;

export const enforceMutationIdempotency = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!mutationMethods.has(req.method) || !req.user) return next();
    const key = String(req.header('x-idempotency-key') || '').trim();
    if (!key) {
      return res.status(428).json({
        success: false,
        error: 'برای این درخواست تغییر‌دهنده، سربرگ x-idempotency-key الزامی است.',
      });
    }
    if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(key)) {
      return res.status(400).json({ success: false, error: 'کلید تکرارپذیری درخواست معتبر نیست.' });
    }
    const scope = `${req.method}:${req.baseUrl}${req.path}`.slice(0, 500);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    if (now.getTime() - lastExpiredRecordCleanupAt >= 10 * 60 * 1_000) {
      lastExpiredRecordCleanupAt = now.getTime();
      await prisma.apiIdempotencyRecord.deleteMany({ where: { expiresAt: { lte: now } } });
    }
    await prisma.apiIdempotencyRecord.create({
      data: {
        id: crypto.randomUUID(),
        userId: req.user.id,
        key,
        scope,
        expiresAt,
      },
    });
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void prisma.apiIdempotencyRecord.update({
          where: { userId_key_scope: { userId: req.user!.id, key, scope } },
          data: {
            status: 'COMPLETED',
            responseStatus: res.statusCode,
            responseBody: JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue,
          },
        }).then(() => originalJson(body)).catch(() => {
          // The domain mutation already committed. Return its true result and
          // keep the guard PENDING so the same key cannot execute it again.
          originalJson(body);
        });
        return res;
      }
      return originalJson(body);
    }) as Response['json'];
    res.once('finish', () => {
      if (res.statusCode >= 400) {
        void prisma.apiIdempotencyRecord
          .deleteMany({
            where: { userId: req.user!.id, key, scope, status: 'PENDING' },
          })
          .catch((cleanupError) => {
            console.error('Failed to clean up pending idempotency record', cleanupError);
          });
      }
    });
    return next();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && req.user) {
      const key = String(req.header('x-idempotency-key') || '').trim();
      const scope = `${req.method}:${req.baseUrl}${req.path}`.slice(0, 500);
      try {
        const existing = await prisma.apiIdempotencyRecord.findUnique({
          where: { userId_key_scope: { userId: req.user.id, key, scope } },
        });
        if (!existing) return res.status(409).json({ success: false, error: 'درخواست مشابه در حال پردازش است.' });
        if (existing.expiresAt <= new Date()) {
          await prisma.apiIdempotencyRecord.delete({ where: { id: existing.id } });
          return enforceMutationIdempotency(req, res, next);
        }
        if (existing.status === 'COMPLETED' && existing.responseStatus && existing.responseBody !== null) {
          res.setHeader('x-idempotent-replay', 'true');
          return res.status(existing.responseStatus).json(existing.responseBody);
        }
        return res.status(409).json({
          success: false,
          error: 'درخواست مشابه در حال پردازش است؛ با همین کلید دوباره تلاش کنید.',
        });
      } catch (lookupError) {
        return next(lookupError);
      }
    }
    return next(error);
  }
};
