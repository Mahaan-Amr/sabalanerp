import type { ContractProduct, ContractServiceRow, ContractWizardData, DeliveryProductItem, DeliverySchedule } from '../types/contract.types';
import { getPreparedQuantity, getPreparedUnitDeliveryValue, isPreparedProductType } from './preparedProductUtils';

export type DeliveryUnit = NonNullable<DeliveryProductItem['unit']>;

export const getDefaultProjectManagerName = (wizardData: ContractWizardData): string =>
  wizardData.project?.projectManagerName || wizardData.customer?.projectManagerName || '';

export const getDefaultDeliveryAddress = (wizardData: ContractWizardData): string =>
  wizardData.project?.address || wizardData.customer?.projectAddresses?.[0]?.address || '';

export const createDeliveryDraft = (wizardData: ContractWizardData): DeliverySchedule => {
  const projectManagerName = getDefaultProjectManagerName(wizardData);

  return {
    deliveryDate: '',
    projectManagerName,
    receiverName: projectManagerName,
    deliveryAddress: getDefaultDeliveryAddress(wizardData),
    driver: '',
    vehicle: '',
    notes: '',
    products: []
  };
};

export const syncDeliveryDefaults = (
  deliveries: DeliverySchedule[],
  wizardData: ContractWizardData
): DeliverySchedule[] => {
  const projectManagerName = getDefaultProjectManagerName(wizardData);
  const deliveryAddress = getDefaultDeliveryAddress(wizardData);

  const withDefaultText = (value: string | undefined, fallback: string): string =>
    value === undefined || value.trim() === '' ? fallback : value;

  return deliveries.map((delivery) => ({
    ...delivery,
    projectManagerName: withDefaultText(delivery.projectManagerName, projectManagerName),
    receiverName: withDefaultText(delivery.receiverName, projectManagerName),
    deliveryAddress: withDefaultText(delivery.deliveryAddress, deliveryAddress)
  }));
};

export const isDeliverableContractProduct = (product: ContractProduct | undefined): product is ContractProduct => {
  if (!product) return false;
  return !['service', 'standalone-service'].includes(String(product.productType));
};

export const getDeliverableProductEntries = (products: ContractProduct[]): Array<{ product: ContractProduct; productIndex: number }> =>
  products
    .map((product, productIndex) => ({ product, productIndex }))
    .filter(({ product }) => isDeliverableContractProduct(product));

export const getSchedulableServiceEntries = (serviceRows: ContractServiceRow[] = []): Array<{ serviceRow: ContractServiceRow; serviceIndex: number }> =>
  serviceRows.map((serviceRow, serviceIndex) => ({ serviceRow, serviceIndex }));

export const getDeliveryUnit = (product: ContractProduct | undefined): DeliveryUnit => {
  if (isPreparedProductType(product?.productType)) return getPreparedUnitDeliveryValue(product?.preparedUnit);
  if (product?.productType === 'longitudinal') return 'meter';
  if (product?.productType === 'slab') return 'squareMeter';
  return 'count';
};

export const getDeliveryUnitLabel = (unit: DeliveryUnit): string => {
  if (unit === 'meter') return 'متر طول';
  if (unit === 'squareMeter') return 'متر مربع';
  if (unit === 'ton') return 'تن';
  return 'عدد';
};

export const getStoredDeliveryUnitLabel = (unit: DeliveryUnit): string => {
  if (unit === 'meter') return 'meter';
  if (unit === 'squareMeter') return 'squareMeter';
  if (unit === 'ton') return 'ton';
  return 'count';
};

export const getDeliveryTargetAmount = (product: ContractProduct): number => {
  const unit = getDeliveryUnit(product);
  if (isPreparedProductType(product.productType)) return getPreparedQuantity(product);
  if (unit === 'meter') {
    const lengthM = product.lengthUnit === 'm' ? product.length : (product.length || 0) / 100;
    const quantity = Number(product.quantity) || 0;
    return lengthM * (quantity > 0 ? quantity : 1);
  }
  if (unit === 'squareMeter') return product.squareMeters || 0;
  return product.quantity || 0;
};

export const getServiceDeliveryTargetAmount = (serviceRow: ContractServiceRow): number =>
  serviceRow.quantity || 0;
