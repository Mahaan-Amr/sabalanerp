// Validation service
// Handles validation for products, deliveries, payments, and wizard steps

import type { ContractProduct, DeliverySchedule, PaymentMethod, ContractWizardData } from '../types/contract.types';

/**
 * Validate a product configuration
 */
export const validateProduct = (product: Partial<ContractProduct>): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!product.productId) {
    errors.push('??? ?? ??? ??');
  }
  
  if (!product.quantity || product.quantity <= 0) {
    errors.push('??? ?? ??? ? ?? ??');
  }
  
  if (!product.pricePerSquareMeter || product.pricePerSquareMeter <= 0) {
    errors.push('?? ? ?? ?? ?? ?? ??');
  }
  
  if (product.productType === 'longitudinal' || product.productType === 'slab') {
    if (!product.length || product.length <= 0) {
      errors.push('?? ?? ?? ??');
    }
    if (!product.width || product.width <= 0) {
      errors.push('?? ?? ?? ??');
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
    errors.push('??? ??? ?? ??? ??');
  }
  
  if (!delivery.receiverName || delivery.receiverName.trim() === '') {
    errors.push('?? ?? ?? ?? ??');
  }
  
  if (!delivery.products || delivery.products.length === 0) {
    errors.push('??? ? ??? ?? ?? ??? ??? ??');
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
          errors.push(`??? ??? ?? ??? ${product.stoneName} ?? ? ??? ??? ??`);
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
    errors.push('??? ? ?? ??? ?? ??? ??');
  }
  
  if (payment.payments && payment.payments.length > 0) {
    const totalPaymentAmount = payment.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    
    if (Math.abs(totalPaymentAmount - totalContractAmount) > 0.01) {
      errors.push(`??? ??? ??? (${totalPaymentAmount}) ?? ??? ? ?? ? ?? (${totalContractAmount}) ??`);
    }
    
    // Validate individual payment entries (CASH_CARD | CASH_SHIBA | CHECK)
    for (const paymentEntry of payment.payments) {
      const method = (paymentEntry as { method?: string }).method;
      if (!paymentEntry.amount || paymentEntry.amount <= 0) {
        errors.push('?? ??? ?? ??? ? ?? ??');
      }
      if (method === 'CASH_CARD' || method === 'CASH_SHIBA') {
        if (!paymentEntry.paymentDate || !String(paymentEntry.paymentDate).trim()) {
          errors.push('??? ??? ?? ?? ??? ??');
        }
      }
      if (method === 'CHECK') {
        if (!paymentEntry.checkNumber || !String(paymentEntry.checkNumber).trim()) {
          errors.push('??? ? ?? ??? ?? ??? ??');
        }
        if (!paymentEntry.checkOwnerName || !String(paymentEntry.checkOwnerName).trim()) {
          errors.push('?? ?? ? ??? ??');
        }
        if (!paymentEntry.handoverDate || !String(paymentEntry.handoverDate).trim()) {
          errors.push('??? ??? ? ??? ??');
        }
        if (!paymentEntry.paymentDate || !String(paymentEntry.paymentDate).trim()) {
          errors.push('??? ??? ? ??? ??');
        }
      }
      if (method === 'CASH' && !(paymentEntry as { cashType?: string }).cashType) {
        errors.push('?? ??? ?? ?? ??? ??');
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
        errors.contractDate = '??? ?? ?? ??? ??';
      }
      if (!wizardData.contractNumber) {
        errors.contractNumber = '??? ?? ?? ??? ??';
      }
      break;
      
    case 2: // Customer Selection
      if (!wizardData.customerId || !wizardData.customer) {
        errors.customer = '??? ?? ??? ??';
      }
      break;
      
    case 3: // Project Management
      if (!wizardData.projectId || !wizardData.project) {
        errors.project = '??? ?? ??? ? ??? ??';
      }
      break;
      
    case 4: // Product Type Selection
      // This step is just for selection, no validation needed
      break;
      
    case 5: // Product Selection
      if (!wizardData.products || wizardData.products.length === 0) {
        errors.products = '??? ? ??? ?? ? ?? ??? ??';
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
        errors.deliveries = '??? ? ??? ??? ?? ??? ??';
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
            errors.deliveries = `?? ?? ?? ? ?? ?? ? ??? ??? ??? ??`;
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


