import type { PrismaClient } from '@prisma/client';

/** Covers future starts as well as expiry, including DENY/none and narrower
 * overrides. Irrelevant scoped/named rows may conservatively shorten validity;
 * they cannot extend it. Role workspace/feature rows have no temporal fields.
 * Keep this catalog aligned with notificationAuthorization's delegated readers. */
export async function readNotificationAuthorityDeadline(database: PrismaClient, userId: string, since: Date) {
  const [row] = await database.$queryRaw<Array<{ deadline: Date | null }>>`
    SELECT min(boundary) AS deadline FROM (
      SELECT "expiresAt" AS boundary FROM public.workspace_permissions WHERE "userId" = ${userId}
      UNION ALL SELECT "expiresAt" FROM public.feature_permissions WHERE "userId" = ${userId}
      UNION ALL SELECT b.boundary FROM public.hr_workspace_access_grants g
        CROSS JOIN LATERAL (VALUES (g."effectiveFrom"), (g."effectiveTo")) b(boundary) WHERE g."userId" = ${userId}
      UNION ALL SELECT b.boundary FROM public.hr_feature_access_grants g
        CROSS JOIN LATERAL (VALUES (g."effectiveFrom"), (g."effectiveTo")) b(boundary) WHERE g."userId" = ${userId}
      UNION ALL SELECT b.boundary FROM public.hr_named_responsibilities g
        CROSS JOIN LATERAL (VALUES (g."effectiveFrom"), (g."effectiveTo")) b(boundary)
      UNION ALL SELECT b.boundary FROM public.effective_action_grants g
        CROSS JOIN LATERAL (VALUES (g."effectiveFrom"), (g."expiresAt")) b(boundary) WHERE g."revokedAt" IS NULL
    ) deadlines WHERE boundary >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  if (!row || (row.deadline !== null && !(row.deadline instanceof Date && Number.isFinite(row.deadline.getTime())))) {
    throw new Error('NOTIFICATION_AUTHORITY_DEADLINE_INVALID');
  }
  return row.deadline;
}
