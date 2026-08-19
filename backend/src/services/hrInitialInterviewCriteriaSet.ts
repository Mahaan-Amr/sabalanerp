import { Prisma } from '@prisma/client';
import {
  DEFAULT_INTERVIEW_CRITERIA,
  normalizeInterviewCriteriaPublication,
} from './hrInterviewCriteriaPolicy';

type CriteriaSet = {
  version: number;
  criteriaJson: unknown;
  publishedByUserId: string;
  [key: string]: unknown;
};

type InitialInterviewCriteriaDatabase = {
  hrInterviewCriteriaVersion: {
    findFirst: (args: { orderBy: { version: 'desc' } }) => Promise<CriteriaSet | null>;
    upsert: (args: {
      where: { version: number };
      create: {
        version: number;
        criteriaJson: Prisma.InputJsonValue;
        publishedByUserId: string;
      };
      update: Record<string, never>;
    }) => Promise<CriteriaSet>;
  };
};

export const ensureInitialInterviewCriteriaSet = async (
  database: InitialInterviewCriteriaDatabase,
  actorUserId: string,
) => {
  const latest = await database.hrInterviewCriteriaVersion.findFirst({
    orderBy: { version: 'desc' },
  });
  if (latest) return latest;

  const criteriaJson = normalizeInterviewCriteriaPublication(
    DEFAULT_INTERVIEW_CRITERIA,
  ) as Prisma.InputJsonValue;
  return database.hrInterviewCriteriaVersion.upsert({
    where: { version: 1 },
    create: {
      version: 1,
      criteriaJson,
      publishedByUserId: actorUserId,
    },
    update: {},
  });
};
