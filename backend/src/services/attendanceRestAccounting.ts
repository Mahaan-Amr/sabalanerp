/** Required-time accounting. Physical evidence is never rewritten by this projection. */
export type TimeSpan = { start: number; end: number };
export type AttendanceAuthority = { id?: string; kind: 'MISSION' | 'LEAVE'; status: string; start: Date; end: Date; leaveType?: string | null };
export type RestDayInput = {
  date: string;
  now: Date;
  schedule?: { startTime: string; endTime: string } | null;
  nonWorkingDay?: boolean;
  rest?: { startTime: string; endTime: string } | null;
  hasRest?: boolean;
  intervals: Array<{ enteredAt: Date | null; exitedAt: Date | null; exitUnknown?: boolean; status?: string }>;
  authorities: AttendanceAuthority[];
  absenceConfirmed?: boolean;
  ambiguousEvidence?: boolean;
  overlappingEvidence?: boolean;
};
const DAY = 86400000;
const MINUTE = 60000;
export const attendanceAccountingIssueLabels: Record<string, string> = {
  UNKNOWN_TIME: 'ساعت ورود یا خروج نامعلوم', OVERLAPPING_ATTENDANCE: 'بازه‌های حضور هم‌پوشان', AMBIGUOUS_DEVICE: 'تردد دستگاه مبهم',
  SCHEDULE_UNCONFIGURED: 'برنامه کاری تعیین‌نشده', REST_UNASSIGNED: 'تخصیص استراحت تعیین‌نشده', REST_POLICY_UNCONFIGURED: 'بازه استراحت تعیین‌نشده',
  OVERLAPPING_LEAVE: 'مجوزهای مرخصی هم‌پوشان',
  OPEN_DAY: 'روز کاری پایان نیافته', LEAVE_PRESENCE_CONFLICT: 'تعارض مرخصی با حضور یا مأموریت', PENDING_AUTHORITY: 'مجوز در انتظار تصمیم', MISSING_PRESENCE: 'عدم حضور ثبت‌شده؛ نیازمند تعیین تکلیف',
};
const time = (clock: string) => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error('ساعت معتبر نیست.');
  const [hour, minute] = clock.split(':').map(Number);
  return (hour * 60 + minute) * MINUTE;
};
export function businessSpan(date: string, startTime: string, endTime: string): TimeSpan {
  const midnight = Date.parse(`${date}T00:00:00+03:30`);
  if (!Number.isFinite(midnight)) throw new Error('تاریخ معتبر نیست.');
  const start = midnight + time(startTime), rawEnd = midnight + time(endTime);
  return { start, end: rawEnd <= start ? rawEnd + DAY : rawEnd };
}
export function unionSpans(spans: TimeSpan[]): TimeSpan[] {
  const sorted = spans.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start).map(s => ({ ...s })).sort((a, b) => a.start - b.start);
  const result: TimeSpan[] = [];
  for (const span of sorted) {
    const last = result[result.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else result.push(span);
  }
  return result;
}
export function intersectSpans(left: TimeSpan[], right: TimeSpan[]): TimeSpan[] {
  return unionSpans(left.flatMap(a => right.map(b => ({ start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) }))));
}
export function subtractSpans(left: TimeSpan[], right: TimeSpan[]): TimeSpan[] {
  let result = unionSpans(left);
  for (const cut of unionSpans(right)) result = result.flatMap(span => {
    if (cut.end <= span.start || cut.start >= span.end) return [span];
    return [{ start: span.start, end: Math.min(cut.start, span.end) }, { start: Math.max(cut.end, span.start), end: span.end }].filter(s => s.end > s.start);
  });
  return result;
}
const milliseconds = (spans: TimeSpan[]) => unionSpans(spans).reduce((sum, span) => sum + span.end - span.start, 0);
const minutes = (spans: TimeSpan[]) => Math.floor(milliseconds(spans) / MINUTE);

