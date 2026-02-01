// Delivery schedule hook
// Manages delivery creation and product distribution

import { useState, useCallback, useMemo } from 'react';
import type { DeliverySchedule, DeliveryProductItem, ContractProduct } from '../types/contract.types';
import { validateDelivery } from '../services/validationService';

export const useDeliverySchedule = (products: ContractProduct[]) => {
  const [deliveries, setDeliveries] = useState<DeliverySchedule[]>([]);
  const [selectedProductIndices, setSelectedProductIndices] = useState<Set<number>>(new Set());

  // Calculate total delivered quantity for a product
  const getTotalDeliveredQuantity = useCallback((productIndex: number): number => {
    return deliveries.reduce((total, delivery) => {
      const deliveryProduct = delivery.products.find(p => p.productIndex === productIndex);
      return total + (deliveryProduct?.quantity || 0);
    }, 0);
  }, [deliveries]);

  // Check if product is fully distributed
  const isProductFullyDistributed = useCallback((productIndex: number): boolean => {
    const product = products[productIndex];
    if (!product) return false;
    const totalDelivered = getTotalDeliveredQuantity(productIndex);
    return totalDelivered >= product.quantity;
  }, [products, getTotalDeliveredQuantity]);

  // Check if all products are fully distributed
  const areAllProductsDistributed = useMemo(() => {
    return products.every((_, index) => isProductFullyDistributed(index));
  }, [products, isProductFullyDistributed]);

  // Add new delivery
  const addDelivery = useCallback(() => {
    const newDelivery: DeliverySchedule = {
      deliveryDate: '',
      projectManagerName: '',
      receiverName: '',
      products: [],
      notes: ''
    };
    setDeliveries(prev => [...prev, newDelivery]);
    return deliveries.length; // Return index of new delivery
  }, [deliveries.length]);

  // Remove delivery
  const removeDelivery = useCallback((index: number) => {
    setDeliveries(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Update delivery
  const updateDelivery = useCallback((index: number, updates: Partial<DeliverySchedule>) => {
    setDeliveries(prev => prev.map((delivery, i) => 
      i === index ? { ...delivery, ...updates } : delivery
    ));
  }, []);

  // Add product to delivery
  const addProductToDelivery = useCallback((deliveryIndex: number, productIndex: number, quantity: number) => {
    setDeliveries(prev => prev.map((delivery, i) => {
      if (i !== deliveryIndex) return delivery;
      
      const existingProduct = delivery.products.find(p => p.productIndex === productIndex);
      if (existingProduct) {
        // Update existing product quantity
        return {
          ...delivery,
          products: delivery.products.map(p =>
            p.productIndex === productIndex
              ? { ...p, quantity }
              : p
          )
        };
      } else {
        // Add new product
        const product = products[productIndex];
        return {
          ...delivery,
          products: [
            ...delivery.products,
            {
              productIndex,
              productId: product?.productId || '',
              quantity
            }
          ]
        };
      }
    }));
  }, [products]);

  // Remove product from delivery
  const removeProductFromDelivery = useCallback((deliveryIndex: number, productIndex: number) => {
    setDeliveries(prev => prev.map((delivery, i) => {
      if (i !== deliveryIndex) return delivery;
      return {
        ...delivery,
        products: delivery.products.filter(p => p.productIndex !== productIndex)
      };
    }));
  }, []);

  // Validate all deliveries
  const validateDeliveries = useCallback((): { isValid: boolean; errors: Record<string, string> } => {
    const errors: Record<string, string> = {};
    
    if (deliveries.length === 0) {
      errors.general = 'حداقل یک برنامه تحویل باید تعریف شود';
      return { isValid: false, errors };
    }

    deliveries.forEach((delivery, index) => {
      const validation = validateDelivery(delivery, products);
      if (!validation.isValid) {
        errors[`delivery_${index}`] = validation.errors.join(', ');
      }
    });

    // Check if all products are fully distributed
    if (!areAllProductsDistributed) {
      errors.distribution = 'همه محصولات باید به طور کامل در برنامه تحویل توزیع شوند';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }, [deliveries, products, areAllProductsDistributed]);

  // Bulk add products to delivery
  const bulkAddProductsToDelivery = useCallback((deliveryIndex: number, productIndices: number[]) => {
    setDeliveries(prev => prev.map((delivery, i) => {
      if (i !== deliveryIndex) return delivery;
      
      const newProducts: DeliveryProductItem[] = [...delivery.products];
      
      productIndices.forEach(productIndex => {
        const existingIndex = newProducts.findIndex(p => p.productIndex === productIndex);
        const product = products[productIndex];
        if (!product) return;
        
        const alreadyDelivered = getTotalDeliveredQuantity(productIndex);
        const remaining = product.quantity - alreadyDelivered;
        
        if (existingIndex >= 0) {
          // Update existing
          newProducts[existingIndex].quantity = remaining;
        } else if (remaining > 0) {
          // Add new
          newProducts.push({
            productIndex,
            productId: product.productId,
            quantity: remaining
          });
        }
      });
      
      return {
        ...delivery,
        products: newProducts
      };
    }));
  }, [products, getTotalDeliveredQuantity]);

  return {
    // State
    deliveries,
    selectedProductIndices,
    areAllProductsDistributed,
    
    // Actions
    setDeliveries,
    setSelectedProductIndices,
    addDelivery,
    removeDelivery,
    updateDelivery,
    addProductToDelivery,
    removeProductFromDelivery,
    bulkAddProductsToDelivery,
    validateDeliveries,
    
    // Helpers
    getTotalDeliveredQuantity,
    isProductFullyDistributed
  };
};

