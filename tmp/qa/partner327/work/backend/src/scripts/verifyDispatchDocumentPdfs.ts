import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dispatchDocumentVisualFixtures, dispatchPrintBothFixture } from '../documents/dispatch/dispatchDocumentFixtures';
import { renderDispatchDocumentPdf } from '../documents/dispatch/dispatchDocumentPdf';

const updateBaselines = process.argv.includes('--update-baselines');
const backendRoot = process.cwd();
const outputDir = path.join(backendRoot, 'tmp', 'dispatch-document-pdf-qa');
const baselineDir = process.env.DISPATCH_PDF_BASELINE_DIR
  || path.join(backendRoot, 'dispatch-document-baselines');

const main = async () => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(baselineDir, { recursive: true });

  const manifest: Array<{
    name: string;
    kind: 'WAYBILL' | 'STATEMENT' | 'STATEMENT_ADJUSTMENT';
    expectedPages: number;
    pdfPath: string;
    sha256: string;
  }> = [];
  for (const fixture of dispatchDocumentVisualFixtures) {
    const rendered = await renderDispatchDocumentPdf(fixture.input);
    const pdfPath = path.join(outputDir, `${fixture.name}.pdf`);
    fs.writeFileSync(pdfPath, rendered.bytes);
    manifest.push({ name: fixture.name, kind: fixture.input.kind, expectedPages: fixture.expectedPages, pdfPath, sha256: rendered.metadata.sha256 });
  }

  const printBothDir = path.join(outputDir, dispatchPrintBothFixture.name);
  fs.mkdirSync(printBothDir, { recursive: true });
  for (const [index, input] of dispatchPrintBothFixture.inputs.entries()) {
    const rendered = await renderDispatchDocumentPdf(input);
    const suffix = input.kind === 'WAYBILL' ? 'waybill' : 'statement';
    fs.writeFileSync(path.join(printBothDir, `${String(index + 1).padStart(2, '0')}-${suffix}.pdf`), rendered.bytes);
  }

  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({ documents: manifest, printBoth: ['01-waybill.pdf', '02-statement.pdf'] }, null, 2)}\n`);
  const verifier = path.join(backendRoot, 'scripts', 'verify-dispatch-document-pdfs.py');
  const args = [verifier, '--manifest', manifestPath, '--baseline-dir', baselineDir];
  if (updateBaselines) args.push('--update-baselines');
  const verification = spawnSync('python3', args, { cwd: backendRoot, encoding: 'utf8', stdio: 'inherit' });
  if (verification.status !== 0) process.exitCode = verification.status || 1;
  else console.log(`Dispatch PDF QA artifacts: ${outputDir}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
