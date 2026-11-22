export type CatalogFamily='longitudinal'|'stair'|'slab'|'prepared';
export type CatalogClassification={name?:string;namePersian?:string;cuttingDimensionName?:string;cuttingDimensionNamePersian?:string;availableInLongitudinalContracts?:boolean;availableInStairContracts?:boolean;availableInSlabContracts?:boolean;availableInVolumetricContracts?:boolean};
export function inferCatalogFamily(product:CatalogClassification):CatalogFamily {
  const classification = [
    product.cuttingDimensionNamePersian,
    product.cuttingDimensionName,
    product.namePersian,
    product.name
  ].filter(Boolean).join(' ').toLocaleLowerCase('fa');

  if (classification.includes('اسلب') || classification.includes('slab')) return 'slab';
  if (
    classification.includes('کیوبیک') ||
    classification.includes('قطعات آماده') ||
    classification.includes('حجمی') ||
    classification.includes('cubic') ||
    classification.includes('prepared') ||
    classification.includes('cnc')
  ) return 'prepared';
  if (classification.includes('پله') || classification.includes('stair')) return 'stair';
  if (classification.includes('طولی') || classification.includes('longitudinal')) return 'longitudinal';

  if (product.availableInLongitudinalContracts) return 'longitudinal';
  if (product.availableInStairContracts) return 'stair';
  if (product.availableInSlabContracts) return 'slab';
  if (product.availableInVolumetricContracts) return 'prepared';
  return 'longitudinal';
}
export function catalogSupportsFamily(product:CatalogClassification,family:CatalogFamily) {
 const inferred=inferCatalogFamily(product);
 return family==='stair'?inferred==='stair'||inferred==='longitudinal'||product.availableInStairContracts===true:inferred===family;
}
