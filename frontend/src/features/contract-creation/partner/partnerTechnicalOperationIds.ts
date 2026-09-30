import type { PartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';

/** Earlier operation editors could persist the reserved generated group ID as
 * an explicit group after a tool was selected. Give that group a stable
 * explicit identity while keeping its scope and selections intact. */
export function repairPartnerTechnicalOperationIds(draft: PartnerTechnicalDraft): PartnerTechnicalDraft {
  const used = new Set(draft.rows.flatMap(row => 'operations' in row ? row.operations?.groups.map(group => group.operationGroupId) ?? [] : []));
  let changed = false;
  const rows = draft.rows.map(row => {
    if (!('operations' in row) || !row.operations) return row;
    const reserved = `${row.productRowId}:no-operations`;
    if (!row.operations.groups.some(group => group.operationGroupId === reserved)) return row;
    let replacement = `${row.productRowId}:explicit-operations`;
    for (let suffix = 2; used.has(replacement); suffix += 1) replacement = `${row.productRowId}:explicit-operations-${suffix}`;
    used.add(replacement);
    changed = true;
    const operations = row.operations;
    return { ...row, operations: {
      groups: operations.groups.map(group => group.operationGroupId === reserved ? { ...group, operationGroupId: replacement } : group),
      tools: operations.tools.map(tool => tool.operationGroupId === reserved ? { ...tool, operationGroupId: replacement } : tool),
      finishings: operations.finishings.map(finishing => finishing.operationGroupId === reserved ? { ...finishing, operationGroupId: replacement } : finishing),
    } };
  });
  return changed ? { ...draft, inputRevision: draft.inputRevision + 1, rows } : draft;
}
