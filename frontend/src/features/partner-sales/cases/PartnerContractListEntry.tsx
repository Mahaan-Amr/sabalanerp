'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PartnerCreationContextSchema, type PartnerCreationContext } from '@sabalanerp/partner-sales-contracts';
import { ErpInlineState, ErpLoading } from '@/components/erp';
import api from '@/lib/api';
import { useRouter, useSearchParams } from 'next/navigation';
import { PartnerCaseRuntime } from './PartnerCaseRuntime';
import { partnerSalesActionFeedback } from '../partnerSalesErrorMessage';

export function PartnerContractListEntry({ ordinary, legacy = false }: { ordinary: ReactNode; legacy?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [context, setContext] = useState<PartnerCreationContext>();
  const [error, setError] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration(value => value + 1), []);
  useEffect(() => {
    let active = true;
    setError(undefined);
    void api.get('/partner/cases/creation-context?purpose=CONTRACT_LIST').then(response => {
      const result = PartnerCreationContextSchema.parse(response.data?.data);
      if (active) setContext(result);
    }).catch(reason => { if (active) setError(partnerSalesActionFeedback(reason, 'دریافت قراردادهای فروش').message); });
    return () => { active = false; };
  }, [generation]);
  useEffect(() => {
    if (legacy && context?.kind === 'PARTNER') router.replace(`/dashboard/sales/contracts${searchParams.size ? `?${searchParams}` : ''}`);
  }, [legacy, context?.kind, router, searchParams]);
  if (legacy && context?.kind === 'PARTNER') return <ErpLoading />;
  if (error) return <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: retry }} />;
  if (!context) return <ErpLoading />;
  return context.kind === 'PARTNER' ? <PartnerCaseRuntime recoverableDrafts={context.recoverableDrafts ??
    (context.recoverableDraft ? [context.recoverableDraft] : [])} /> : ordinary;
}
