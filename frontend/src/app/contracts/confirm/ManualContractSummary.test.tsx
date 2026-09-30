import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import ManualContractSummary, { buildManualContractSummary, buildPartnerManualContractSummary } from './ManualContractSummary';
import ConfirmationContractView from './ConfirmationContractView';

const data = {
  sessionId: 'ordinary-session', otpExpiresAt: '2026-10-28T00:00:00.000Z', linkExpiresAt: '2026-10-28T00:00:00.000Z',
  status: 'PENDING', contractStatus: 'SIGNED',
  contract: {
    id: 'ordinary-contract', title: 'Contract', titlePersian: 'قرارداد', contractNumber: '100546', createdAt: '2026-09-25T00:00:00.000Z', currency: 'تومان', totalAmount: 130,
    customer: { firstName: 'آزمایشی', lastName: 'مشتری', phoneNumber: '09120000000' },
    contractData: {
      contractDate: '1405/07/04',
      products: [{ rowId: 'row-1', productId: 'stone-1', stoneCode: 'S-1', stoneName: 'سنگ نمونه',
        productType: 'slab', quantity: 1, squareMeters: 2, totalPrice: 120, originalTotalPrice: 100,
        cuttingCost: 5, cuttingBreakdown: [{ type: 'longitudinal', meters: 1, rate: 5, cost: 5 }],
        appliedSubServices: [{ meter: 1, cost: 10, subService: { namePersian: 'ابزار نمونه', pricePerMeter: 10 } }],
        finishingId: 'finish-1', finishingName: 'پرداخت نمونه', finishingCost: 5,
        finishingSquareMeters: 1, finishingPricePerSquareMeter: 5 }],
      serviceRows: [{ id: 'service-1', sourceType: 'tool', title: 'خدمت مستقل', quantity: 1, unit: 'meter', unitPrice: 20, totalPrice: 20 }],
      discount: { amount: 10 }, payment: { currency: 'تومان', payments: [{ method: 'CHECK', amount: 30 }] },
      deliveries: [{ deliveryDate: '1405/07/04', deliveryAddress: 'نشانی قدیمی', projectManagerName: 'مدیر پروژه',
        receiverName: 'گیرنده', products: [{ productRowId: 'row-1', quantity: 1 }] }]
    },
    items: [{ productRowId: 'row-1', quantity: 1, totalPrice: 120 }],
    deliveries: [{ id: 'delivery-1', deliveryDate: '2026-09-27T00:00:00.000Z', deliveryAddress: 'نشانی جدید',
      notes: 'تحویل صبح', products: [{ productRowId: 'row-1', productId: 'stone-1', quantity: 1 }] }],
    payments: [{ id: 'payment-1', paymentMethod: 'CHECK', totalAmount: 40, currency: 'تومان', status: 'PENDING' }]
  }
};

const summary = buildManualContractSummary(data);
assert.equal(summary.productsTotal, 100);
assert.equal(summary.servicesTotal, 40);
assert.equal(summary.grandTotal, 130);
assert.equal(summary.paymentTotal, 40);
assert.equal(summary.remaining, 90);
assert.equal(summary.deliveries[0].deliveryAddress, 'نشانی جدید');
assert.equal(summary.payments[0].amount, 40);

const html = renderToStaticMarkup(<ManualContractSummary data={data} />);
for (const heading of ['خلاصه قرارداد', 'محصولات قرارداد', 'خدمات و عملیات وابسته', 'خدمات مستقل', 'برنامه تحویل', 'برنامه پرداخت']) {
  assert.ok(html.includes(heading), heading);
}
assert.ok(!html.includes('تعداد تلاش'));
assert.ok(!html.includes('نشانی قدیمی'));

const confirmationProps = {
  fullManualSummary: true, code: '', error: '', success: '', submitting: false,
  onCodeChange: () => {}, onVerify: () => {}, onResend: () => {}
};
const pendingHtml = renderToStaticMarkup(<ConfirmationContractView {...confirmationProps} data={data} />);
assert.ok(pendingHtml.includes('ثبت کد تایید'), 'a signed contract still needs customer OTP verification');
const verifiedHtml = renderToStaticMarkup(<ConfirmationContractView {...confirmationProps} data={{ ...data, status: 'VERIFIED', verifiedAt: '2026-09-27T00:00:00.000Z' }} />);
assert.ok(verifiedHtml.includes('تایید شده در تاریخ'));
assert.ok(verifiedHtml.includes('خلاصه قرارداد'));
assert.ok(!verifiedHtml.includes('ثبت کد تایید'));
const tokenHtml = renderToStaticMarkup(<ConfirmationContractView {...confirmationProps} fullManualSummary={false} data={data} />);
assert.ok(tokenHtml.includes('محصولات قرارداد'), 'the SMS-link presentation remains available');

assert.ok(tokenHtml.includes('ثبت کد تایید'), 'SMS links require VERIFIED session even for SIGNED contracts');

const retail = createPartnerFixtures().customer;
retail.products[0] = { ...retail.products[0], productCode: 'STONE-PUBLIC', productType: 'slab',
  lengthMeters: '2.5', widthMeters: '1.2', areaSquareMeters: '3', count: '1', retailLineTotal: '9007199254740993.25' };
retail.totals = { ...retail.totals, net: '9007199254740993.25', payable: '9007199254740993.25' };
const partnerSummary = buildPartnerManualContractSummary(retail);
assert.equal(partnerSummary.grandTotal, '9007199254740993.25');
const partnerHtml = renderToStaticMarkup(<ConfirmationContractView {...confirmationProps} data={{
  contract: retail, verifiedAt: null, linkExpiresAt: '2026-10-28T00:00:00.000Z',
  sellerFinalized: true, decision: 'PENDING', readOnly: false, banner: null,
}} />);
for (const label of ['خلاصه قرارداد', 'محصولات قرارداد', 'برنامه پرداخت', 'برنامه تحویل',
  'STONE-PUBLIC', 'طول: 2.5 متر', 'عرض: 1.2 متر', 'ثبت کد تایید', 'ارسال مجدد کد', '۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳٫۲۵']) {
  assert.ok(partnerHtml.includes(label), label);
}
assert.ok(!partnerHtml.includes('wholesaleUnitPrice'));
assert.ok(!partnerHtml.includes('sha256-v1:'));
