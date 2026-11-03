import React from 'react';
import type {
  ContractProduct,
  ContractUsageType,
  ContractWizardData,
  Product,
  StoneFinishing,
  SubService
} from '../../types/contract.types';
import { CompactProductConfigurationModal } from './CompactProductConfigurationModal';

/**
 * Compatibility seam for the wizard while the product editor is being split
 * into focused modules. The legacy modal implementation has intentionally been
 * removed: stair products are rendered by the canonical stair editor and every
 * other supported family is rendered by the compact central modal.
 */
interface ProductConfigurationModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: () => void;
  readonly onProductTypeChange?: (
    type: ContractUsageType,
    selectedProduct: Product | null
  ) => void;
  readonly selectedProduct: Product | null;
  readonly productConfig: Partial<ContractProduct>;
  readonly setProductConfig: React.Dispatch<React.SetStateAction<Partial<ContractProduct>>>;
  readonly setLengthUnit: React.Dispatch<React.SetStateAction<'cm' | 'm'>>;
  readonly setWidthUnit: React.Dispatch<React.SetStateAction<'cm' | 'm'>>;
  readonly setIsMandatory: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setMandatoryPercentage: React.Dispatch<React.SetStateAction<number>>;
  readonly isEditMode: boolean;
  readonly getCuttingTypePricePerMeter: (cutTypeCode: string) => number | null;
  readonly subServices?: readonly SubService[];
  readonly stoneFinishings?: readonly StoneFinishing[];
  readonly wizardData: ContractWizardData;
  readonly error?: string;
}

export const ProductConfigurationModal: React.FC<ProductConfigurationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onProductTypeChange,
  selectedProduct,
  productConfig,
  setProductConfig,
  setLengthUnit,
  setWidthUnit,
  setIsMandatory,
  setMandatoryPercentage,
  isEditMode,
  getCuttingTypePricePerMeter,
  subServices = [],
  stoneFinishings = [],
  wizardData,
  error
}) => {
  if (!isOpen || !selectedProduct) return null;

  const rememberedType = wizardData.selectedProductTypeForAddition;
  const selectedType = productConfig.productType || rememberedType;
  const currentProductType =
    selectedType === 'volumetric' ? 'prepared' : selectedType;

  if (
    currentProductType !== 'longitudinal' &&
    currentProductType !== 'slab' &&
    currentProductType !== 'prepared'
  ) {
    return null;
  }

  return (
    <CompactProductConfigurationModal
      selectedProduct={selectedProduct}
      currentProductType={currentProductType}
      productConfig={productConfig}
      setProductConfig={setProductConfig}
      setLengthUnit={setLengthUnit}
      setWidthUnit={setWidthUnit}
      setIsMandatory={setIsMandatory}
      setMandatoryPercentage={setMandatoryPercentage}
      isEditMode={isEditMode}
      onProductTypeChange={onProductTypeChange}
      onClose={onClose}
      onSave={onSave}
      getCuttingTypePricePerMeter={getCuttingTypePricePerMeter}
      subServices={subServices}
      stoneFinishings={stoneFinishings}
      error={error}
    />
  );
};