export function accountAttendanceDay(input: RestDayInput) {
  const issues: string[] = [];
  const active = input.intervals.filter(i => i.status !== 'VOIDED');
  const complete = active.filter(i => i.enteredAt && i.exitedAt && !i.exitUnknown && i.exitedAt > i.enteredAt)
    .map(i => ({ start: i.enteredAt!.getTime(), end: i.exitedAt!.getTime() })).sort((a, b) => a.start - b.start);
  const physical = unionSpans(complete);
  if (active.some(i => !i.enteredAt || !i.exitedAt || i.exitUnknown || i.exitedAt <= i.enteredAt)) issues.push('UNKNOWN_TIME');
  if (input.overlappingEvidence || complete.some((s, index) => index > 0 && s.start < Math.max(...complete.slice(0, index).map(p => p.end)))) issues.push('OVERLAPPING_ATTENDANCE');
  if (input.ambiguousEvidence) issues.push('AMBIGUOUS_DEVICE');
  if (!input.schedule && !input.nonWorkingDay) issues.push('SCHEDULE_UNCONFIGURED');
  if (input.hasRest === undefined) issues.push('REST_UNASSIGNED');
  if (input.hasRest === true && !input.rest) issues.push('REST_POLICY_UNCONFIGURED');
  const shift = input.schedule ? businessSpan(input.date, input.schedule.startTime, input.schedule.endTime) : null;
  if (shift && input.now.getTime() < shift.end) issues.push('OPEN_DAY');
  // Build actual occurrences, including a rest which began before midnight.
  const occurrences = input.hasRest && input.rest && shift ? [-1, 0, 1].map(offset => {
    const date = new Date(Date.parse(`${input.date}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
    return businessSpan(date, input.rest!.startTime, input.rest!.endTime);
  }) : [];
  const expected = shift ? subtractSpans([shift], occurrences) : [];
  const approved = (kind: 'MISSION' | 'LEAVE') => input.authorities.filter(a => a.kind === kind && a.status === 'APPROVED')
    .map(a => ({ start: a.start.getTime(), end: a.end.getTime() }));
  const mission = intersectSpans(approved('MISSION'), expected);
  const leave = intersectSpans(approved('LEAVE'), expected);
  const physicalWork = intersectSpans(physical, expected);
  const worked = unionSpans([...physicalWork, ...mission]);
  const leaveSources = input.authorities.filter(a => a.kind === 'LEAVE' && a.status === 'APPROVED');
  if (leaveSources.some((a, index) => leaveSources.slice(index + 1).some(b => intersectSpans(intersectSpans([{ start: a.start.getTime(), end: a.end.getTime() }], [{ start: b.start.getTime(), end: b.end.getTime() }]), expected).length))) issues.push('OVERLAPPING_LEAVE');
  const conflictingLeave = intersectSpans(leave, worked);
  if (milliseconds(conflictingLeave)) issues.push('LEAVE_PRESENCE_CONFLICT');
  if (input.authorities.some(a => a.status === 'PENDING' && intersectSpans([{ start: a.start.getTime(), end: a.end.getTime() }], expected).length)) issues.push('PENDING_AUTHORITY');
  const applicableAuthorization = input.authorities.some(a => a.status === 'APPROVED' && intersectSpans([{ start: a.start.getTime(), end: a.end.getTime() }], expected).length);
  const effectiveLeave = subtractSpans(leave, worked);
  const uncovered = subtractSpans(expected, [...worked, ...effectiveLeave]);
  if (shift && input.now.getTime() >= shift.end && !active.length && milliseconds(uncovered) > 0 && !input.absenceConfirmed) issues.push('MISSING_PRESENCE');
  const calculationUnknown = issues.some(i => ['SCHEDULE_UNCONFIGURED', 'REST_UNASSIGNED', 'REST_POLICY_UNCONFIGURED'].includes(i));
  const leaveUncertain = calculationUnknown || issues.some(i => ['UNKNOWN_TIME', 'OVERLAPPING_ATTENDANCE', 'AMBIGUOUS_DEVICE', 'OVERLAPPING_LEAVE', 'PENDING_AUTHORITY'].includes(i));
  const final = issues.length === 0;
  return {
    applicableAuthorization,
    physicalMinutes: minutes(physical),
    requiredMinutes: calculationUnknown ? null : minutes(expected),
    workMinutes: calculationUnknown ? null : minutes(worked),
    physicalWorkMinutes: calculationUnknown ? null : minutes(physicalWork),
    missionMinutes: calculationUnknown ? null : minutes(subtractSpans(mission, physicalWork)),
    leaveMinutes: leaveUncertain || conflictingLeave.length ? null : minutes(effectiveLeave),
    knownLeaveMinutes: calculationUnknown ? 0 : minutes(effectiveLeave),
    leaveConsumptions: input.authorities.filter(a => a.kind === 'LEAVE' && a.status === 'APPROVED').map(a => ({ id: a.id, leaveType: a.leaveType || null, minutes: leaveUncertain || intersectSpans([{ start: a.start.getTime(), end: a.end.getTime() }], conflictingLeave).length ? null : minutes(intersectSpans([{ start: a.start.getTime(), end: a.end.getTime() }], effectiveLeave)) })),
    shortageMinutes: final ? minutes(uncovered) : null,
    knownShortageMinutes: calculationUnknown ? 0 : minutes(intersectSpans(uncovered, [{ start: -8640000000000000, end: input.now.getTime() }])) ,
    outsideScheduleMinutes: shift ? minutes(subtractSpans(physical, [shift])) : input.nonWorkingDay ? minutes(physical) : null,
    restMinutes: shift ? minutes(intersectSpans([shift], occurrences)) : 0,
    final, issues, issueLabels: issues.map(i => attendanceAccountingIssueLabels[i] || i),
  };
}
