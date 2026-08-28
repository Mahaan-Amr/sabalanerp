import type { PartnerTechnicalDraft } from './technical-draft';
import type { PartnerTechnicalOperationsIntent } from './technical-operations';

export interface TechnicalDraftConflict {
  code: 'duplicate-identity'; field: string; entityId: string; message: string;
}
export interface TechnicalIdentityFailure { ok: false; inputRevision: number; conflicts: readonly TechnicalDraftConflict[]; result?: undefined }

/** Stable graph identities cannot name two editing entities. Mark every owner
 * of an ambiguity, instead of arbitrarily accepting the first row/command.
 */
export function inspectTechnicalIdentities(draft: PartnerTechnicalDraft) {
  type Owner = { collection: 'rows' | 'dependents'; index: number; field: string; id: string };
  const identities = new Map<string, Owner[]>();
  const add = (kind: string, id: string, owner: Omit<Owner, 'id'>) => {
    const key = `${kind}/${id}`;
    identities.set(key, [...(identities.get(key) ?? []), { ...owner, id }]);
  };
  const operations = (intent: PartnerTechnicalOperationsIntent | undefined, owner: Omit<Owner, 'id'>) => {
    if (!intent) return;
    intent.groups.forEach(group => add('operation-group', group.operationGroupId,
      { ...owner, field: `${owner.field}.groups.operationGroupId` }));
    intent.tools.forEach(tool => add('tool-selection', tool.toolSelectionId,
      { ...owner, field: `${owner.field}.tools.toolSelectionId` }));
    intent.finishings.forEach(finishing => add('finishing-selection', finishing.finishingSelectionId,
      { ...owner, field: `${owner.field}.finishings.finishingSelectionId` }));
  };
  draft.rows.forEach((row, index) => {
    add('product-row', row.productRowId, { collection: 'rows', index, field: 'productRowId' });
    if ('sourceBatchId' in row.configuration) add('source-batch', row.configuration.sourceBatchId,
      { collection: 'rows', index, field: 'configuration.sourceBatchId' });
    if ('operations' in row) operations(row.operations, { collection: 'rows', index, field: 'operations' });
  });
  draft.dependents?.forEach((intent, index) => {
    if (intent.kind === 'remainder') {
      add('product-row', intent.productRowId, { collection: 'dependents', index, field: 'productRowId' });
      add('allocation', intent.allocationId, { collection: 'dependents', index, field: 'allocationId' });
      operations(intent.operations, { collection: 'dependents', index, field: 'operations' });
    } else {
      add('layer-configuration', intent.layerConfigurationId, { collection: 'dependents', index, field: 'layerConfigurationId' });
      add('source-batch', intent.sourceBatchId, { collection: 'dependents', index, field: 'sourceBatchId' });
      intent.sideOperations?.forEach(side => {
        add('layer-operation-collection', side.operationCollectionId,
          { collection: 'dependents', index, field: `sideOperations.${side.side}.operationCollectionId` });
        operations(side.operations, { collection: 'dependents', index, field: `sideOperations.${side.side}.operations` });
      });
    }
  });
  const rows = new Map<number, TechnicalDraftConflict[]>();
  const dependents = new Map<number, TechnicalDraftConflict[]>();
  const conflicts: TechnicalDraftConflict[] = [];
  for (const owners of identities.values()) if (owners.length > 1) for (const owner of owners) {
    const conflict: TechnicalDraftConflict = { code: 'duplicate-identity',
      field: `${owner.collection}.${owner.index}.${owner.field}`, entityId: owner.id,
      message: 'شناسهٔ یکسان برای چند جزء پیش‌نویس قابل استفاده نیست.' };
    conflicts.push(conflict);
    const collection = owner.collection === 'rows' ? rows : dependents;
    collection.set(owner.index, [...(collection.get(owner.index) ?? []), conflict]);
  }
  return { rows, dependents, conflicts };
}
