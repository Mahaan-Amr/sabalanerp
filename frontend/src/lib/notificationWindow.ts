/** Re-read the visible window after reconnect without collapsing loaded pages.
 * Follow fresh cursors: replaying old cursors could miss newly inserted rows. */
export async function readNotificationWindow<T extends { id: string }>(pages: number,
  read: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null; hasMore: boolean }>) {
  const items: T[] = [], seen = new Set<string>();
  let nextCursor: string | null = null, hasMore = false;
  for (let page = 0; page < pages; page++) {
    const result = await read(nextCursor || undefined);
    for (const item of result.items) if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
    hasMore = result.hasMore; nextCursor = result.nextCursor;
    if (!hasMore || !nextCursor) break;
  }
  return { items, nextCursor, hasMore };
}
