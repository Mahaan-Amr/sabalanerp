import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  recordSellerProductSelection,
  type SellerProductHistory
} from '../components/steps/catalogProductRanking';
import { salesAPI } from '@/lib/api';

const STORAGE_PREFIX = 'sabalan-contract-product-history';

const parseHistory = (raw: string | null): SellerProductHistory => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as SellerProductHistory : {};
  } catch {
    return {};
  }
};

export const useSellerProductHistory = (sellerIdentity: string | null | undefined) => {
  const storageKey = useMemo(
    () => sellerIdentity ? `${STORAGE_PREFIX}:${sellerIdentity}` : null,
    [sellerIdentity]
  );
  const [history, setHistory] = useState<SellerProductHistory>({});

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      setHistory({});
      return;
    }
    const localHistory = parseHistory(window.localStorage.getItem(storageKey));
    setHistory(localHistory);
    let cancelled = false;
    salesAPI.getSellerProductHistory()
      .then(response => {
        if (cancelled || !response.data?.success) return;
        const serverHistory = response.data.data as SellerProductHistory;
        setHistory(current => {
          const merged = { ...serverHistory };
          Object.entries(current).forEach(([productId, local]) => {
            const server = merged[productId];
            merged[productId] = {
              selectionCount: (server?.selectionCount ?? 0) + local.selectionCount,
              lastSelectedAt: !server?.lastSelectedAt || (
                local.lastSelectedAt && local.lastSelectedAt > server.lastSelectedAt
              )
                ? local.lastSelectedAt
                : server.lastSelectedAt
            };
          });
          return merged;
        });
      })
      .catch(() => {
        // Personalized ranking is optional; the unified catalog remains usable.
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const recordSelection = useCallback((productId: string) => {
    if (!storageKey) return;
    setHistory(current => {
      const next = recordSellerProductSelection(current, productId, new Date().toISOString());
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      }
      return next;
    });
  }, [storageKey]);

  return { history, recordSelection };
};
