'use client';

import React from 'react';
import { ErpBadge } from '@/components/erp';
import type { AccountingContractRow } from './accountingUi';

export default function AccountingCustomerCategoryBadge({ contract }: {
  contract: Pick<AccountingContractRow, 'customer' | 'sourceKind' | 'partnerContext'>;
}) {
  if (contract.sourceKind === 'PARTNER_INTERNAL_RECORD' || contract.partnerContext || contract.customer?.partnerOwnerProfileId) {
    return null;
  }

  const category = contract.customer?.trustCategory;
  const label = category === 'SPECIAL' ? 'مشتری خاص'
    : category === 'NORMAL' ? 'مشتری عادی' : 'دسته مشتری نامشخص';

  return <ErpBadge tone={category === 'SPECIAL' ? 'purple' : 'neutral'}><span className="whitespace-nowrap">{label}</span></ErpBadge>;
}
