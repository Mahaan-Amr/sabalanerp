// Validation service
// Handles validation for products, deliveries, payments, and wizard steps

import type { ContractProduct, DeliverySchedule, PaymentMethod, ContractWizardData } from '../types/contract.types';

/**
 * Validate a product configuration
 */
export const validateProduct = (product: Partial<ContractProduct>): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!product.productId) {
    errors.push('محصول باید انتخاب شود');
  }
  
  if (!product.quantity || product.quantity <= 0) {
    errors.push('تعداد باید بزرگتر از صفر باشد');
  }
  
  if (!product.pricePerSquareMeter || product.pricePerSquareMeter <= 0) {
    errors.push('قیمت هر متر مربع باید وارد شود');
  }
  
  if (product.productType === 'longitudinal' || product.productType === 'slab') {
    if (!product.length || product.length <= 0) {
      errors.push('طول باید وارد شود');
    }
    if (!product.width || product.width <= 0) {
      errors.push('عرض باید وارد شود');
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
    errors.push('تاریخ تحویل باید انتخاب شود');
  }
  
  if (!delivery.receiverName || delivery.receiverName.trim() === '') {
    errors.push('نام تحویل‌گیرنده باید وارد شود');
  }
  
  if (!delivery.products || delivery.products.length === 0) {
    errors.push('حداقل یک محصول باید برای تحویل انتخاب شود');
  }
  
  // Validate product quantities don't exceed available quantities
  if (delivery.products && delivery.products.length > 0) {
    for (const deliveryProduct of delivery.products) {
      const product = products[deliveryProduct.productIndex];
      if (product) {
        const totalDelivered = delivery.products
          .filter(p => p.productIndex === deliveryProduct.productIndex)
          .reduce((sum, p) => sum + p.quantity, 0);
        
        if (totalDelivered > product.quantity) {
          errors.push(`تعداد تحویل برای محصول ${product.stoneName} بیش از تعداد موجود است`);
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
    errors.push('حداقل یک روش پرداخت باید تعریف شود');
  }
  
  if (payment.payments && payment.payments.length > 0) {
    const totalPaymentAmount = payment.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    
    if (Math.abs(totalPaymentAmount - totalContractAmount) > 0.01) {
      errors.push(`مجموع مبالغ پرداخت (${totalPaymentAmount}) باید برابر با مبلغ کل قرارداد (${totalContractAmount}) باشد`);
    }
    
    // Validate individual payment entries
    for (const paymentEntry of payment.payments) {
      if (!paymentEntry.amount || paymentEntry.amount <= 0) {
        errors.push('مبلغ پرداخت باید بزرگتر از صفر باشد');
      }
      
      if (!paymentEntry.paymentDate) {
        errors.push('تاریخ پرداخت باید انتخاب شود');
      }
      
      if (paymentEntry.method === 'CHECK' && !paymentEntry.checkNumber) {
        errors.push('شماره چک برای پرداخت چکی الزامی است');
      }
      
      if (paymentEntry.method === 'CASH' && !paymentEntry.cashType) {
        errors.push('نوع پرداخت نقدی باید انتخاب شود');
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
        errors.contractDate = 'تاریخ قرارداد باید انتخاب شود';
      }
      if (!wizardData.contractNumber) {
        errors.contractNumber = 'شماره قرارداد باید تولید شود';
      }
      break;
      
    case 2: // Customer Selection
      if (!wizardData.customerId || !wizardData.customer) {
        errors.customer = 'مشتری باید انتخاب شود';
      }
      break;
      
    case 3: // Project Management
      if (!wizardData.projectId || !wizardData.project) {
        errors.project = 'پروژه باید انتخاب یا ایجاد شود';
      }
      break;
      
    case 4: // Product Type Selection
      // This step is just for selection, no validation needed
      break;
      
    case 5: // Product Selection
      if (!wizardData.products || wizardData.products.length === 0) {
        errors.products = 'حداقل یک محصول باید به قرارداد اضافه شود';
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
      
    case 6: // Delivery Schedule
      if (!wizardData.deliveries || wizardData.deliveries.length === 0) {
        errors.deliveries = 'حداقل یک برنامه تحویل باید تعریف شود';
      } else {
        // Validate all products are distributed
        const totalProductQuantities = wizardData.products.reduce((acc, p) => {
          acc[p.productId] = p.quantity;
          return acc;
        }, {} as Record<string, number>);
        
        const deliveredQuantities: Record<string, number> = {};
        wizardData.deliveries.forEach(delivery => {
          delivery.products.forEach(dp => {
            if (!deliveredQuantities[dp.productId]) {
              deliveredQuantities[dp.productId] = 0;
            }
            deliveredQuantities[dp.productId] += dp.quantity;
          });
        });
        
        // Check if all products are fully distributed
        for (const [productId, totalQuantity] of Object.entries(totalProductQuantities)) {
          const delivered = deliveredQuantities[productId] || 0;
          if (delivered < totalQuantity) {
            errors.deliveries = `همه محصولات باید به طور کامل در برنامه تحویل توزیع شوند`;
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
      
    case 7: // Payment Method
      const contractTotal = wizardData.products.reduce((sum, p) => sum + (p.totalPrice || 0), 0);
      const paymentValidation = validatePayment(wizardData.payment, contractTotal);
      if (!paymentValidation.isValid) {
        errors.payment = paymentValidation.errors.join(', ');
      }
      break;
      
    case 8: // Digital Signature
      if (!wizardData.signature?.phoneNumber) {
        errors.signature = 'شماره تلفن برای امضای دیجیتال باید وارد شود';
      }
      if (!wizardData.signature?.codeVerified) {
        errors.signature = 'کد تایید باید تایید شود';
      }
      break;
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

