import * as XLSX from 'xlsx';
import { roundMoneyFields } from '../utils/money';
import type { buildSalesReport } from './salesReportingService';

export type SalesReportWorkbook = Pick<Awaited<ReturnType<typeof buildSalesReport>>,
  'cards' | 'contracts' | 'customers' | 'products' | 'finance' | 'delivery' | 'sellers' | 'accountingRegistered' | 'permissions'>;

export type SalesReportWorkbookConfig = {
  sections: string[];
  contractColumns: string[];
  includeTables: boolean;
};

export const encodeSalesReportWorkbook = (report: SalesReportWorkbook, config: SalesReportWorkbookConfig): Buffer => {
  const workbook = XLSX.utils.book_new();
  const add = (name: string, rows: any[]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  if (config.sections.includes('overview')) add('نمای کلی', [roundMoneyFields(report.cards, ['grossRealized', 'adjustments', 'netRealized', 'pipelineValue', 'lostValue'])]);
  if (config.sections.includes('contracts') && config.includeTables) add('قراردادها', report.contracts.map((row: any) => roundMoneyFields(Object.fromEntries(config.contractColumns.map((column) => [column, row[column === 'status' ? 'statusLabel' : column]])), ['amount'])));
  if (config.sections.includes('customers')) add('مشتریان', report.customers.map((row: any) => roundMoneyFields(row, ['value'])));
  if (config.sections.includes('products')) add('محصولات', report.products.map((row: any) => roundMoneyFields(row, ['value'])));
  if (config.sections.includes('finance')) add('پرداخت و وصول', [roundMoneyFields({ ...report.finance, coverage: `${report.finance.coverage.coveredContracts}/${report.finance.coverage.totalContracts}` }, ['plannedPaymentAmount', 'receivedAmount', 'receivableAmount'])]);
  if (config.sections.includes('delivery')) add('تحویل و بارگیری', [{ ...report.delivery, coverage: `${report.delivery.coverage.coveredContracts}/${report.delivery.coverage.totalContracts}` }]);
  if (config.sections.includes('sellers') && report.permissions.canViewSellerComparisons) add('فروشندگان', report.sellers.map((row: any) => roundMoneyFields(row, ['pipelineValue', 'realizedValue', 'adjustments', 'netRealized'])));
  if (config.sections.includes('accountingRegistered') && report.permissions.canViewSellerComparisons) {
    if (!report.accountingRegistered.available) throw new Error('Accounting data is unavailable');
    add('ثبت حسابداری فروشندگان', [
      ...report.accountingRegistered.rows.map((row: any) => roundMoneyFields({ seller: row.name, contractCount: row.contractCount, totalAmountRial: row.totalAmount }, ['totalAmountRial'])),
      ...(report.accountingRegistered.unassigned ? [roundMoneyFields({ seller: 'فروشندهٔ قطعی تخصیص‌نیافته', contractCount: report.accountingRegistered.unassigned.contractCount, totalAmountRial: report.accountingRegistered.unassigned.totalAmount }, ['totalAmountRial'])] : []),
      roundMoneyFields({ seller: 'جمع کل', contractCount: report.accountingRegistered.contractCount, totalAmountRial: report.accountingRegistered.totalAmount }, ['totalAmountRial']),
    ]);
    add('جزئیات ثبت حسابداری', report.accountingRegistered.details.map((row: any) => roundMoneyFields({
      contractNumber: row.contractNumber,
      customer: row.customer,
      realizedSeller: row.sellerName,
      financiallyApprovedAt: row.financiallyApprovedAt,
      amountRial: row.amount,
      status: row.hasConflict ? 'تعارض رکورد مالی' : 'معتبر',
    }, ['amountRial'])));
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};
