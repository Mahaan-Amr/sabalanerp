import { AccountingRecordStatus, FinancialRecordKind } from '@prisma/client';
import type { ApprovedPricingSource } from './types';

export const APPROVED_PRICING_FIXTURE_VERSION = 'approved-pricing-v1';

export const approvedPricingSourceFixture = (): ApprovedPricingSource => ({
  leaf: {
    id: 'invoice-approved-1',
    contractId: 'contract-1',
    kind: FinancialRecordKind.INVOICE_CANDIDATE,
    status: AccountingRecordStatus.ISSUED,
    financiallyApprovedAt: new Date('2026-08-09T08:30:00.000Z'),
    financiallyApprovedBy: 'accountant-1',
  },
  contract: {
    id: 'contract-1',
    contractNumber: 'SC-1405-001',
    customerId: 'customer-1',
    currency: 'تومان',
    contractData: {
      customerId: 'customer-1',
      customer: { id: 'customer-1', firstName: 'سمیه', lastName: 'احمدی', companyName: 'سنگ آفتاب' },
      projectId: 'project-1',
      project: { id: 'project-1', projectName: 'برج آفتاب', address: 'تهران، خیابان نمونه' },
      payment: { currency: 'تومان' },
      discount: {
        enabled: true, rangeId: 'discount-range-1', maxDiscountPercent: '12',
        baseSubtotal: '1000', percent: '10', amount: '100', currency: 'تومان',
        appliedAt: '2026-08-08T10:00:00.000Z',
      },
      products: [{
        rowId: 'row-1', productId: 'product-1', productType: 'longitudinal',
        length: '2.5', lengthUnit: 'm', quantity: '4', meta: { isLayer: false },
      }],
    },
    items: [{
      id: 'item-1', productId: 'product-1', productRowId: 'row-1',
      productType: 'longitudinal', quantity: '4',
    }],
    productGraph: {
      schemaVersion: 3,
      revision: 7,
      inputHash: 'graph-input-hash',
      resultHash: 'graph-result-hash',
      totalAmountToman: '1250',
      rows: [{
        productRowId: 'row-1', catalogProductId: 'product-1', productType: 'longitudinal',
        contractualTitle: 'تراورتن طولی', baseAmountToman: '1000', totalAmountToman: '1250',
        requestedQuantity: '4', requestedLengthMeters: '2.5', requestedAreaSquareMeters: null,
        operations: [
          { id: 'tool-1', kind: 'tool', amountToman: '150' },
          { id: 'finish-1', kind: 'finishing', amountToman: '100' },
        ],
      }],
    },
  },
});

export const APPROVED_PRICING_FIXTURE_EXPECTED = {
  versionId: 'pricing-version-1',
  grossAmount: '1250.000000000000',
  discountAmount: '100.000000000000',
  netAmount: '1150.000000000000',
  contractedQuantity: '10.000',
  unit: 'meter',
  rowHash: '7bcd7a08ae96a0667c9195416c391f06cebc5daf86229833036b5e7f24ca5fb9',
  rootHash: '733a03ac725825553864b7ad2aabfa0d30fda18ad628d858b0d91904ea7af33b',
} as const;
