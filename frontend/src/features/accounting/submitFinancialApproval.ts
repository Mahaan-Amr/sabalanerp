import { accountingAPI } from '@/lib/api';
import type { FinancialInvoiceApprovalPayload } from './accountingUi';

export function submitFinancialApproval(payload: FinancialInvoiceApprovalPayload) {
  return accountingAPI.executeAction({ kind: 'APPROVE_FINANCIAL_INVOICE', ...payload });
}
