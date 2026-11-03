const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const SESSION_IDLE_MS = 12 * HOUR_MS;
export const SESSION_ABSOLUTE_MS = 7 * 24 * HOUR_MS;
export const SESSION_ACTIVITY_WRITE_MS = 5 * MINUTE_MS;

export const sessionExpiry = (authenticatedAt: Date) => ({
  idleExpiresAt: new Date(authenticatedAt.getTime() + SESSION_IDLE_MS),
  absoluteExpiresAt: new Date(authenticatedAt.getTime() + SESSION_ABSOLUTE_MS),
});

export const shouldPersistActivity = (lastPersistedAt: Date, now: Date) =>
  now.getTime() - lastPersistedAt.getTime() >= SESSION_ACTIVITY_WRITE_MS;

export type FailedLoginAlertKind = 'IDENTIFIER_THRESHOLD' | 'IP_THRESHOLD';

export const failedLoginAlertKind = ({
  identifierFailures,
  ipFailures,
}: {
  identifierFailures: number;
  ipFailures: number;
}): FailedLoginAlertKind | null => {
  if (identifierFailures >= 10) return 'IDENTIFIER_THRESHOLD';
  if (ipFailures >= 25) return 'IP_THRESHOLD';
  return null;
};
