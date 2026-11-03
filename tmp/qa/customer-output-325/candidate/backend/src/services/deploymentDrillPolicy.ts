export const assertIsolatedRecoveryDrill = (environment: NodeJS.ProcessEnv) => {
  if (environment.DEPLOYMENT_DRILL_ISOLATED !== 'true' || environment.NODE_ENV === 'production') {
    throw Object.assign(new Error('Recovery drills may run only in an explicitly isolated non-production environment.'), {
      code: 'DEPLOYMENT_DRILL_NOT_ISOLATED',
    });
  }
  const databaseUrl = String(environment.DATABASE_URL || '');
  const productionDatabaseUrl = String(environment.PRODUCTION_DATABASE_URL || '');
  if (!databaseUrl || !productionDatabaseUrl || databaseUrl === productionDatabaseUrl) {
    throw Object.assign(new Error('Recovery drill database identity is missing or matches production.'), {
      code: 'DEPLOYMENT_DRILL_DATABASE_UNSAFE',
    });
  }
  const marker = String(environment.DEPLOYMENT_DRILL_DATABASE_MARKER || '');
  if (marker.length < 32 || /REPLACE|CHANGE_ME|UNCONFIGURED/.test(marker)) {
    throw Object.assign(new Error('Recovery drill database marker is missing or unsafe.'), {
      code: 'DEPLOYMENT_DRILL_DATABASE_MARKER_UNSAFE',
    });
  }
};

export const recoveryDrillFreshness = (input: { checkpointCreatedAt: Date; lastHealthyDrillAt?: Date; now: Date; maximumAgeMs?: number }) => {
  const maximumAgeMs = input.maximumAgeMs ?? 35 * 24 * 60 * 60 * 1000;
  const checkpointAge = input.now.getTime() - input.checkpointCreatedAt.getTime();
  if (checkpointAge <= maximumAgeMs) return { healthy: true, reason: 'INITIAL_CHECKPOINT_GRACE' } as const;
  if (input.lastHealthyDrillAt && input.now.getTime() - input.lastHealthyDrillAt.getTime() <= maximumAgeMs) {
    return { healthy: true, reason: 'HEALTHY_DRILL_CURRENT' } as const;
  }
  return { healthy: false, reason: 'HEALTHY_DRILL_OVERDUE' } as const;
};

export const recoveryRehearsalFreshness = (input: { checkpointCreatedAt: Date; lastHealthyRehearsalAt?: Date; now: Date }) =>
  recoveryDrillFreshness({
    checkpointCreatedAt: input.checkpointCreatedAt,
    lastHealthyDrillAt: input.lastHealthyRehearsalAt,
    now: input.now,
    maximumAgeMs: 100 * 24 * 60 * 60 * 1000,
  });
