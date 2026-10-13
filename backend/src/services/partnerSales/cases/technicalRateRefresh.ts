import { canonicalJson, partnerError, type PartnerTechnicalDraft, type PartnerErrorComponent } from '@sabalanerp/partner-sales-contracts';

/** Compare seller intent, not heartbeat/checkpoint revisions or catalog rates.
 * Customer/project/delivery/payment fields are outside the technical draft. */
export function samePartnerTechnicalIntent(left: PartnerTechnicalDraft, right: PartnerTechnicalDraft): boolean {
  const displayFields = new Set(['lengthDisplayUnit', 'widthDisplayUnit', 'crossDimensionDisplayUnit',
    'motherLengthDisplayUnit', 'lastManualField', 'lastManualDimension']);
  const content = ({ inputRevision: _revision, dependents = [], stairSystems = [], editingValues = [],
    serviceRows = [], ...draft }: PartnerTechnicalDraft) => canonicalJson(
    JSON.parse(JSON.stringify({ ...draft, dependents, stairSystems, editingValues, serviceRows },
      (key, value) => displayFields.has(key) ? undefined : value)));
  return content(left) === content(right);
}

export function technicalComponentFailure(kind: PartnerErrorComponent['kind'], title: string,
  reason: PartnerErrorComponent['reason']) {
  return { ok: false as const, error: partnerError('CATALOG_COMPONENT_UNAVAILABLE', {
    kind, title: title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) || 'جزء انتخاب‌شده', reason,
  }) };
}
