'use client';

import React from 'react';
import type { PartnerCommand } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpCard } from '@/components/erp';

export function ResponseReview({ decisions, rowNumbers }: {
  decisions: Extract<PartnerCommand, { type: 'INQUIRY_DECIDE' }>['decisions']; rowNumbers: Record<string, number>;
}) {
  return <div className="space-y-3">
    <p className="sds-text-secondary leading-7">قیمت هر ردیف مستقل ثبت می‌شود. نتیجه هر ردیف پس از ثبت نمایش داده خواهد شد.</p>
    {decisions.map(decision => <ErpCard key={decision.rowId} className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold">ردیف {rowNumbers[decision.rowId]}</h3>
        <ErpBadge tone={decision.outcome === 'APPROVED' ? 'success' : 'danger'}>{decision.outcome === 'APPROVED' ? 'تأیید' : 'رد'}</ErpBadge>
      </div>
      {decision.outcome === 'APPROVED'
        ? <><p>قیمت هر واحد: <b dir="ltr">{decision.wholesaleUnitPrice.amount}</b> {decision.wholesaleUnitPrice.currency === 'IRR' ? 'ریال' : 'تومان'}</p>{decision.note && <p className="break-words">{decision.note}</p>}</>
        : <p className="break-words">{decision.reason}</p>}
    </ErpCard>)}
  </div>;
}
