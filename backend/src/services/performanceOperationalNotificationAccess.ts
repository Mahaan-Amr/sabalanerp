import type { Prisma, PrismaClient } from '@prisma/client';

// An operational alert belongs to the current explicitly assigned incident owner,
// not to a job title, a generic workspace grant, or an ADMIN override.
export const canAccessPerformanceOperationalAlert = async (
  database: PrismaClient | Prisma.TransactionClient,
  userId: string,
  event: { resourceType: string | null; resourceId: string | null } | null,
) => {
  if (event?.resourceType !== 'PERFORMANCE_OPERATIONAL_INCIDENT' || !event.resourceId) return false;
  const [user, incident] = await Promise.all([
    database.user.findUnique({ where: { id: userId }, select: { isActive: true } }),
    database.performanceOperationalIncident.findUnique({ where: { id: event.resourceId }, select: { routeKey: true } }),
  ]);
  if (!user?.isActive || !incident) return false;
  const route = await database.performanceOperationalRoute.findUnique({
    where: { routeKey: incident.routeKey }, select: { recipientUserId: true },
  });
  return route?.recipientUserId === userId;
};
