'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ErpCard, ErpInput, ErpPressable } from '@/components/erp';
import { moveCatalogHighlight, scrollHighlightedCatalogItem } from './catalogProductRanking';

export type ContractCatalogFamily = 'longitudinal' | 'stair' | 'slab' | 'prepared';

export interface ContractCatalogItem {
  id: string;
  name: string;
  facts: string;
}

export interface ContractCatalogTypeOption {
  id: ContractCatalogFamily;
  label: string;
  count: number;
}

interface ContractProductCatalogProps {
  query: string;
  onQueryChange: (value: string) => void;
  activeType: ContractCatalogFamily | null;
  onTypeChange: (value: ContractCatalogFamily | null) => void;
  typeOptions: readonly ContractCatalogTypeOption[];
  items: readonly ContractCatalogItem[];
  onSelect: (item: ContractCatalogItem) => void;
  searchId?: string;
}

/** The one catalog/search/list surface used by every contract-creation channel. */
export function ContractProductCatalog({ query, onQueryChange, activeType, onTypeChange,
  typeOptions, items, onSelect, searchId = 'contract-product-search' }: ContractProductCatalogProps) {
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const highlightedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setHighlightedIndex(null);
  }, [activeType, query]);
  useEffect(() => {
    scrollHighlightedCatalogItem(highlightedRef.current);
  }, [highlightedIndex]);

  const selectHighlighted = () => {
    if (highlightedIndex === null) return;
    const item = items[highlightedIndex];
    if (item) onSelect(item);
  };

  return <section aria-label="کاتالوگ محصولات"><ErpCard className="p-4">
    <div className="flex gap-1 overflow-x-auto pb-3" role="tablist" aria-label="نوع محصول">
      <ErpPressable type="button" role="tab" aria-selected={!activeType}
        onClick={() => onTypeChange(null)} tone={!activeType ? 'primary' : 'neutral'}
        variant={!activeType ? 'solid' : 'ghost'} className="min-h-11 px-3 text-xs">همه</ErpPressable>
      {typeOptions.map(type => <ErpPressable key={type.id} type="button" role="tab"
        aria-selected={activeType === type.id} onClick={() => onTypeChange(type.id)}
        tone={activeType === type.id ? 'primary' : 'neutral'}
        variant={activeType === type.id ? 'solid' : 'ghost'} className="min-h-11 px-3 text-xs">
        {type.label}
      </ErpPressable>)}
    </div>
    <label htmlFor={searchId} className="sds-text-secondary mb-1 block text-xs font-medium">جستجوی محصول</label>
    <ErpInput id={searchId} type="search" value={query} onChange={event => onQueryChange(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setHighlightedIndex(current => moveCatalogHighlight(current,
            event.key === 'ArrowDown' ? 'next' : 'previous', items.length));
        } else if (event.key === 'Enter') {
          event.preventDefault(); selectHighlighted();
        }
      }} className="w-full px-3 py-2 text-sm"
      aria-controls={`${searchId}-results`}
      aria-activedescendant={highlightedIndex === null ? undefined : `${searchId}-result-${highlightedIndex}`} />
    <div id={`${searchId}-results`} role="listbox" className="sds-divider mt-2 max-h-80 overflow-y-auto border-t">
      {items.length === 0 ? <div className="sds-text-muted py-4 text-sm">محصولی پیدا نشد</div>
        : items.map((item, index) => {
          const highlighted = highlightedIndex === index;
          return <ErpPressable key={item.id} ref={highlighted ? highlightedRef : null}
            id={`${searchId}-result-${index}`} type="button" role="option" aria-selected={highlighted}
            onMouseEnter={() => setHighlightedIndex(index)} onClick={() => onSelect(item)}
            className={`sds-divider grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-2 py-2.5 text-right last:border-b-0 ${highlighted ? 'bg-[var(--sds-accent-soft)]' : ''}`}>
            <span className="min-w-0"><strong className="sds-text-primary block truncate text-sm">{item.name}</strong>
              <span className="sds-text-muted mt-0.5 block truncate text-xs">{item.facts}</span></span>
            <span className="text-xs font-medium text-[var(--sds-accent)]">انتخاب</span>
          </ErpPressable>;
        })}
    </div>
  </ErpCard></section>;
}
