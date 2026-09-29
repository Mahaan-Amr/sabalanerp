import type { PartnerTechnicalOperationsIntent } from '@sabalanerp/partner-sales-contracts';

type Intent = PartnerTechnicalOperationsIntent;
export function partnerLayerSharedOperations(intents: readonly Intent[]) {
  const first = intents[0] ?? { groups: [], tools: [], finishings: [] };
  const signature = (intent: Intent, item: Intent['tools'][number] | Intent['finishings'][number]) => {
    const { operationGroupId, ...selection } = item;
    const { toolSelectionId: _tool, finishingSelectionId: _finishing, ...values } = selection as typeof selection &
      { toolSelectionId?: string; finishingSelectionId?: string };
    return JSON.stringify({ ...values, scope: intent.groups.find(group => group.operationGroupId === operationGroupId)?.scope });
  };
  const shared = <T extends Intent['tools'][number] | Intent['finishings'][number]>(items: T[], kind: 'tools' | 'finishings') => {
    const counts = intents.map(intent => {
      const result = new Map<string, number>();
      intent[kind].forEach(item => { const key = signature(intent, item); result.set(key, (result.get(key) ?? 0) + 1); });
      return result;
    });
    return items.filter(item => {
      const key = signature(first, item);
      if (!counts.every(count => (count.get(key) ?? 0) > 0)) return false;
      counts.forEach(count => count.set(key, count.get(key)! - 1));
      return true;
    });
  };
  const tools = shared(first.tools, 'tools');
  const finishings = shared(first.finishings, 'finishings');
  const used = new Set([...tools, ...finishings].map(item => item.operationGroupId));
  const operations = { groups: first.groups.filter(group => used.has(group.operationGroupId)), tools, finishings };
  const mixed = intents.some(intent => intent.tools.length !== tools.length || intent.finishings.length !== finishings.length);
  return { operations: mixed ? operations : first, mixed };
}

/** Bulk edits keep each strip collection's stable, distinct identities. */
export function clonePartnerLayerOperations(intent: Intent, side: string): Intent {
  const scoped = (id: string) => `${id.replace(/:layer-side:(front|back|left|right)$/, '')}:layer-side:${side}`;
  return {
    groups: intent.groups.map(group => ({ ...group, operationGroupId: scoped(group.operationGroupId) })),
    tools: intent.tools.map(tool => ({ ...tool, operationGroupId: scoped(tool.operationGroupId), toolSelectionId: scoped(tool.toolSelectionId) })),
    finishings: intent.finishings.map(finishing => ({ ...finishing, operationGroupId: scoped(finishing.operationGroupId), finishingSelectionId: scoped(finishing.finishingSelectionId) })),
  };
}
