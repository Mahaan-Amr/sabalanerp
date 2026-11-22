import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

// Invoked inside the Inquiry build, whose own TypeScript dependency compiles
// only these pure runtime modules. Never copy/import the backend Prisma pool.
if (process.argv.length !== 4) throw Error('INQUIRY_RUNTIME_BUILD_ARGUMENTS_INVALID');
const source = fs.realpathSync(process.argv[2]), output = path.resolve(process.argv[3]);
if (fs.existsSync(output)) throw Error('INQUIRY_RUNTIME_BUILD_DESTINATION_EXISTS');
const ts = createRequire(path.join(process.cwd(), 'package.json'))('typescript');
fs.mkdirSync(output, { mode: 0o755 }); fs.mkdirSync(path.join(output, 'services'), { mode: 0o755 });
const hashes = {};
for (const name of ['onlineInquiryWork', 'onlineRuntimeScope', 'onlineCaptureAdmission', 'kernelWriteAdmission',
  'runtimeBoundaryJournal', 'runtimeTaskAdmission', 'runtimeWorkContext']) {
  const bytes = fs.readFileSync(path.join(source, name + '.ts'));
  hashes[name + '.ts'] = createHash('sha256').update(bytes).digest('hex');
  const compiled = ts.transpileModule(bytes.toString('utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.some(value => value.category === ts.DiagnosticCategory.Error)) throw Error('INQUIRY_RUNTIME_COMPILE_FAILED');
  fs.writeFileSync(path.join(output, 'services', name + '.js'), compiled.outputText, { flag: 'wx', mode: 0o444 });
}
const parser = fs.readFileSync(path.join(source, 'online-runtime-scope.py'));
fs.writeFileSync(path.join(output, 'services/online-runtime-scope.py'), parser, { flag: 'wx', mode: 0o444 });
hashes['online-runtime-scope.py'] = createHash('sha256').update(parser).digest('hex');
fs.writeFileSync(path.join(output, 'entry.cjs'), `'use strict';
const {loadOnlineRuntimeScope}=require('./services/onlineRuntimeScope');
const {createScopedInquiryWork}=require('./services/onlineInquiryWork');
exports.initialize=async generation=>{
  const input=loadOnlineRuntimeScope();if(!input)throw Error('INQUIRY_NATIVE_OWNERSHIP_UNPROVEN');
  return createScopedInquiryWork({registrySha256:input.scope.manifestSha256,generation});
};
`, { flag: 'wx', mode: 0o444 });
fs.writeFileSync(path.join(output, 'source-hashes.json'), JSON.stringify(hashes, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
