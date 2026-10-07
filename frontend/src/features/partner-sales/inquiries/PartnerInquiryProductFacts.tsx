import React from 'react';
import { ErpSummaryGrid } from '@/components/erp';

/** Read-only snapshot facts. Never derive stone consumption from money or guess piece counts. */
export function PartnerInquiryProductFacts({ configuration }: { configuration: readonly { label: string; value: string }[] }) {
  const read = (label: string) => configuration.find(fact => fact.label === label)?.value;
  const persian = (value: string) => value.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  const items = [
    { label: 'نوع محصول', value: read('خانواده محصول') ?? read('کاربرد') },
    { label: 'تعداد', value: read('تعداد') ?? (read('خانواده محصول') ? 'ثبت نشده' : undefined) },
    { label: 'سنگ اصلی', value: read('سنگ اصلی') },
    { label: 'متراژ سنگ مصرفی اصلی', value: read('متراژ سنگ مصرفی اصلی') },
  ].flatMap(item => item.value === undefined ? [] : [{ label: item.label, value: persian(item.value) }]);
  return <ErpSummaryGrid items={items} columns={4} />;
}
