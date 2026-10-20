export type OnlineSupportWindow = Readonly<{ phase: 'READY' | 'SERVING' | 'RETAINED';
  observedDatabaseAt: string; retiredAt: string | null; browserSupportUntil: string | null }>;

/** Data validation only: the caller must obtain this locked row and clock from
 * PostgreSQL. A date, deadline or this snapshot never grants runtime ownership. */
export function snapshotOnlineSupportWindow(row: { phase: unknown; now: unknown;
  retiredAt: unknown; browserSupportUntil: unknown }): OnlineSupportWindow {
  const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
  const fail = (): never => { throw new Error('ONLINE_RELEASE_SUPPORT_WINDOW_UNPROVEN'); };
  if (!validDate(row.now) || !['READY', 'SERVING', 'RETAINED'].includes(String(row.phase))) return fail();
  if (row.phase === 'RETAINED') {
    if (!validDate(row.retiredAt) || !validDate(row.browserSupportUntil)
      || row.retiredAt.getTime() > row.now.getTime()
      || row.browserSupportUntil.getTime() < row.retiredAt.getTime() + 86_400_000
      || row.browserSupportUntil.getTime() <= row.now.getTime()) fail();
  } else if (row.retiredAt !== null || row.browserSupportUntil !== null) fail();
  return Object.freeze({ phase: row.phase as 'READY' | 'SERVING' | 'RETAINED', observedDatabaseAt: row.now.toISOString(),
    retiredAt: row.retiredAt instanceof Date ? row.retiredAt.toISOString() : null,
    browserSupportUntil: row.browserSupportUntil instanceof Date ? row.browserSupportUntil.toISOString() : null });
}
