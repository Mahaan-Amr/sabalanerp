import type { NextFunction, Response } from 'express';
import { prisma } from '../lib/prisma';
import type { AuthRequest } from './auth';
import {
  resolvePersonnelPerformanceWriteGate,
  type PersonnelPerformanceWriteAction,
} from '../services/personnelPerformanceRolloutPolicy';

const reasonMessage = {
  RELEASE_DISABLED: 'انتشار ارزیابی عملکرد هنوز برای این محیط فعال نشده است.',
  CAPABILITY_NOT_ACTIVE: 'این قابلیت هنوز به مرحله فعال‌سازی لازم نرسیده است.',
  SUBJECT_OUTSIDE_COHORT: 'این پرونده هنوز در جامعه فعال ارزیابی عملکرد نیست.',
  SAFETY_PAUSED: 'عملیات ارزیابی عملکرد به‌دلیل توقف ایمن موقتاً بسته است.',
} as const;

export const requirePersonnelPerformanceWriteGate = (action: PersonnelPerformanceWriteAction) => async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const decision = await resolvePersonnelPerformanceWriteGate(prisma, action);
    if (!decision.allowed) return res.status(409).json({
      success: false,
      message: `${reasonMessage[decision.reason]} پس از رفع مانع، عملیات را دوباره انجام دهید.`,
      reason: decision.reason,
    });
    return next();
  } catch (error) {
    return next(error);
  }
};
