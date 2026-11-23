"use client";

import { useCallback, useEffect, useState } from "react";
import { accountingAPI } from "@/lib/api";
import { accountingFailureMessage } from "./accountingUi";

export interface TreasuryCustomerOption {
  id: string;
  displayName: string;
}

export interface TreasuryCustomerBalance {
  asOf: string;
  netBalanceRials: string;
  openItems: Array<{ id: string; invoiceNumber: string; remainingRials: string }>;
}

export const readTreasurySummary = (checkId: string, signal: AbortSignal) =>
  accountingAPI.getTreasurySummary(checkId || undefined, signal).then(response => response.data.data);
export const readTreasuryLedger = (_key: string, signal: AbortSignal) =>
  accountingAPI.getLedgerContext(signal).then(response => response.data.data);
export const readTreasuryBankPage = (page: number, signal: AbortSignal) =>
  accountingAPI.getTreasuryBankLines(page, signal).then(response => response.data.data);
export const readTreasuryCustomerOptions = (search: string, signal: AbortSignal): Promise<TreasuryCustomerOption[]> =>
  accountingAPI.searchTreasuryCustomerProfiles(search, signal).then(response => response.data.data);
export const readTreasuryCustomerBalance = (id: string, signal: AbortSignal): Promise<TreasuryCustomerBalance> =>
  accountingAPI.getTreasuryCustomerBalance(id, signal).then(response => response.data.data);

export function useTreasuryRead<Key, Data>(
  key: Key | undefined,
  load: (key: Key, signal: AbortSignal) => Promise<Data>,
  failureMessage: string,
  debounceMs = 0,
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: Key; attempt: number; data?: Data; error?: string; denied?: boolean;
  }>();
  const retry = useCallback(() => setAttempt(previous => previous + 1), []);
  const discard = useCallback(() => setResult(undefined), []);
  useEffect(() => {
    if (key === undefined) {
      setResult(undefined);
      return;
    }
    const abort = new AbortController();
    const request = async () => {
      try {
        const data = await load(key, abort.signal);
        if (!abort.signal.aborted) setResult({ key, attempt, data });
      } catch (reason) {
        if (abort.signal.aborted) return;
        const status = (reason as { response?: { status?: number } })?.response?.status;
        const denied = status === 401 || status === 403;
        setResult(previous => ({ key, attempt, denied, error: accountingFailureMessage(reason, failureMessage),
          data: !denied && previous?.key === key ? previous.data : undefined }));
      }
    };
    const timer = debounceMs ? setTimeout(request, debounceMs) : undefined;
    if (timer === undefined) void request();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [key, attempt, load, failureMessage, debounceMs]);

  const active = key !== undefined && result?.key === key ? result : undefined;
  const settled = active?.attempt === attempt;
  return { data: active?.data, cachedData: result?.data, denied: active?.denied, error: settled ? active?.error : undefined,
    pending: key !== undefined && !settled, retry, discard };
}
