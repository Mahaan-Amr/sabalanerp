export type SecurityCoverageCategory = 'open' | 'finished';

const terminalStates = new Set(['CLOSED', 'FORCE_CLOSED', 'NO_SHIFT_CONFIRMED']);

const openRank = (slot: any) => {
  if (slot.operationalState === 'ACTIVE') return 0;
  if (slot.operationalState === 'MANAGER_REVIEW') return 1;
  return 2;
};

export const categorizeSecurityCoverageSlots = (slots: any[]) => ({
  open: slots
    .filter((slot) => !terminalStates.has(slot.operationalState))
    .sort((left, right) => (
      openRank(left) - openRank(right)
      || new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
    )),
  finished: slots
    .filter((slot) => terminalStates.has(slot.operationalState))
    .sort((left, right) => (
      new Date(right.session?.endedAt || right.noShiftConfirmedAt || right.endsAt).getTime()
      - new Date(left.session?.endedAt || left.noShiftConfirmedAt || left.endsAt).getTime()
    )),
});

export const visibleSecurityCoverageSlots = (
  categorizedSlots: ReturnType<typeof categorizeSecurityCoverageSlots>,
  category: SecurityCoverageCategory,
  openLimit: number,
) => category === 'open'
  ? categorizedSlots.open.slice(0, Math.max(0, openLimit))
  : categorizedSlots.finished;
