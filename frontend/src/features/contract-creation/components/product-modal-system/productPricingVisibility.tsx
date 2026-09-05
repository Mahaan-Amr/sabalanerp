'use client';

import React from 'react';

// Presentation only. Technical catalog/recovery adapters must exclude rates
// before data reaches the browser; this context is not an authorization gate.
export const ProductPricingVisibility = React.createContext(true);
export const useProductPricingVisibility = () => React.useContext(ProductPricingVisibility);
