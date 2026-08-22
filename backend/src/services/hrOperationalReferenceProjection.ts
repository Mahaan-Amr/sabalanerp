type HrOperationalReferencePosition = {
  id: string;
  title: string;
  isActive: boolean;
  vacancy: number;
};

export type HrOperationalReferenceProjection = {
  positions: Array<{
    id: string;
    title: string;
    isActive: boolean;
    availableCapacity?: number;
  }>;
};

export const projectHrOperationalReference = (
  positions: readonly HrOperationalReferencePosition[],
  options: { includeAvailableCapacity: boolean },
): HrOperationalReferenceProjection => ({
  positions: positions.map((position) => ({
    id: position.id,
    title: position.title,
    isActive: position.isActive,
    ...(options.includeAvailableCapacity ? { availableCapacity: position.vacancy } : {}),
  })),
});

export const loadHrOperationalReference = async (
  client: PrismaClient,
  options: { includeAvailableCapacity: boolean; at?: Date },
): Promise<HrOperationalReferenceProjection> => {
  const at = options.at ?? new Date();
  const [positions, lifecycleVersions, assignments] = await Promise.all([
    client.hrPosition.findMany({
      select: {
        id: true,
        title: true,
        isActive: true,
        capacity: true,
        capacityChanges: { orderBy: { effectiveAt: 'asc' } },
      },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    }),
    client.hrFoundationLifecycleVersion.findMany({
      where: { entityType: 'POSITION' },
      orderBy: { effectiveFrom: 'asc' },
    }),
    options.includeAvailableCapacity
      ? client.hrEmploymentAssignment.findMany({
          select: {
            id: true,
            positionId: true,
            type: true,
            effectiveFrom: true,
            effectiveTo: true,
            employmentRelationship: {
              select: {
                status: true,
                hiringApplication: { select: { convertedAt: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const projectedPositions = positions.map((position) => {
    const versions = lifecycleVersions.filter((version) => version.entityId === position.id);
    const effective = projectEffectiveFoundation(position, versions, at);
    const isActive = resolveFoundationStatus({
      baseActive: effective.isActive,
      at,
      versions,
    });
    const positionAssignments: CapacityAssignment[] = assignments
      .filter((assignment) => assignment.positionId === position.id)
      .map((assignment) => ({
        id: assignment.id,
        type: assignment.type,
        relationshipStatus: assignment.employmentRelationship.status,
        effectiveFrom: assignment.effectiveFrom,
        effectiveTo: assignment.effectiveTo,
        hireConvertedAt: assignment.employmentRelationship.hiringApplication?.convertedAt ?? null,
      }));
    const vacancy = options.includeAvailableCapacity
      ? reconcilePositionCapacity({
          capacity: capacityAt(effective.capacity, position.capacityChanges, at),
          active: isActive,
          at,
          assignments: positionAssignments,
        }).vacancy
      : 0;
    return { id: position.id, title: effective.title, isActive, vacancy };
  });

  return projectHrOperationalReference(projectedPositions, options);
};
import type { PrismaClient } from '@prisma/client';
import {
  capacityAt,
  projectEffectiveFoundation,
  reconcilePositionCapacity,
  resolveFoundationStatus,
  type CapacityAssignment,
} from './hrOrganizationCapacity';
