import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { renderDispatchDocumentPdf, type DispatchDocumentRenderData } from '../dispatchDocumentPdf';

const input: DispatchDocumentRenderData = {
  schemaVersion: 1,
  documentId: 'statement-ordinary',
  templateVersion: 'dispatch-v1',
  kind: 'STATEMENT',
  waybillNumber: '۱۴۰۵-۰۰۴۲',
  issuedAt: '2026-08-09T08:30:00.000Z',
  customerName: 'شرکت سنگ‌آرای سپید سبلان',
  projectOrDestination: 'پروژه مجتمع اداری نیایش',
  vehiclePlate: 'ایران ۱۱ ـ ۴۲ب ـ ۳۶۵',
  payload: {
    currency: 'ریال',
    contracts: [{
      contractId: 'contract-1',
      contractNumber: 'SC-10042',
      lines: [{
        contractItemId: 'contract-item-1',
        productRowId: 'row-stable-1',
        label: 'سنگ تراورتن عباس‌آباد شامل خدمات متصل',
        unit: 'متر مربع',
        quantity: '12.375',
        grossAmount: '123456789012.500000000000',
        allocatedDiscount: '3456789.500000000000',
        netAmount: '123453332223.000000000000',
      }],
      grossAmount: '123456789012.500000000000',
      allocatedDiscount: '3456789.500000000000',
      netAmount: '123453332223.000000000000',
    }],
    grossAmount: '123456789012.500000000000',
    allocatedDiscount: '3456789.500000000000',
    netAmount: '123453332223.000000000000',
  },
};

const main = async () => {
  const result = await renderDispatchDocumentPdf(input);
  assert.equal(result.bytes.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(result.bytes.length > 30_000, 'branded PDF should include embedded fonts and logo');
  assert.deepEqual(result.metadata, {
    documentId: 'statement-ordinary',
    kind: 'STATEMENT',
    mimeType: 'application/pdf',
    size: result.bytes.length,
    sha256: crypto.createHash('sha256').update(result.bytes).digest('hex'),
    templateVersion: 'dispatch-v1',
    generatorVersion: 'chromium-pdf-v1',
  });
  console.log('Dispatch document PDF byte/metadata test passed.');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
