import { contracts, type FulfillmentView } from './contracts';
import type { PartnerFulfillmentSource, PartnerPhysicalLineage } from './repository';
import { formatShipmentQuantity, parseShipmentQuantityToScaledInteger } from '../../shipmentQuantityProjection';

export const canonicalPartnerQuantity = (value: string): string | null => {
  try {
    const units = parseShipmentQuantityToScaledInteger(value);
    return units > 0n ? formatShipmentQuantity(units) : null;
  } catch { return null; }
};

/** Called only with validated immutable origin evidence. Stable identity is
 * Case/row-owned; recipient and scheduled quantities retain that origin. */
export const buildPartnerPhysicalLineage = async (
  source: Pick<PartnerFulfillmentSource, 'view' | 'customer'>,
  product: FulfillmentView['products'][number],
): Promise<PartnerPhysicalLineage> => ({
  lineageId: `partner-fulfillment:${(await contracts.canonicalHash(`${source.view.owner.caseId}:${product.productRowId}`)).slice(10)}`,
  sourceKind: 'PARTNER_CASE', caseId: source.view.owner.caseId, createdFrom: source.view.owner,
  internalRecordId: source.view.recordId, productRowId: product.productRowId,
  quantity: canonicalPartnerQuantity(product.quantity)!, unit: product.unit, recipient: source.customer,
  deliveryIds: source.view.deliveries.filter(delivery => delivery.items.some(item => item.productRowId === product.productRowId))
    .map(delivery => delivery.deliveryId),
});
