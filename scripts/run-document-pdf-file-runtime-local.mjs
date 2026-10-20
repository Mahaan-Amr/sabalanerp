import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
const require = createRequire(import.meta.url), esbuild = require('../backend/node_modules/esbuild');
const repository = path.resolve(import.meta.dirname, '..');
const compose = ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml'];
const services = ['backend', 'backend-candidate', 'backend-retained', 'frontend', 'inquiry', 'postgres'];
const legacyPdf = 'D:/sabalanerp-online-qa/pdf-writer-preparation-232b2a13effbff6c51ab3be0d9bb6ab1/original/backend/src/utils/pdf.ts';
const preNonceRoot = 'D:/sabalanerp-online-qa/pdf-writer-preparation-232b2a13effbff6c51ab3be0d9bb6ab1/pre-nonce';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mode = process.argv[2]; assert.ok(['red', 'green', 'race-red', 'race-green'].includes(mode), 'Use red, green, race-red or race-green');
function verify() {
  const raw = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows; try { const value = JSON.parse(raw); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = raw.trim().split(/\r?\n/).flatMap(line => JSON.parse(line)); }
  for (const service of services) assert.ok(rows.some(row => row.Project === 'sabalanerp-local' && row.Service === service
    && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function docker(args, options = {}) { verify(); return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 16 * 1024 ** 2, ...options }); }
function identities() {
  const result = {};
  for (const service of services) {
    const name = verify().find(row => row.Service === service).Name;
    result[service] = JSON.parse(docker(['inspect', '--format', '{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}}}', name]));
  }
  return result;
}
const before = identities(), candidate = verify().find(row => row.Service === 'backend-candidate');
const operation = randomBytes(16).toString('hex'), root = '/app/online-runtime-acceptance/document-pdf-suite-' + operation;
const receipt = path.join(repository, 'reports/qa/document-pdf-file-runtime-' + operation + '.json');
const legacyBytes = fs.readFileSync(legacyPdf);
assert.equal(hash(legacyBytes), 'a0a9ba244a371433e38e8b8b8803f424247cdfa4a95f50ae0c37c9cdb87bc272');
const fixture = path.join(repository, 'tests/online-deployment/document-pdf-file-runtime.fixture.ts');
const raceSources = Object.fromEntries(['backend/src/services/documentPdfFileRuntime.ts', 'backend/src/utils/pdf.ts']
  .map(name => [name, fs.readFileSync(path.join(preNonceRoot, name))]));
assert.equal(hash(raceSources['backend/src/services/documentPdfFileRuntime.ts']), 'e0eaca6d75bd4a21377f83b986417a53e9fa1e6d7cd3a434c89f32fb990df969');
assert.equal(hash(raceSources['backend/src/utils/pdf.ts']), '9a637ad32aeb8fe15b7654fef363d692d00552bc0887f4e7538bb6d36f1fd614');
const captured = new Map();
const built = await esbuild.build({ entryPoints: [fixture], bundle: true, packages: 'external', platform: 'node',
  format: 'cjs', target: 'node20', write: false, logLevel: 'silent',
  plugins: [{ name: 'actual-source-freeze', setup(build) {
    build.onLoad({ filter: /\.(?:ts|js|json)$/ }, args => {
      const actual = fs.readFileSync(args.path), relative = path.relative(repository, args.path).split(path.sep).join('/');
      assert.ok(!relative.startsWith('../') && !path.isAbsolute(relative));
      captured.set(relative, hash(actual));
      const contents = mode === 'red' && relative === 'backend/src/utils/pdf.ts' ? legacyBytes.toString('utf8')
        : mode === 'race-red' && raceSources[relative] ? raceSources[relative].toString('utf8') : actual.toString('utf8');
      return { contents, loader: args.path.endsWith('.json') ? 'json' : args.path.endsWith('.ts') ? 'ts' : 'js' };
    });
  } }], metafile: true });
assert.equal(built.outputFiles.length, 1);
const bundle = Buffer.from(built.outputFiles[0].contents);
const report = { format: 'sabalan-document-pdf-native-acceptance/v1', operation, mode, root, before,
  sourceHashes: Object.fromEntries(captured), runnerSha256: hash(fs.readFileSync(import.meta.filename)),
  bundleSha256: hash(bundle), legacyRendererSha256: hash(legacyBytes),
  rendererSource: mode === 'red' ? 'exact preserved pre-change utils/pdf.ts'
    : mode === 'race-red' ? 'exact preserved pre-nonce utils/pdf.ts and documentPdfFileRuntime.ts' : 'current utils/pdf.ts',
  raceSourceHashes: mode === 'race-red' ? Object.fromEntries(Object.entries(raceSources).map(([name, bytes]) => [name, hash(bytes)])) : null,
  productionAdmission: false, nativeGuardianQualified: false, cases: [], pass: false };
fs.writeFileSync(receipt.replace('.json', '-intent.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const setup = `const fs=require('fs'),path=require('path');process.umask(0o077);const root=${JSON.stringify(root)};
fs.mkdirSync(root,{mode:0o700});const bytes=Buffer.from(fs.readFileSync(0,'utf8'),'base64');
const fd=fs.openSync(path.join(root,'fixture.cjs'),'wx',0o400);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}`;
docker(['exec', '-i', candidate.Name, 'node', '-e', setup], { input: bundle.toString('base64') });
try {
  for (const selected of mode === 'red' ? ['document-first'] : mode.startsWith('race-')
    ? ['ephemeral-collision', 'ephemeral-collision-unbound'] : ['document-first', 'parent-first', 'child-observed-first']) {
    const cwd = '/app/online-runtime-acceptance/document-pdf-' + randomBytes(16).toString('hex');
    const launcher = `const fs=require('fs'),path=require('path'),cp=require('child_process');process.umask(0o077);
const root=${JSON.stringify(root)},cwd=${JSON.stringify(cwd)},mode=${JSON.stringify(selected)};fs.mkdirSync(cwd,{mode:0o700});
const out=fs.openSync(path.join(root,mode+'.stdout'),'wx',0o600),err=fs.openSync(path.join(root,mode+'.stderr'),'wx',0o600);
const program='process.umask(0o077);process.argv=[process.execPath,'+JSON.stringify(path.join(root,'fixture.cjs'))+','+JSON.stringify(mode)+'];require('+JSON.stringify(path.join(root,'fixture.cjs'))+')';
const child=cp.spawn(process.execPath,['-e',program],{cwd,env:{...process.env,NODE_ENV:'test',DOCUMENT_PDF_FIXTURE_ROOT:cwd,
HOME:cwd,XDG_CONFIG_HOME:path.join(cwd,'xdg-config'),XDG_CACHE_HOME:path.join(cwd,'xdg-cache'),RECOVERY_COORDINATION_DIR:path.join(cwd,'recovery-coordination')},stdio:['ignore',out,err]});let failure;
child.once('error',error=>{failure=error.code});child.once('close',(code,signal)=>{fs.fsyncSync(out);fs.fsyncSync(err);fs.closeSync(out);fs.closeSync(err);
const record={mode,cwd,code,signal,failure,stdout:fs.readFileSync(path.join(root,mode+'.stdout'),'utf8'),stderr:fs.readFileSync(path.join(root,mode+'.stderr'),'utf8')};
const unowned=path.join(cwd,'storage','contracts','outside-renderer-source.pdf');if(fs.existsSync(unowned)){const data=fs.readFileSync(unowned);record.unownedRendererFile={bytes:data.length,pdfMagic:data.subarray(0,5).toString(),sha256:require('crypto').createHash('sha256').update(data).digest('hex')};}
const fd=fs.openSync(path.join(root,mode+'.result.json'),'wx',0o400);try{fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}console.log(JSON.stringify(record));});`;
    verify();
    const output = await new Promise((resolve, reject) => {
      const child = spawn('docker', ['exec', candidate.Name, 'node', '-e', launcher], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
      child.once('error', reject); child.once('close', (code, signal) => code === 0 && !signal ? resolve(stdout) : reject(Error('PDF_FIXTURE_LAUNCHER_FAILED: ' + stderr.slice(0, 1000))));
    });
    const result = JSON.parse(output); report.cases.push(result);
    // Preserve each actual child outcome before evaluating any acceptance gate.
    fs.writeFileSync(receipt.replace('.json', '-' + selected + '.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    assert.equal(result.signal, null); assert.match(result.stdout, /"pdfFixtureNativeWorkClosed":true/);
    if (mode === 'red') {
      assert.equal(result.code, 1); assert.match(result.stderr, /Missing expected rejection/);
      assert.equal(result.unownedRendererFile?.pdfMagic, '%PDF-');
    } else if (mode === 'race-red') {
      assert.equal(result.code, 1); assert.match(result.stderr, /HELD_A_CALLBACK_DELETED_LATER_PDF/);
      assert.match(result.stdout, /"bExistsAfterA":false/);
    } else {
      assert.equal(result.code, 0); if (selected !== 'child-observed-first') assert.match(result.stdout, /"documentPdfRuntimePassed":true/);
    }
  }
  for (const [name, expected] of captured) assert.equal(hash(fs.readFileSync(path.join(repository, name))), expected);
  report.after = identities(); assert.deepEqual(report.after, before);
  report.pass = true;
} catch (error) { report.failure = error instanceof Error ? error.message : 'PDF_NATIVE_ACCEPTANCE_FAILED'; throw error; }
finally {
  try {
    report.finalSourceHashes = Object.fromEntries([...captured.keys()].map(name => [name, hash(fs.readFileSync(path.join(repository, name)))]));
    assert.deepEqual(report.finalSourceHashes, report.sourceHashes);
    report.after = identities(); assert.deepEqual(report.after, before);
  } catch (error) { report.finalVerificationFailure = error instanceof Error ? error.message : 'PDF_FINAL_VERIFICATION_FAILED'; report.pass = false; }
  fs.writeFileSync(receipt, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ receipt, operation, mode, pass: report.pass, cases: report.cases.length, productionAdmission: false }));
}
