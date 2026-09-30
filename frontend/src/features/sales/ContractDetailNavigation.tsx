'use client';

import React from 'react';
import { ErpSegmentedControl } from '@/components/erp';

export type ContractDetailSection = 'summary' | 'items' | 'financial' | 'history';

export function ContractDetailNavigation({ value, onChange }: {
  value: ContractDetailSection; onChange: (section: ContractDetailSection) => void;
}) {
  return <ErpSegmentedControl value={value} onChange={onChange} options={[
    { value: 'summary', label: 'خلاصه' }, { value: 'items', label: 'اقلام و تحویل' },
    { value: 'financial', label: 'وضعیت مالی' }, { value: 'history', label: 'سوابق' },
  ]} />;
}
