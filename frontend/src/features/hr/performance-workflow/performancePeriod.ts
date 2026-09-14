export type PerformancePeriodKey = `${number}-H1` | `${number}-H2`;

export const nextPerformancePeriodKey = (key: PerformancePeriodKey): PerformancePeriodKey => {
  const match = /^(\d{4})-H([12])$/.exec(key);
  if (!match) throw new Error('دوره عملکرد معتبر نیست.');
  const year = Number(match[1]);
  return match[2] === '1' ? `${year}-H2` : `${year + 1}-H1`;
};
