import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatShipmentQuantity, shipmentHealthPresentation } from './shipmentQuantityPresentation';

test('presentation trims only trailing zeros without changing quantity truth', () => {
  assert.equal(formatShipmentQuantity('12.340'), '۱۲٫۳۴');
  assert.equal(formatShipmentQuantity('-0.250'), '‎−۰٫۲۵');
  assert.equal(formatShipmentQuantity(null), 'نامشخص');
});

test('unsafe projection health is explicit without relying on color', () => {
  assert.equal(shipmentHealthPresentation('LEGACY_UNRECONCILED').label, 'سابقه تطبیق‌نشده');
  assert.equal(shipmentHealthPresentation('EVIDENCE_CONFLICT').label, 'تعارض شواهد');
});
