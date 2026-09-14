'use client';

import { useEffect, useState } from 'react';
import { PartnerCreationContextSchema } from '@sabalanerp/partner-sales-contracts';
import { ErpInlineState, ErpLoading } from '@/components/erp';
import api from '@/lib/api';
import { PartnerMyInquiriesRuntime } from './PartnerMyInquiriesRuntime';
import { PartnerResponderRuntime } from '../workspaces/PartnerResponderRuntime';

export function PartnerInquiryRouteRuntime() {
  const [persona, setPersona] = useState<'partner' | 'internal'>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void api.get('/partner/cases/creation-context').then(response => {
      const parsed = PartnerCreationContextSchema.safeParse((response.data as { data?: unknown })?.data);
      if (active) parsed.success ? setPersona(parsed.data.kind === 'PARTNER' ? 'partner' : 'internal') : setFailed(true);
    }).catch(() => active && setFailed(true));
    return () => { active = false; };
  }, []);
  if (failed) return <ErpInlineState kind="error" title="تشخیص فضای استعلام انجام نشد." />;
  if (!persona) return <ErpLoading />;
  return persona === 'partner' ? <PartnerMyInquiriesRuntime /> : <PartnerResponderRuntime />;
}
