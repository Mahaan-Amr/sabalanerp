import crypto from 'crypto';

export const PERSONNEL_BULK_OPERATIONS = ['ACTIVATE', 'DEACTIVATE', 'CHANGE_DEPARTMENT', 'APPLY_WORK_SCHEDULE'] as const;
export type PersonnelBulkOperationKind = typeof PERSONNEL_BULK_OPERATIONS[number];

interface VersionedPersonnel {
  id: string;
  updatedAt: Date;
  user?: { id: string; role: string; isActive: boolean; updatedAt: Date } | null;
  workSchedules?: Array<{ id: string; updatedAt: Date }>;
}

export const selectionVersionHash = (records: VersionedPersonnel[]) => crypto.createHash('sha256').update(
  [...records].sort((a, b) => a.id.localeCompare(b.id)).map((item) => [
    item.id,
    item.updatedAt.toISOString(),
    item.user?.id || '',
    item.user?.role || '',
    item.user?.isActive ? 'active' : 'inactive',
    item.user?.updatedAt.toISOString() || '',
    ...(item.workSchedules || []).sort((a, b) => a.id.localeCompare(b.id)).map((schedule) => `${schedule.id}@${schedule.updatedAt.toISOString()}`),
  ].join(':')).join('|')
).digest('hex');

export const buildPersonnelBulkPreview = (records: VersionedPersonnel[], operation: string, actorRole: string) => {
  if (!PERSONNEL_BULK_OPERATIONS.includes(operation as PersonnelBulkOperationKind)) throw new Error('Unsupported bulk operation');
  const eligible: Array<{ id: string }> = [];
  const conflicting: Array<{ id: string; reason: string }> = [];
  for (const record of records) {
    if (actorRole === 'MANAGER' && record.user?.role === 'ADMIN') conflicting.push({ id: record.id, reason: 'MANAGER_CANNOT_AFFECT_ADMIN' });
    else eligible.push({ id: record.id });
  }
  return { selected: records.map((item) => ({ id: item.id })), eligible, skipped: [], conflicting, selectionHash: selectionVersionHash(records) };
};
