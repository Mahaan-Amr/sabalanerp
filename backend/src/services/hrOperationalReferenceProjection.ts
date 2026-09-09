type HrOperationalReferencePosition = {
  id: string;
  title: string;
  isActive: boolean;
  vacancy: number;
  jobId: string;
  jobTitle: string;
  jobIsActive: boolean;
};

type HrOperationalReferenceJob = { id: string; title: string; isActive: boolean };

export type HrOperationalReferenceProjection = {
  jobs: HrOperationalReferenceJob[];
  positions: Array<{
    id: string;
    title: string;
    isActive: boolean;
    jobId: string;
    availableCapacity?: number;
  }>;
};

export const projectHrOperationalReference = (
  positions: readonly HrOperationalReferencePosition[],
  options: { includeAvailableCapacity: boolean },
  jobs: readonly HrOperationalReferenceJob[] = [...new Map(positions.map((position) => [position.jobId, {
    id: position.jobId, title: position.jobTitle, isActive: position.jobIsActive,
  }])).values()],
): HrOperationalReferenceProjection => ({
  jobs: jobs.map((job) => ({ id: job.id, title: job.title, isActive: job.isActive })),
  positions: positions.map((position) => ({
    id: position.id,
    title: position.title,
    isActive: position.isActive,
    jobId: position.jobId,
    ...(options.includeAvailableCapacity ? { availableCapacity: position.vacancy } : {}),
  })),
});

export const loadHrOperationalReference = async (
  client: PrismaClient,
  options: { includeAvailableCapacity: boolean; at?: Date },
): Promise<HrOperationalReferenceProjection> => {
  const at = options.at ?? new Date();
  const [positions, jobs, lifecycleVersions, assignments] = await Promise.all([
    client.hrPosition.findMany({
      select: {
        id: true,
        title: true,
        isActive: true,
        capacity: true,
        jobId: true,
        capacityChanges: { orderBy: { effectiveAt: 'asc' } },
      },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    }),
    client.hrJob.findMany({
      select: { id: true, title: true, isActive: true },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    }),
    client.hrFoundationLifecycleVersion.findMany({
      where: { entityType: { in: ['JOB', 'POSITION'] } },
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

  const projectedJobs = jobs.map((job) => {
    const versions = lifecycleVersions.filter((version) => version.entityType === 'JOB' && version.entityId === job.id);
    const effective = projectEffectiveFoundation(job, versions, at);
    return {
      id: job.id,
      title: effective.title,
      isActive: resolveFoundationStatus({ baseActive: effective.isActive, at, versions }),
    };
  });
  const jobById = new Map(projectedJobs.map((job) => [job.id, job]));

  const projectedPositions = positions.map((position) => {
    const versions = lifecycleVersions.filter((version) => version.entityType === 'POSITION' && version.entityId === position.id);
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
    const job = jobById.get(effective.jobId);
    return {
      id: position.id,
      title: effective.title,
      isActive,
      jobId: effective.jobId,
      jobTitle: job?.title ?? 'شغل ناموجود',
      jobIsActive: job?.isActive ?? false,
      vacancy,
    };
  });

  return projectHrOperationalReference(projectedPositions, options, projectedJobs);
};
import type { PrismaClient } from '@prisma/client';
import {
  capacityAt,
  projectEffectiveFoundation,
  reconcilePositionCapacity,
  resolveFoundationStatus,
  type CapacityAssignment,
} from './hrOrganizationCapacity';
