'use client';

import React from 'react';
import { previewPartnerTechnicalDraft, type PartnerTechnicalDraft,
  type PartnerTechnicalPreviewCatalog } from '@sabalanerp/partner-sales-contracts';
import { ProductPricingVisibility } from '../components/product-modal-system/productPricingVisibility';

/** Reuses canonical product/operation sections without catalog editing or
 * pricing inputs. The host supplies the technical-only projection and the same
 * canonical graph controller; it never substitutes a second product model.
 */
type ConfigurationProps =
  | { children: React.ReactNode; draft?: never; catalog?: never }
  | { draft: PartnerTechnicalDraft; catalog: PartnerTechnicalPreviewCatalog;
      children: (preview: ReturnType<typeof previewPartnerTechnicalDraft>) => React.ReactNode };

export function TechnicalProductConfiguration(props: ConfigurationProps) {
  // A synchronous canonical preview belongs to these exact input objects. No
  // worker response can replace a newer edit, and no preview grants saved refs.
  const preview = React.useMemo(() => props.draft && props.catalog
    ? previewPartnerTechnicalDraft(props.draft, props.catalog) : null,
  [props.draft, props.catalog]);
  return <ProductPricingVisibility.Provider value={false}>
    {typeof props.children === 'function'
      ? preview && props.children(preview)
      : props.children}
  </ProductPricingVisibility.Provider>;
}
