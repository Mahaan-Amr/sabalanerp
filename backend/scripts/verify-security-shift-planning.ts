type GeneratedSlot = {
  sequence: number;
  startsAt: Date;
  endsAt: Date;
  plannedPersonnelId: string;
};

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const generateSlots = (anchorAt: Date, generateUntil: Date, durationMinutes: number, primaryIds: string[]): GeneratedSlot[] => {
  const slotCount = Math.ceil((generateUntil.getTime() - anchorAt.getTime()) / (durationMinutes * 60_000));
  return Array.from({ length: slotCount }, (_, sequence) => ({
    sequence,
    startsAt: new Date(anchorAt.getTime() + sequence * durationMinutes * 60_000),
    endsAt: new Date(Math.min(generateUntil.getTime(), anchorAt.getTime() + (sequence + 1) * durationMinutes * 60_000)),
    plannedPersonnelId: primaryIds[sequence % 3],
  }));
};

const hasRestConflict = (candidate: { startsAt: Date; endsAt: Date }, existing: { startsAt: Date; endsAt: Date }, durationMinutes: number) => {
  const restBoundary = durationMinutes * 2 * 60_000;
  return existing.startsAt < new Date(candidate.endsAt.getTime() + restBoundary)
    && existing.endsAt > new Date(candidate.startsAt.getTime() - restBoundary);
};

const anchor = new Date('2026-03-21T03:30:00.000Z');
const slots = generateSlots(anchor, new Date(anchor.getTime() + 6 * 12 * 60 * 60_000), 720, ['A', 'B', 'C']);

assert(slots.length === 6, 'expected six 12-hour slots');
assert(slots.map((slot) => slot.plannedPersonnelId).join('') === 'ABCABC', 'baseline must preserve A→B→C order');
assert(slots[0].startsAt.getTime() === anchor.getTime(), 'first slot starts at selected anchor');
assert(slots[1].startsAt.getTime() === slots[0].endsAt.getTime(), 'slots must be contiguous');
assert(hasRestConflict(slots[1], slots[0], 720), 'neighboring 12-hour slots should conflict with 24-hour rest rule');
assert(!hasRestConflict(slots[3], slots[0], 720), 'same primary guard after A→B→C cycle should satisfy 24-hour rest rule');

console.log('security shift planning verifier passed');
