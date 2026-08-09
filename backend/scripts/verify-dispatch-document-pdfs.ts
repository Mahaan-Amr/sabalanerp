import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dispatchDocumentVisualFixtures, dispatchPrintBothFixture } from '../src/documents/dispatch/dispatchDocumentFixtures';
import { renderDispatchDocumentPdf } from '../src/documents/dispatch/dispatchDocumentPdf';

const updateBaselines = process.argv.includes('--update-baselines');
const backendRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(backendRoot, '..');
const outputDir = path.join(repositoryRoot, 'tmp', 'dispatch-document-pdf-qa');
const baselineDir = path.join(backendRoot, 'src', 'documents', 'dispatch', '__fixtures__', 'baselines');

const locatePython = () => {
  const candidates = [
    process.env.CODEX_PYTHON_PATH,
    process.env.PYTHON,
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
    'python3',
    'python',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'import pypdf, PIL'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('Python with pypdf and Pillow is required for dispatch document visual QA.');
};

const main = async () => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(baselineDir, { recursive: true });

  const manifest = [];
  for (const fixture of dispatchDocumentVisualFixtures) {
    const rendered = await renderDispatchDocumentPdf(fixture.input);
    const pdfPath = path.join(outputDir, `${fixture.name}.pdf`);
    fs.writeFileSync(pdfPath, rendered.bytes);
    manifest.push({
      name: fixture.name,
      kind: fixture.input.kind,
      expectedPages: fixture.expectedPages,
      pdfPath,
      sha256: rendered.metadata.sha256,
    });
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
  const verification = spawnSync(locatePython(), args, { cwd: repositoryRoot, encoding: 'utf8', stdio: 'inherit' });
  if (verification.status !== 0) process.exitCode = verification.status || 1;
  else console.log(`Dispatch PDF QA artifacts: ${outputDir}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
