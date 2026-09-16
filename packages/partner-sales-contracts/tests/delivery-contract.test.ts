import assert from 'node:assert/strict';
import test from 'node:test';
import { DeliverySchema } from '@sabalanerp/partner-sales-contracts';

test('Partner delivery preserves the ordinary contract recipient and project details', () => {
  const delivery = {
    deliveryId: 'delivery-377',
    date: '2026-09-20',
    destination: 'تهران، خیابان آزادی',
    projectManagerName: 'مدیر پروژه',
    receiverName: 'تحویل گیرنده',
    notes: 'تماس پیش از ارسال',
    items: [{ productRowId: 'product-row:377', quantity: '12.5' }],
  };

  assert.deepEqual(DeliverySchema.parse(delivery), delivery);
  assert.equal(DeliverySchema.safeParse({ ...delivery, driver: 'نباید در قرارداد مشتری ذخیره شود' }).success, false);
});
