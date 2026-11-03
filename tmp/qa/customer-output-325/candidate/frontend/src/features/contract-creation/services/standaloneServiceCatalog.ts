import { normalizeDigits } from '@/lib/numberFormat';

import type {
  ContractServiceRowSourceType,
  CuttingType,
  StoneFinishing,
  SubService
} from '../types/contract.types';

type ServiceCatalogRow = SubService | CuttingType | StoneFinishing;

export interface StandaloneServiceCatalogState {
  open: boolean;
  sourceType: ContractServiceRowSourceType;
  query: string;
}

export type StandaloneServiceCatalogAction =
  | {
    type: 'select-category';
    sourceType: ContractServiceRowSourceType;
  }
  | { type: 'focus-search' }
  | { type: 'service-added' };

export interface StandaloneServiceCatalogTransition
  extends StandaloneServiceCatalogState {
  focusSearch: boolean;
}

const normalizeSearchText = (value: unknown): string =>
  normalizeDigits(String(value ?? '')).toLowerCase();

export const filterStandaloneServiceCatalog = ({
  sourceType,
  query,
  subServices,
  cuttingTypes,
  stoneFinishings
}: {
  sourceType: ContractServiceRowSourceType;
  query: string;
  subServices: SubService[];
  cuttingTypes: CuttingType[];
  stoneFinishings: StoneFinishing[];
}): ServiceCatalogRow[] => {
  const sourceRows: ServiceCatalogRow[] =
    sourceType === 'tool'
      ? subServices
      : sourceType === 'cutting'
        ? cuttingTypes
        : stoneFinishings;
  const normalizedQuery = normalizeSearchText(query).trim();
  if (!normalizedQuery) return sourceRows;

  return sourceRows.filter(row => {
    const searchable = [
      row.namePersian,
      row.name,
      'code' in row ? row.code : '',
      row.description || ''
    ].join(' ');
    return normalizeSearchText(searchable).includes(normalizedQuery);
  });
};

export const nextStandaloneServiceCatalogState = (
  state: StandaloneServiceCatalogState,
  action: StandaloneServiceCatalogAction
): StandaloneServiceCatalogTransition => {
  if (action.type === 'select-category') {
    return {
      open: true,
      sourceType: action.sourceType,
      query: '',
      focusSearch: true
    };
  }
  if (action.type === 'service-added') {
    return {
      ...state,
      open: true,
      query: '',
      focusSearch: true
    };
  }
  return {
    ...state,
    open: true,
    focusSearch: false
  };
};
