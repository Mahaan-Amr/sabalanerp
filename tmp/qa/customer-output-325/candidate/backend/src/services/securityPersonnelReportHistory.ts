export type PersonnelReportDirectoryQuery = {
  q: string;
  status: 'active' | 'inactive' | 'all';
  departmentId: string;
  hasReports: boolean;
  page: number;
  pageSize: number;
};

export type PersonnelReportHistoryQuery = {
  q: string;
  status: 'ACTIVE' | 'VOIDED' | 'all';
  startDate: string;
  endDate: string;
  categoryId: string;
  reportTypeId: string;
  reporterId: string;
  attachments: 'with' | 'without' | 'all';
  page: number;
  pageSize: number;
};

const text = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const positiveInt = (value: unknown, fallback: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

export const normalizePersonnelReportDirectoryQuery = (query: Record<string, unknown>): PersonnelReportDirectoryQuery => ({
  q: text(query.q),
  status: query.status === 'inactive' || query.status === 'all' ? query.status : 'active',
  departmentId: text(query.departmentId),
  hasReports: query.hasReports === true || query.hasReports === 'true',
  page: positiveInt(query.page, 1, 1_000_000),
  pageSize: positiveInt(query.pageSize, 25, 100),
});

export const normalizePersonnelReportHistoryQuery = (query: Record<string, unknown>): PersonnelReportHistoryQuery => ({
  q: text(query.q),
  status: query.status === 'VOIDED' || query.status === 'all' ? query.status : 'ACTIVE',
  startDate: text(query.startDate),
  endDate: text(query.endDate),
  categoryId: text(query.categoryId),
  reportTypeId: text(query.reportTypeId),
  reporterId: text(query.reporterId),
  attachments: query.attachments === 'with' || query.attachments === 'without' ? query.attachments : 'all',
  page: positiveInt(query.page, 1, 1_000_000),
  pageSize: positiveInt(query.pageSize, 20, 100),
});

type PersonnelReportParticipantLink = {
  personnelId?: string | null;
  userId?: string | null;
  user?: { personnel?: { id: string } | null } | null;
};

export const deduplicatePersonnelReportParticipants = <T extends PersonnelReportParticipantLink>(participants: T[]) => {
  const byIdentity = new Map<string, T>();
  participants.forEach((participant) => {
    const canonicalPersonnelId = participant.personnelId || participant.user?.personnel?.id;
    const key = canonicalPersonnelId ? `personnel:${canonicalPersonnelId}` : `user:${participant.userId || 'unknown'}`;
    const existing = byIdentity.get(key);
    if (!existing || (!existing.personnelId && participant.personnelId)) byIdentity.set(key, participant);
  });
  return [...byIdentity.values()];
};

export const personnelReportParticipantWhere = (personnelId: string, linkedUserId?: string | null) => ({
  OR: [
    { personnelId },
    ...(linkedUserId ? [{ userId: linkedUserId }] : []),
  ],
});

export const personnelReportReporterSearchWhere = (query: string) => ({
  AND: text(query).split(' ').filter(Boolean).map((token) => ({
    OR: [
      { firstName: { contains: token, mode: 'insensitive' as const } },
      { lastName: { contains: token, mode: 'insensitive' as const } },
      { username: { contains: token, mode: 'insensitive' as const } },
    ],
  })),
});
