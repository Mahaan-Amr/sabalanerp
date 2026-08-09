import { AccountingRecordStatus, FinancialRecordKind } from '@prisma/client';
import { isValidFinanciallyApprovedInvoice } from '../accountingStatus';

export type LegacyApprovalLeafLike = {
  kind: string;
  status: string;
  approvedAt: string | null;
  approvedBy: string | null;
};

export const isCompleteValidApprovalLeaf = (leaf: LegacyApprovalLeafLike): boolean =>
  isValidFinanciallyApprovedInvoice({
    kind: leaf.kind as FinancialRecordKind,
    status: leaf.status as AccountingRecordStatus,
  })
  && Boolean(leaf.approvedAt && !Number.isNaN(Date.parse(leaf.approvedAt)))
  && Boolean(leaf.approvedBy?.trim());
