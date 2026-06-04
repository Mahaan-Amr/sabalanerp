import type { ContractProduct, ContractWizardData, DeliveryProductItem, DeliverySchedule } from '../types/contract.types';

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

  return deliveries.map((delivery) => ({
    ...delivery,
    projectManagerName: delivery.projectManagerName?.trim() || projectManagerName,
    receiverName: delivery.receiverName?.trim() || projectManagerName,
    deliveryAddress: delivery.deliveryAddress?.trim() || deliveryAddress
  }));
};

export const getDeliveryUnit = (product: ContractProduct | undefined): DeliveryUnit => {
  if (product?.productType === 'longitudinal') return 'meter';
  if (product?.productType === 'slab') return 'squareMeter';
  return 'count';
};

export const getDeliveryUnitLabel = (unit: DeliveryUnit): string => {
  if (unit === 'meter') return 'متر طول';
  if (unit === 'squareMeter') return 'متر مربع';
  return 'عدد';
};

export const getStoredDeliveryUnitLabel = (unit: DeliveryUnit): string => {
  if (unit === 'meter') return 'meter';
  if (unit === 'squareMeter') return 'squareMeter';
  return 'count';
};

export const getDeliveryTargetAmount = (product: ContractProduct): number => {
  const unit = getDeliveryUnit(product);
  if (unit === 'meter') {
    const lengthM = product.lengthUnit === 'm' ? product.length : (product.length || 0) / 100;
    return lengthM * (product.quantity || 0);
  }
  if (unit === 'squareMeter') return product.squareMeters || 0;
  return product.quantity || 0;
};

