// Validation service
// Handles validation for products, deliveries, payments, and wizard steps

import type { ContractProduct, DeliverySchedule, PaymentMethod, ContractWizardData } from '../types/contract.types';
import { sumNumericValues, toFiniteNumber } from '@/lib/numberFormat';

/**
 * Validate a product configuration
 */
export const validateProduct = (product: Partial<ContractProduct>): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!product.productId) {
    errors.push('انتخاب محصول الزامی است');
  }
  
  if (!product.quantity || product.quantity <= 0) {
    errors.push('تعداد باید بزرگ‌تر از صفر باشد');
  }
  
  if (!product.pricePerSquareMeter || product.pricePerSquareMeter <= 0) {
    errors.push('قیمت هر متر مربع الزامی است');
  }
  
  if (product.productType === 'longitudinal' || product.productType === 'slab') {
    if (!product.length || product.length <= 0) {
      errors.push('طول محصول الزامی است');
    }
    if (!product.width || product.width <= 0) {
      errors.push('عرض محصول الزامی است');
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
  products: ContractProduct[]
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!delivery.deliveryDate) {
    errors.push('تاریخ تحویل الزامی است');
  }
  
  if (!delivery.receiverName || delivery.receiverName.trim() === '') {
    errors.push('نام تحویل‌گیرنده الزامی است');
  }
  
  if (!delivery.products || delivery.products.length === 0) {
    errors.push('حداقل یک محصول برای تحویل انتخاب کنید');
  }
  
  // Validate product quantities don't exceed available quantities
  if (delivery.products && delivery.products.length > 0) {
    for (const deliveryProduct of delivery.products) {
      const product = products[deliveryProduct.productIndex];
      if (product) {
        const totalDelivered = delivery.products
          .filter(p => p.productIndex === deliveryProduct.productIndex)
          .reduce((sum, p) => sum + toFiniteNumber(p.quantity), 0);
        
        if (totalDelivered > toFiniteNumber(product.quantity)) {
          errors.push(`تعداد تحویل برای ${product.stoneName} بیشتر از تعداد محصول است`);
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
    errors.push('حداقل یک روش پرداخت الزامی است');
  }
  
  if (payment.payments && payment.payments.length > 0) {
    const totalPaymentAmount = sumNumericValues(payment.payments, (paymentEntry) => paymentEntry.amount);
    const normalizedContractAmount = toFiniteNumber(totalContractAmount);
    
    if (Math.abs(totalPaymentAmount - normalizedContractAmount) > 0.01) {
      errors.push(`جمع پرداخت‌ها (${totalPaymentAmount}) باید با مبلغ کل قرارداد (${normalizedContractAmount}) برابر باشد`);
    }
    
    // Validate individual payment entries (CASH_CARD | CASH_SHIBA | CHECK)
    for (const paymentEntry of payment.payments) {
      const method = (paymentEntry as { method?: string }).method;
      if (toFiniteNumber(paymentEntry.amount) <= 0) {
        errors.push('مبلغ پرداخت باید بزرگ‌تر از صفر باشد');
      }
      if (method === 'CASH_CARD' || method === 'CASH_SHIBA') {
        if (!paymentEntry.paymentDate || !String(paymentEntry.paymentDate).trim()) {
          errors.push('تاریخ پرداخت برای پرداخت نقدی الزامی است');
        }
      }
      if (method === 'CHECK') {
        if (!paymentEntry.checkOwnerName || !String(paymentEntry.checkOwnerName).trim()) {
          errors.push('نام صاحب چک الزامی است');
        }
        if (!paymentEntry.handoverDate || !String(paymentEntry.handoverDate).trim()) {
          errors.push('تاریخ تحویل چک الزامی است');
        }
        if (!paymentEntry.paymentDate || !String(paymentEntry.paymentDate).trim()) {
          errors.push('تاریخ پاس شدن چک الزامی است');
        }
      }
      if (method === 'CASH' && !(paymentEntry as { cashType?: string }).cashType) {
        errors.push('نوع پرداخت نقدی الزامی است');
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
        errors.contractDate = 'تاریخ قرارداد الزامی است';
      }
      if (!wizardData.contractNumber) {
        errors.contractNumber = 'شماره قرارداد الزامی است';
      }
      break;
      
    case 2: // Customer Selection
      if (!wizardData.customerId || !wizardData.customer) {
        errors.customer = 'انتخاب مشتری الزامی است';
      }
      break;
      
    case 3: // Project Management
      if (!wizardData.projectId || !wizardData.project) {
        errors.project = 'انتخاب پروژه الزامی است';
      }
      break;
      
    case 4: // Product Selection
      if ((!wizardData.products || wizardData.products.length === 0) && (!wizardData.serviceRows || wizardData.serviceRows.length === 0)) {
        errors.products = 'حداقل یک محصول یا خدمت به قرارداد اضافه کنید';
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
        errors.deliveries = 'حداقل یک برنامه تحویل تعریف کنید';
      } else {
        // Validate all products are distributed
        const totalProductQuantities = wizardData.products.reduce((acc, p) => {
          acc[p.productId] = toFiniteNumber(p.quantity);
          return acc;
        }, {} as Record<string, number>);
        
        const deliveredQuantities: Record<string, number> = {};
        wizardData.deliveries.forEach(delivery => {
          delivery.products.forEach(dp => {
            if (!deliveredQuantities[dp.productId]) {
              deliveredQuantities[dp.productId] = 0;
            }
            deliveredQuantities[dp.productId] += toFiniteNumber(dp.quantity);
          });
        });
        
        // Check if all products are fully distributed
        for (const [productId, totalQuantity] of Object.entries(totalProductQuantities)) {
          const delivered = deliveredQuantities[productId] || 0;
          if (delivered < totalQuantity) {
            errors.deliveries = `همه محصولات باید در برنامه‌های تحویل توزیع شوند`;
            break;
          }
        }
        
        // Validate each delivery
        wizardData.deliveries.forEach((delivery, index) => {
          const deliveryValidation = validateDelivery(delivery, wizardData.products);
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


