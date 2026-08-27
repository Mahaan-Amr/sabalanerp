'use client';

import React from 'react';
import { ProductPricingVisibility } from '../components/product-modal-system/productPricingVisibility';

/** Reuses canonical product/operation sections without catalog editing or
 * pricing inputs. The host supplies the technical-only projection and the same
 * canonical graph controller; it never substitutes a second product model.
 */
export function TechnicalProductConfiguration({ children }: { children: React.ReactNode }) {
  return <ProductPricingVisibility.Provider value={false}>{children}</ProductPricingVisibility.Provider>;
}
