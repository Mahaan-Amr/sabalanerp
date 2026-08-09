export type PositionCapacityCoverage = {
  committed: number;
  total: number;
  percentage: number | null;
};

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
