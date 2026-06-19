import type {
  ContractServiceRow,
  ContractServiceRowSourceType,
  ContractServiceRowUnit,
  CuttingType,
  StoneFinishing,
  SubService
} from '../types/contract.types';

type ServiceCatalogItem = SubService | CuttingType | StoneFinishing;

const makeServiceRowId = (sourceType: ContractServiceRowSourceType, sourceId: string) =>
  `${sourceType}-${sourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const getServiceRowUnitLabel = (unit: ContractServiceRowUnit): string => {
  if (unit === 'squareMeter') return 'متر مربع';
  if (unit === 'meter') return 'متر';
  return 'عدد';
};

export const getServiceRowSourceLabel = (sourceType: ContractServiceRowSourceType): string => {
  if (sourceType === 'tool') return 'ابزار';
  if (sourceType === 'cutting') return 'برش';
  return 'پرداخت سنگ';
};

export const getServiceRowUnitFromCatalog = (
  sourceType: ContractServiceRowSourceType,
  item: ServiceCatalogItem
): ContractServiceRowUnit => {
  if (sourceType === 'cutting') return 'meter';
  const calculationBase = 'calculationBase' in item ? item.calculationBase : undefined;
  return calculationBase === 'squareMeters' ? 'squareMeter' : 'meter';
};

export const getServiceRowUnitPriceFromCatalog = (
  sourceType: ContractServiceRowSourceType,
  item: ServiceCatalogItem
): number => {
  if (sourceType === 'finishing') {
    const finishing = item as StoneFinishing;
    return Number(finishing.unitPrice ?? finishing.pricePerSquareMeter ?? 0) || 0;
  }
  return Number((item as SubService | CuttingType).pricePerMeter ?? 0) || 0;
};

export const createContractServiceRow = (
  sourceType: ContractServiceRowSourceType,
  item: ServiceCatalogItem,
  quantity = 1,
  unitPrice?: number
): ContractServiceRow => {
  const normalizedQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const normalizedUnitPrice = unitPrice ?? getServiceRowUnitPriceFromCatalog(sourceType, item);

  return {
    id: makeServiceRowId(sourceType, item.id),
    sourceType,
    sourceId: item.id,
    sourceCode: 'code' in item ? item.code : null,
    title: item.namePersian || item.name || getServiceRowSourceLabel(sourceType),
    description: item.description || '',
    unit: getServiceRowUnitFromCatalog(sourceType, item),
    quantity: normalizedQuantity,
    unitPrice: normalizedUnitPrice,
    totalPrice: normalizedQuantity * normalizedUnitPrice,
    currency: 'تومان'
  };
};

export const recalculateContractServiceRow = (
  row: ContractServiceRow,
  updates: Partial<Pick<ContractServiceRow, 'quantity' | 'unitPrice' | 'description'>>
): ContractServiceRow => {
  const quantity = updates.quantity ?? row.quantity;
  const unitPrice = updates.unitPrice ?? row.unitPrice;
  return {
    ...row,
    ...updates,
    quantity,
    unitPrice,
    totalPrice: Math.max(quantity, 0) * Math.max(unitPrice, 0)
  };
};

