export type PositionCapacityCoverage = {
  committed: number;
  total: number;
  percentage: number | null;
};

export type EffectiveWorkspacePermission = {
  workspace: string;
  permissionLevel: string;
};

export function hasHrWorkspaceAccess(
  workspaces: EffectiveWorkspacePermission[] = [],
): boolean {
  return workspaces.some(({ workspace }) => workspace === "hr");
}

export function shouldShowHrPersonalDashboard(
  workspaces: EffectiveWorkspacePermission[] = [],
  landingKind: string,
): boolean {
  return landingKind === "dashboard" || hasHrWorkspaceAccess(workspaces);
}

const nonNegativeCount = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

export function positionCapacityCoverage(
  committedCapacity: number,
  vacancies: number,
): PositionCapacityCoverage {
  const committed = nonNegativeCount(committedCapacity);
  const vacant = nonNegativeCount(vacancies);
  const total = committed + vacant;

  return {
    committed,
    total,
    percentage: total === 0 ? null : Math.round((committed / total) * 100),
  };
}
