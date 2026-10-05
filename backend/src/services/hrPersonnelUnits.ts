import type { Prisma, PrismaClient } from '@prisma/client';

export const currentPersonnelAssignmentWhere = (personnelIds: string[], at: Date): Prisma.HrEmploymentAssignmentWhereInput => ({
  organizationalUnitId: { not: null },
  effectiveFrom: { lte: at },
  OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
  employmentRelationship: {
    personnelId: { in: personnelIds },
    status: { in: ['ACTIVE', 'SUSPENDED'] },
    effectiveFrom: { lte: at },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
  },
});

export async function loadCurrentPersonnelUnits(client: PrismaClient, personnelIds: string[], at: Date) {
  const assignments = personnelIds.length ? await client.hrEmploymentAssignment.findMany({
    where: currentPersonnelAssignmentWhere(personnelIds, at),
    select: {
      organizationalUnit: { select: { id: true, name: true } },
      employmentRelationship: { select: { personnelId: true } },
    },
  }) : [];
  const units = new Map<string, { id: string; name: string; personnelIds: Set<string> }>();
  for (const assignment of assignments) {
    const unit = assignment.organizationalUnit;
    if (!unit) continue;
    const group = units.get(unit.id) ?? { ...unit, personnelIds: new Set<string>() };
    group.personnelIds.add(assignment.employmentRelationship.personnelId);
    units.set(unit.id, group);
  }
  return [...units.values()].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
}
