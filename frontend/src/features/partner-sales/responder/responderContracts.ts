import type { ResponderInquiryViewV2 } from '@sabalanerp/partner-sales-contracts';
import { partnerCustomerContractLabel } from '@sabalanerp/partner-sales-contracts';
import { sumPartnerDecimals } from '../presentation';

export type ResponderContract = { id: string; inquiries: ResponderInquiryViewV2[]; customer: string; label: string;
  partnerDisplayName: string; cancelled: boolean; pending: boolean; requestedAt: string; answeredAt?: string; answeredRows: number; currentRows: number };

export function responderContracts(inquiries: readonly ResponderInquiryViewV2[]): ResponderContract[] {
  const contracts = new Map<string, ResponderInquiryViewV2[]>();
  for (const inquiry of inquiries) {
    const id = inquiry.caseId ?? inquiry.inquiryId;
    contracts.set(id, [...(contracts.get(id) ?? []), inquiry]);
  }
  return Array.from(contracts, ([id, items]) => {
    const rows = items.flatMap(inquiry => inquiry.rows).filter(row => !row.superseded);
    const pending = rows.some(row => row.state === 'PENDING');
    return { id, inquiries: items, partnerDisplayName: items[0].partnerDisplayName,
      cancelled: items.some(inquiry => inquiry.rows.some(row => row.state === 'CANCELLED')), customer: items[0].customerDisplayName ?? 'نام مشتری ثبت نشده',
      label: items[0].customerContractNumber
        ? `شماره قرارداد ${partnerCustomerContractLabel('', items[0].customerContractNumber)}`
        : items[0].trackingNumber ? `کد پیگیری ${items[0].trackingNumber.toLocaleString('fa-IR', { useGrouping: false })}` : 'استعلام همکار',
      pending, requestedAt: (pending ? rows.filter(row => row.state === 'PENDING').flatMap(row => row.submittedAt ?? []) : []).sort()[0]
        ?? items.map(item => item.submittedAt).sort()[0],
      answeredAt: rows.flatMap(row => row.answeredAt ?? row.approvedAt ?? []).sort().at(-1),
      answeredRows: rows.filter(row => ['APPROVED', 'REJECTED', 'EXPIRED'].includes(row.state)).length, currentRows: rows.length };
  });
}

type Row = ResponderInquiryViewV2['rows'][number];
export type ResponderProductGroup = { key: string; rows: Row[]; display: Row };
export function responderProductGroups(inquiries: readonly ResponderInquiryViewV2[]): ResponderProductGroup[] {
  const groups = new Map<string, Row[]>();
  for (const row of inquiries.flatMap(inquiry => inquiry.rows).filter(row => !row.superseded && row.state !== 'CANCELLED')) {
    const code = row.configuration.find(fact => ['کد محصول', 'کد سنگ'].includes(fact.label))?.value ?? row.identity.catalogProductId;
    const key = JSON.stringify([code, row.description, row.identity.family, row.identity.unit, row.identity.currency]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Array.from(groups, ([key, rows]) => {
    const measures: NonNullable<Row['measures']> = {};
    for (const field of ['lengthMeters', 'areaSquareMeters', 'count', 'consumedAreaSquareMeters'] as const) {
      const values = rows.map(row => row.measures?.[field]);
      if (values.every((value): value is string => value !== undefined)) {
        const sum = sumPartnerDecimals(values);
        if (sum !== null) measures[field] = sum;
      }
    }
    const configuration = rows[0].configuration.filter(fact => ['کد محصول', 'کد سنگ'].includes(fact.label));
    const labels = { lengthMeters: 'مجموع طول', areaSquareMeters: 'مجموع مساحت', count: 'مجموع تعداد', consumedAreaSquareMeters: 'متراژ سنگ مصرفی اصلی' };
    for (const field of Object.keys(labels) as Array<keyof typeof labels>) if (measures[field] !== undefined) {
      configuration.push({ label: labels[field], value: `${measures[field]!.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])}${field === 'count' ? ' عدد' : field === 'lengthMeters' ? ' متر' : ' متر مربع'}` });
    }
    const commonPrice = rows.every(row => row.approvedPrice?.amount === rows[0].approvedPrice?.amount &&
      row.approvedPrice?.currency === rows[0].approvedPrice?.currency) ? rows[0].approvedPrice : undefined;
    return { key, rows, display: { ...rows[0], configuration, measures, approvedPrice: commonPrice, used: rows.some(row => row.used) } };
  });
}
