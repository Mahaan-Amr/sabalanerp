import { useEffect, useState } from 'react';
import type { Product } from '../types/contract.types';

type Search = (query: string) => Promise<Product[]>;

export function useStairStoneSearch(term: string, search: Search) {
  const query = term.trim();
  const [completed, setCompleted] = useState<{
    query: string;
    search: Search;
    products: Product[];
  }>();

  useEffect(() => {
    setCompleted(undefined);
    if (!query) return;

    let active = true;
    const timer = setTimeout(() => {
      void search(query).then(
        products => {
          if (active) setCompleted({ query, search, products });
        },
        () => {
          if (active) setCompleted({ query, search, products: [] });
        }
      );
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  const current = completed?.query === query && completed.search === search ? completed : undefined;
  return {
    products: current?.products ?? [],
    loading: Boolean(query && !current)
  };
}
