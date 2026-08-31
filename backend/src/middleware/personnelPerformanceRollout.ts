import type { NextFunction, Response } from 'express';
import { prisma } from '../lib/prisma';
import type { AuthRequest } from './auth';
import {
  evaluatePersonnelPerformanceWriteGate,
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
    const now = new Date();
    const phase = await prisma.performanceFeaturePhaseVersion.findFirst({
      where: { effectiveFrom: { lte: now } }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    const pause = phase ? await prisma.performanceSafetyPause.findFirst({
      where: { phaseVersionId: phase.id, status: 'ACTIVE' }, orderBy: { startedAt: 'desc' },
    }) : null;
    const decision = evaluatePersonnelPerformanceWriteGate({
      releaseEnabled: phase?.releaseEnabled ?? false,
      phase: phase?.phase ?? 'SCHEMA_PROTECTION',
      phaseVersion: phase?.version ?? 0,
      cohortVersion: 0,
      subjectInCohort: true,
      safetyPause: pause ? { id: pause.id, scope: pause.scope === 'COHORT' ? 'COHORT' : 'ALL' } : null,
    }, action);
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
