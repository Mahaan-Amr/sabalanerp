import type { ContractProduct, ContractServiceRow, ContractWizardData, DeliveryProductItem, DeliverySchedule } from '../types/contract.types';
import { getPreparedQuantity, getPreparedUnitDeliveryValue, isPreparedProductType } from './preparedProductUtils';

export type DeliveryUnit = NonNullable<DeliveryProductItem['unit']>;

export type DeliveryProductReferenceConflictCode =
  | 'missing-product-index'
  | 'missing-product-row'
  | 'duplicate-product-row-id'
  | 'legacy-product-mismatch'
  | 'non-deliverable-product';

export interface DeliveryProductReferenceConflict {
  code: DeliveryProductReferenceConflictCode;
  deliveryIndex: number;
  productItemIndex: number;
  productRowId?: string;
  productIndex?: number;
  productId?: string;
  quantity: number;
  unit?: DeliveryUnit;
  message: string;
}

export interface DeliveryProductReferenceReconciliation {
  deliveries: DeliverySchedule[];
  conflicts: DeliveryProductReferenceConflict[];
}

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

export const isDeliverableContractProduct = (product: ContractProduct | undefined): boolean => {
  if (!product) return false;
  // Stair layers are manufactured, loaded, and delivered as part of their
  // exact parent stair row. They must never create an independent cargo balance.
  if ((product.meta as any)?.isLayer) return false;
  return !['service', 'standalone-service'].includes(String(product.productType));
};

export const getDeliverableProductEntries = (products: ContractProduct[]): Array<{ product: ContractProduct; productIndex: number }> =>
  products
    .map((product, productIndex) => ({ product, productIndex }))
    .filter(({ product }) => isDeliverableContractProduct(product));

export const isDeliveryItemForProduct = (
  item: DeliveryProductItem,
  product: ContractProduct,
  productIndex: number
): boolean => {
  if (item.rowType === 'service') return false;
  if (item.productRowId) return item.productRowId === product.rowId;
  return item.productIndex === productIndex && item.productId === product.productId;
};

