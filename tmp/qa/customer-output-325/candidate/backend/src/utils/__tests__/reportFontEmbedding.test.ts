import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generatePdfFromHtml } from '../pdf';
import { renderYekanFontFaces } from '../printTemplate';

const main = async () => {
  const fontCss = renderYekanFontFaces();
  assert.match(fontCss, /font-family:\s*'Yekan Bakh'/);
  assert.match(fontCss, /data:font\/woff2;base64,/);

  const outputDir = path.join(os.tmpdir(), 'sabalan-report-font-test');
  const pdfPath = await generatePdfFromHtml({
    htmlContent: `<style>${fontCss}body{font-family:'Yekan Bakh',sans-serif}</style><h1>گزارش جامع فروش</h1><p>وضعیت واقعی قراردادها</p>`,
    outputDir,
    fileName: 'yekan-bakh-report-test'
  });

  assert.ok(fs.statSync(pdfPath).size > 5_000, 'embedded-font PDF should contain more than an empty page');
  console.log(`Report font embedding test passed: ${pdfPath}`);

  if (process.env.KEEP_REPORT_FONT_TEST_ARTIFACT !== '1') fs.rmSync(pdfPath, { force: true });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
