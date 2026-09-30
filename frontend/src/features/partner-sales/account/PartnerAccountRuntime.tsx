'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PartnerAccountView } from '@sabalanerp/partner-sales-contracts';
import { ErpInlineState, ErpLoading } from '@/components/erp';
import { readPartnerAccount } from '../cases/partnerCaseHttpPort';
import { PartnerAccountPanel } from './PartnerAccountPanel';

export function PartnerAccountRuntime() {
  const [account, setAccount] = useState<PartnerAccountView>();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setPending(true); setError(false);
    try { setAccount(await readPartnerAccount()); }
    catch { setError(true); }
    finally { setPending(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <div className="space-y-4">
    {error && <ErpInlineState kind="error" title="دریافت حساب شما با سبلان انجام نشد."
      action={{ label: 'تلاش دوباره', onClick: load }} />}
    {pending ? <ErpLoading /> : account && <PartnerAccountPanel view={account} />}
  </div>;
}
