import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpath } from 'node:fs/promises';
import { runPerformanceAcceptance } from './performance-acceptance-runner.mjs';
import { performanceAcceptanceTrustFromEnvironment } from './performance-acceptance-artifact.mjs';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--adapter' || args[2] !== '--output') {
  console.error('Usage: node scripts/run-performance-acceptance.mjs --adapter /absolute/trusted-adapter.mjs --output /absolute/new-directory');
  process.exit(2);
}

try {
  const adapterPath = await realpath(args[1]);
  const output = path.resolve(args[3]);
  const module = await import(pathToFileURL(adapterPath).href);
  const adapter = module.performanceAcceptanceAdapter;
  if (!adapter || typeof adapter.identity !== 'function' || !Array.isArray(adapter.checks)) {
    throw new Error('INVALID_ACCEPTANCE_ADAPTER');
  }
  const trust = performanceAcceptanceTrustFromEnvironment();
  if (Object.values(trust).some((value) => !value)) throw new Error('ACCEPTANCE_TRUST_UNAVAILABLE');
  const report = await runPerformanceAcceptance({ identity: adapter.identity, checks: adapter.checks,
    ...trust, directory: output });
  console.log(JSON.stringify({ status: report.status, candidateHandoffReady: report.candidateHandoffReady,
    productionActivationAuthorized: false, report: path.join(output, 'report.json') }));
  process.exitCode = report.candidateHandoffReady ? 0 : 1;
} catch {
  console.error('Performance acceptance failed closed. Existing evidence was retained and production activation is not authorized.');
  process.exitCode = 1;
}
