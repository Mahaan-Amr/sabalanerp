import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { generatePdfBufferFromHtml } from '../../utils/pdf';
import { mergeDispatchPdfs } from '../mergeDispatchPdfs';

test('combines two real PDFs in order without dropping pages', { skip: process.env.RUN_DISPATCH_PDF_INTEGRATION !== '1' }, async () => {
  const first = await generatePdfBufferFromHtml({ htmlContent: '<html><body>Invoice first</body></html>' });
  const second = await generatePdfBufferFromHtml({ htmlContent: '<html><body>Waybill second</body></html>' });
  const combined = await mergeDispatchPdfs([first, second]);
  const info = execFileSync('pdfinfo', ['-'], { input: combined, encoding: 'utf8' });
  assert.match(info, /^Pages:\s+2$/m);
  const text = execFileSync('pdftotext', ['-', '-'], { input: combined, encoding: 'utf8' });
  assert.ok(text.indexOf('Invoice first') >= 0 && text.indexOf('Waybill second') > text.indexOf('Invoice first'));
});
