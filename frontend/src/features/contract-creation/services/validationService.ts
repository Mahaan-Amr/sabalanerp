// Validation service
// Handles validation for products, deliveries, payments, and wizard steps

import type { ContractProduct, ContractServiceRow, DeliverySchedule, PaymentMethod, ContractWizardData } from '../types/contract.types';
import { sumNumericValues, toFiniteNumber } from '@/lib/numberFormat';
import {
  getDeliverableProductEntries,
  getDeliveryTargetAmount,
  isDeliveryItemForProduct,
  reconcileDeliveryProductReferences
} from '../utils/deliveryScheduleController';
import { validateContractPartyIdentity } from './contractPartyIdentity';

/**
 * Validate a product configuration
 */
export const validateProduct = (product: Partial<ContractProduct>): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!product.productId) {
    errors.push('یک محصول انتخاب کنید.');
  }
  
  if (!product.quantity || product.quantity <= 0) {
    errors.push('تعداد را بیشتر از صفر وارد کنید.');
  }
  
  if (!product.pricePerSquareMeter || product.pricePerSquareMeter <= 0) {
    errors.push('قیمت هر متر مربع را بیشتر از صفر وارد کنید.');
  }
  
  if (product.productType === 'longitudinal' || product.productType === 'slab') {
    if (!product.length || product.length <= 0) {
      errors.push('طول محصول را بیشتر از صفر وارد کنید.');
    }
    if (!product.width || product.width <= 0) {
      errors.push('عرض محصول را بیشتر از صفر وارد کنید.');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate delivery schedule
 */
export const validateDelivery = (
  delivery: DeliverySchedule,
  products: ContractProduct[],
  serviceRows: ContractServiceRow[] = []
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  const deliveryReferences = reconcileDeliveryProductReferences(products, [delivery]);
  const normalizedDelivery = deliveryReferences.deliveries[0] || delivery;
  errors.push(...deliveryReferences.conflicts.map((conflict) => conflict.message));
  
  if (!delivery.deliveryDate) {
    errors.push('تاریخ تحویل را انتخاب کنید.');
  }
  
  if (!delivery.receiverName || delivery.receiverName.trim() === '') {
    errors.push('نام تحویل‌گیرنده را وارد کنید.');
  }
  
  if (!normalizedDelivery.products || normalizedDelivery.products.length === 0) {
    errors.push('حداقل یک محصول یا خدمت برای تحویل یا اجرا انتخاب کنید.');
  }
  
  // Validate product quantities don't exceed available quantities
  if (normalizedDelivery.products && normalizedDelivery.products.length > 0) {
    for (const deliveryProduct of normalizedDelivery.products) {
      if (deliveryProduct.rowType === 'service') {
        const serviceRow = serviceRows.find(row => row.id === deliveryProduct.serviceRowId);
        if (serviceRow) {
          const totalDelivered = normalizedDelivery.products
            .filter(p => p.rowType === 'service' && p.serviceRowId === deliveryProduct.serviceRowId)
            .reduce((sum, p) => sum + toFiniteNumber(p.amount ?? p.quantity), 0);

          if (totalDelivered > toFiniteNumber(serviceRow.quantity)) {
            errors.push(`مقدار زمان‌بندی «${serviceRow.title}» از مقدار ثبت‌شده خدمت بیشتر است؛ مقدار را به ${toFiniteNumber(serviceRow.quantity).toLocaleString('fa-IR')} یا کمتر کاهش دهید.`);
          }
        }
        continue;
      }

      const productIndex = deliveryProduct.productRowId
        ? products.findIndex((product) => product.rowId === deliveryProduct.productRowId)
        : deliveryProduct.productIndex;
      const product = typeof productIndex === 'number' && productIndex >= 0 ? products[productIndex] : undefined;
      if (product && typeof productIndex === 'number') {
        const totalDelivered = normalizedDelivery.products
          .filter((item) => isDeliveryItemForProduct(item, product, productIndex))
          .reduce((sum, p) => sum + toFiniteNumber(p.amount ?? p.quantity), 0);
        
        if (totalDelivered > getDeliveryTargetAmount(product)) {
          errors.push(`مقدار تحویل «${product.stoneName}» از مقدار محصول بیشتر است؛ مقدار را به ${getDeliveryTargetAmount(product).toLocaleString('fa-IR')} یا کمتر کاهش دهید.`);
        }
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate payment method
 */
export const validatePayment = (
  payment: PaymentMethod,
  totalContractAmount: number
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!payment.payments || payment.payments.length === 0) {
    errors.push('حداقل یک روش پرداخت اضافه کنید.');
  }
  
  if (payment.payments && payment.payments.length > 0) {
    const totalPaymentAmount = sumNumericValues(payment.payments, (paymentEntry) => paymentEntry.amount);
    const normalizedContractAmount = toFiniteNumber(totalContractAmount);
    
    if (totalPaymentAmount + 0.01 < normalizedContractAmount) {
      const deficit = normalizedContractAmount - totalPaymentAmount;
      errors.push(`جمع پرداخت‌ها ${deficit.toLocaleString('fa-IR')} کمتر از مبلغ قرارداد است؛ مبلغ پرداخت‌ها را به ${normalizedContractAmount.toLocaleString('fa-IR')} برسانید.`);
    }

    if (totalPaymentAmount - normalizedContractAmount > 0.01 && !payment.extraPaymentReason) {
      errors.push('جمع پرداخت‌ها از مبلغ قرارداد بیشتر است؛ دلیل مبلغ اضافه را انتخاب کنید.');
    }
    
    // Validate individual payment entries (CASH_CARD | CASH_SHIBA | CHECK)
    for (const paymentEntry of payment.payments) {
      const method = (paymentEntry as { method?: string }).method;
      if (toFiniteNumber(paymentEntry.amount) <= 0) {
        errors.push('مبلغ پرداخت را بیشتر از صفر وارد کنید.');
      }
      if (method === 'CASH_CARD' || method === 'CASH_SHIBA' || method === 'CUSTOMER_BALANCE') {
        if (!paymentEntry.paymentDate || !String(paymentEntry.paymentDate).trim()) {
          errors.push(method === 'CUSTOMER_BALANCE' ? 'تاریخ استفاده از مانده مشتری را انتخاب کنید.' : 'تاریخ پرداخت نقدی را انتخاب کنید.');
        }
      }
      if (method === 'CHECK') {
        if (!paymentEntry.checkOwnerName || !String(paymentEntry.checkOwnerName).trim()) {
          errors.push('نام صاحب چک را وارد کنید.');
        }
        if (!paymentEntry.handoverDate || !String(paymentEntry.handoverDate).trim()) {
          errors.push('تاریخ تحویل چک را انتخاب کنید.');
        }
        if (!paymentEntry.paymentDate || !String(paymentEntry.paymentDate).trim()) {
          errors.push('تاریخ پاس‌شدن چک را انتخاب کنید.');
        }
      }
      if (method === 'CASH' && !(paymentEntry as { cashType?: string }).cashType) {
        errors.push('نوع پرداخت نقدی را انتخاب کنید.');
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate wizard step
 */
export const validateWizardStep = (
  step: number,
  wizardData: ContractWizardData
): { isValid: boolean; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};
  
  switch (step) {
    case 1: // Contract Date
      if (!wizardData.contractDate) {
        errors.contractDate = 'تاریخ قرارداد را انتخاب کنید.';
      }
      if (!wizardData.contractNumber) {
        errors.contractNumber = 'شماره قرارداد مشخص نیست؛ صفحه را تازه‌سازی کنید.';
      }
      break;
      
    case 2: // Customer Selection
      if (!wizardData.customerId || !wizardData.customer) {
        errors.customer = 'یک مشتری انتخاب کنید.';
      } else if (wizardData.customer.id !== wizardData.customerId) {
        errors.customerId = 'اطلاعات مشتری ناسازگار است؛ مشتری را دوباره انتخاب کنید.';
      }
      break;
      
    case 3: // Project Management
      if (!wizardData.projectId || !wizardData.project) {
        errors.project = 'یک پروژه انتخاب کنید.';
      } else {
        const identityError = validateContractPartyIdentity(wizardData);
        if (identityError) errors.projectId = identityError;
      }
      break;
      
    case 4: // Product Selection
      if ((!wizardData.products || wizardData.products.length === 0) && (!wizardData.serviceRows || wizardData.serviceRows.length === 0)) {
        errors.products = 'حداقل یک محصول یا خدمت به قرارداد اضافه کنید.';
      } else {
        // Validate each product
        wizardData.products.forEach((product, index) => {
          const productValidation = validateProduct(product);
          if (!productValidation.isValid) {
            errors[`product_${index}`] = productValidation.errors.join(', ');
          }
        });
      }
      break;
      
    case 5: // Delivery Schedule
      if (!wizardData.deliveries || wizardData.deliveries.length === 0) {
        errors.deliveries = 'حداقل یک برنامه تحویل یا اجرا اضافه کنید.';
      } else {
        const deliveryReferences = reconcileDeliveryProductReferences(wizardData.products, wizardData.deliveries);
        if (deliveryReferences.conflicts.length > 0) {
          errors.deliveries = `برنامه تحویل نیاز به بازبینی دارد: ${deliveryReferences.conflicts.map((conflict) => conflict.message).join(' | ')}`;
        }
        // Validate all products are distributed
        const totalProductQuantities = getDeliverableProductEntries(wizardData.products).reduce((acc, { product }) => {
          if (product.rowId) acc[`product-${product.rowId}`] = getDeliveryTargetAmount(product);
          return acc;
        }, {} as Record<string, number>);
        const totalServiceQuantities = (wizardData.serviceRows || []).reduce((acc, row) => {
          acc[`service-${row.id}`] = toFiniteNumber(row.quantity);
          return acc;
        }, {} as Record<string, number>);
        
        const deliveredQuantities: Record<string, number> = {};
        deliveryReferences.deliveries.forEach(delivery => {
          delivery.products.forEach(dp => {
            const key = dp.rowType === 'service'
              ? `service-${dp.serviceRowId}`
              : `product-${dp.productRowId}`;
            if (!deliveredQuantities[key]) {
              deliveredQuantities[key] = 0;
            }
            deliveredQuantities[key] += toFiniteNumber(dp.amount ?? dp.quantity);
          });
        });
        
        // Check if all rows are fully distributed
        for (const [rowKey, totalQuantity] of Object.entries({ ...totalProductQuantities, ...totalServiceQuantities })) {
          const delivered = deliveredQuantities[rowKey] || 0;
          if (delivered < totalQuantity && !errors.deliveries) {
            errors.deliveries = 'توزیع محصولات و خدمات کامل نیست؛ مقدار باقی‌مانده هر ردیف را در یک برنامه تحویل یا اجرا قرار دهید.';
            break;
          }
        }
        
        // Validate each delivery
        deliveryReferences.deliveries.forEach((delivery, index) => {
          const deliveryValidation = validateDelivery(delivery, wizardData.products, wizardData.serviceRows || []);
          if (!deliveryValidation.isValid) {
            errors[`delivery_${index}`] = deliveryValidation.errors.join(', ');
          }
        });
      }
      break;
      
    case 6: // Payment Method
      const contractTotal = toFiniteNumber(wizardData.payment.totalContractAmount) ||
        sumNumericValues(wizardData.products, (product) => product.totalPrice) +
        sumNumericValues(wizardData.serviceRows || [], (row) => row.totalPrice);
      const paymentValidation = validatePayment(wizardData.payment, contractTotal);
      if (!paymentValidation.isValid) {
        errors.payment = paymentValidation.errors.join(', ');
      }
      break;
      
    case 7: // Digital Signature
      if (!wizardData.signature?.phoneNumber) {
        errors.signature = 'شماره تماس مشتری موجود نیست';
      }
      if (wizardData.signature?.confirmationStatus !== 'VERIFIED') {
        errors.signature = 'قرارداد هنوز توسط مشتری تایید نشده است';
      }
      break;
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};
