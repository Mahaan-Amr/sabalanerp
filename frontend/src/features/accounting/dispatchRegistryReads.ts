type RegistryRow = {
  id: string;
  loadingId: string;
  currentSalesInvoice?: unknown;
  waybills?: { status?: string }[];
};

export type DispatchRegistryPage = {
  ids: ReadonlySet<string>;
  invoiceActionIds: ReadonlySet<string>;
  page: number;
  total: number;
};
type Snapshot<Row> = { rows: Row[]; page?: DispatchRegistryPage };
type Read = { scope: number; order: number };

export function createDispatchRegistryReads<Row extends RegistryRow>() {
  let scope = 0;
  let order = 0;
  let latestList = 0;
  let acceptedList = 0;
  let base: Snapshot<Row> = { rows: [] };
  let groups = new Set<string>();
  let matchesSearch: (row: Row) => boolean = () => true;
  const updates = new Map<string, { order: number; rows: Row[] }>();

  const beginGroup = () => ({ scope, order: ++order });
  const isCurrentList = (read: Read) => read.scope === scope && read.order === latestList;
  const rowsForGroup = (id: string) => updates.get(id)?.rows ?? base.rows.filter(row => row.loadingId === id);
  const newerGroupRows = (read: Read, id: string) => {
    if (read.scope !== scope) return;
    const current = updates.get(id);
    if (current && current.order > read.order) return current.rows;
    if (acceptedList > read.order && groups.has(id)) return rowsForGroup(id);
  };

  function reconcile(): Snapshot<Row> {
    const replacements = new Map<string, Map<string, Row>>();
    const invoiceActionIds = base.page && new Set(base.page.invoiceActionIds);
    for (const [id, update] of Array.from(updates)) {
      if (!groups.has(id)) continue;
      replacements.set(id, new Map(update.rows.map(row => [row.id, row])));
      if (!invoiceActionIds) continue;
      let actionRow: Row | undefined;
      for (const row of update.rows) {
        if (!row.currentSalesInvoice || !matchesSearch(row)) continue;
        const currentWaybill = row.waybills?.find(waybill => waybill.status === 'ISSUED' || waybill.status === 'EXIT_RECORDED');
        if (!actionRow || currentWaybill?.status === 'ISSUED') actionRow = row;
      }
      for (const row of base.rows) {
        if (row.loadingId === id) invoiceActionIds.delete(row.id);
      }
      if (actionRow && base.page?.ids.has(actionRow.id)) invoiceActionIds.add(actionRow.id);
    }
    const rows = base.rows.flatMap(row => {
      const replacementsForGroup = replacements.get(row.loadingId);
      if (!replacementsForGroup) return [row];
      const replacement = replacementsForGroup.get(row.id);
      replacementsForGroup.delete(row.id);
      return replacement ? [replacement] : [];
    });
    for (const replacementsForGroup of Array.from(replacements.values())) rows.push(...Array.from(replacementsForGroup.values()));
    return { rows, ...(base.page && invoiceActionIds ? { page: { ...base.page, invoiceActionIds } } : {}) };
  }

  function acceptGroup(read: Read, id: string, rows: Row[]) {
    if (read.scope !== scope) return;
    const fresher = newerGroupRows(read, id);
    if (fresher) return { rows: fresher };
    if (acceptedList > read.order) return;
    updates.set(id, { order: read.order, rows });
    return { rows, snapshot: groups.has(id) ? reconcile() : undefined };
  }

  return {
    beginList() {
      const read = beginGroup();
      latestList = read.order;
      return read;
    },
    beginGroup,
    isCurrentList,
    currentScope: () => scope,
    rowsForGroup,
    newerGroupRows,
    acceptList(read: Read, snapshot: Snapshot<Row>, matches: (row: Row) => boolean = () => true) {
      if (!isCurrentList(read)) return;
      base = snapshot;
      groups = new Set(base.rows.map(row => row.loadingId));
      matchesSearch = matches;
      acceptedList = read.order;
      for (const [id, update] of Array.from(updates)) {
        if (update.order <= acceptedList) updates.delete(id);
      }
      return reconcile();
    },
    acceptGroup,
    discard() {
      scope++;
      base = { rows: [] };
      groups.clear();
      updates.clear();
      return base;
    },
  };
}