export const reconcileDeliveryProductReferences = (
  products: ContractProduct[],
  deliveries: DeliverySchedule[] = []
): DeliveryProductReferenceReconciliation => {
  const conflicts: DeliveryProductReferenceConflict[] = [];
  const productIndexByRowId = new Map<string, number>();
  const duplicateProductRowIds = new Set<string>();
  products.forEach((product, productIndex) => {
    if (!product.rowId) return;
    if (productIndexByRowId.has(product.rowId)) duplicateProductRowIds.add(product.rowId);
    productIndexByRowId.set(product.rowId, productIndex);
  });

  const reconciledDeliveries = deliveries.map((delivery, deliveryIndex) => ({
    ...delivery,
    products: (delivery.products || []).map((item, productItemIndex) => {
      if (item.rowType === 'service') return item;

      let productIndex: number | undefined;
      let product: ContractProduct | undefined;

      if (item.productRowId) {
        if (duplicateProductRowIds.has(item.productRowId)) {
          conflicts.push({
            code: 'duplicate-product-row-id',
            deliveryIndex,
            productItemIndex,
            productRowId: item.productRowId,
            productIndex: item.productIndex,
            productId: item.productId,
            quantity: item.amount ?? item.quantity,
            unit: item.unit,
            message: `تحویل ${deliveryIndex + 1}: شناسه پایدار محصول بین چند ردیف تکراری است و تخصیص باید بازبینی شود.`
          });
          return item;
        }
        productIndex = productIndexByRowId.get(item.productRowId);
        product = typeof productIndex === 'number' ? products[productIndex] : undefined;
        if (!product) {
          conflicts.push({
            code: 'missing-product-row',
            deliveryIndex,
            productItemIndex,
            productRowId: item.productRowId,
            productIndex: item.productIndex,
            productId: item.productId,
            quantity: item.amount ?? item.quantity,
            unit: item.unit,
            message: `تحویل ${deliveryIndex + 1}: ردیف محصول متصل به این مقدار دیگر در قرارداد وجود ندارد.`
          });
          return item;
        }
      } else {
        if (typeof item.productIndex !== 'number' || !products[item.productIndex]) {
          conflicts.push({
            code: 'missing-product-index',
            deliveryIndex,
            productItemIndex,
            productIndex: item.productIndex,
            productId: item.productId,
            quantity: item.amount ?? item.quantity,
            unit: item.unit,
            message: `تحویل ${deliveryIndex + 1}: مرجع قدیمی محصول معتبر نیست و باید بازبینی شود.`
          });
          return item;
        }

        productIndex = item.productIndex;
        product = products[productIndex];
        if (product.productId !== item.productId) {
          conflicts.push({
            code: 'legacy-product-mismatch',
            deliveryIndex,
            productItemIndex,
            productIndex,
            productId: item.productId,
            quantity: item.amount ?? item.quantity,
            unit: item.unit,
            message: `تحویل ${deliveryIndex + 1}: شناسه محصول ذخیره‌شده با ردیف فعلی قرارداد تطابق ندارد؛ تخصیص خودکار انجام نشد.`
          });
          return item;
        }
        if (!product.rowId || duplicateProductRowIds.has(product.rowId)) {
          conflicts.push({
            code: 'duplicate-product-row-id',
            deliveryIndex,
            productItemIndex,
            productRowId: product.rowId,
            productIndex,
            productId: item.productId,
            quantity: item.amount ?? item.quantity,
            unit: item.unit,
            message: `تحویل ${deliveryIndex + 1}: شناسه پایدار ردیف محصول موجود نیست یا تکراری است و مهاجرت خودکار انجام نشد.`
          });
          return item;
        }
      }

      if (!isDeliverableContractProduct(product)) {
        conflicts.push({
          code: 'non-deliverable-product',
          deliveryIndex,
          productItemIndex,
          productRowId: product.rowId,
          productIndex,
          productId: item.productId,
          quantity: item.amount ?? item.quantity,
          unit: item.unit,
          message: `تحویل ${deliveryIndex + 1}: لایه پله نباید ردیف مستقل تحویل داشته باشد و نیاز به بازبینی دارد.`
        });
        return item;
      }

      const resolvedProductRowId = product.rowId || item.productRowId;
      if (!resolvedProductRowId) {
        conflicts.push({
          code: 'missing-product-row',
          deliveryIndex,
          productItemIndex,
          productIndex,
          productId: item.productId,
          quantity: item.amount ?? item.quantity,
          unit: item.unit,
          message: `تحویل ${deliveryIndex + 1}: ردیف محصول شناسه پایدار ندارد و باید بازبینی شود.`
        });
        return item;
      }

      return {
        ...item,
        productRowId: resolvedProductRowId,
        productIndex,
        productId: product.productId
      };
    })
  }));

  return { deliveries: reconciledDeliveries, conflicts };
};

export const removeInvalidDeliveryProductReference = (
  deliveries: DeliverySchedule[],
  deliveryIndex: number,
  productItemIndex: number
): DeliverySchedule[] => deliveries.map((delivery, currentDeliveryIndex) => {
  if (currentDeliveryIndex !== deliveryIndex) return delivery;
  return {
    ...delivery,
    products: (delivery.products || []).filter((_, currentProductItemIndex) => currentProductItemIndex !== productItemIndex)
  };
});

export const setDeliveryProductAmount = (
  delivery: DeliverySchedule,
  products: ContractProduct[],
  productIndex: number,
  quantity: number
): DeliverySchedule => {
  const product = products[productIndex];
  if (!product?.rowId) return delivery;

  const current = delivery.products || [];
  const unit = getDeliveryUnit(product);
  const normalizedQuantity = Math.max(0, quantity);
  const hasExisting = current.some((item) => isDeliveryItemForProduct(item, product, productIndex));
  let nextProducts: DeliveryProductItem[];

  if (normalizedQuantity <= 0) {
    nextProducts = current.filter((item) => !isDeliveryItemForProduct(item, product, productIndex));
  } else if (hasExisting) {
    nextProducts = current.map((item) => isDeliveryItemForProduct(item, product, productIndex)
      ? {
          ...item,
          productRowId: product.rowId,
          productIndex,
          productId: product.productId,
          quantity: normalizedQuantity,
          amount: normalizedQuantity,
          unit
        }
      : item);
  } else {
    nextProducts = [...current, {
      productRowId: product.rowId,
      productIndex,
      productId: product.productId,
      quantity: normalizedQuantity,
      amount: normalizedQuantity,
      unit
    }];
  }

  return { ...delivery, products: nextProducts };
};

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
