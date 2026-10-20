import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
const require = createRequire(import.meta.url), esbuild = require('../backend/node_modules/esbuild');
const repository = path.resolve(import.meta.dirname, '..'), sha = value => createHash('sha256').update(value).digest('hex');
function verify() {
  const raw = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' });
  let values; try { const v = JSON.parse(raw); values = Array.isArray(v) ? v : [v]; } catch { values = raw.trim().split(/\r?\n/).map(JSON.parse); }
  const names = ['backend', 'backend-candidate', 'backend-retained', 'frontend', 'frontend-candidate', 'frontend-retained', 'postgres', 'inquiry'].map(service => {
    const value = values.find(v => v.Service === service); assert.ok(value?.Project === 'sabalanerp-local' && value.State === 'running' && value.Health === 'healthy'); return value.Name;
  });
  return names;
}
function docker(args) { verify(); return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 }); }
function identities() { const names = verify(); const data = docker(['inspect', ...names]); return JSON.parse(data).map(v => ({ service:v.Config.Labels['com.docker.compose.service'], id:v.Id,image:v.Image,startedAt:v.State.StartedAt })); }
const before = identities(), service = 'sabalanerp-local-backend-retained-1';
const operation = randomBytes(16).toString('hex'), local = 'D:/sabalanerp-online-qa/dispatch-renderer-diagnostic-' + operation;
const root = '/app/online-runtime-acceptance/dispatch-renderer-diagnostic-' + operation;
fs.mkdirSync(local); const sources = {};
const capture = name => { const b = fs.readFileSync(path.join(repository, name)); sources[name] = sha(b); return b; };
const built = await esbuild.build({ entryPoints:['tests/online-deployment/dispatch-renderer-diagnostic.fixture.ts'],absWorkingDir:repository,bundle:true,packages:'external',platform:'node',format:'cjs',target:'node22',write:false,logLevel:'silent',
  plugins:[{name:'capture',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{const name=path.relative(repository,args.path).split(path.sep).join('/');assert.ok(!name.startsWith('../'));return {contents:capture(name),loader:{'.ts':'ts','.js':'js','.mjs':'js','.json':'json'}[path.extname(name)],resolveDir:path.dirname(args.path)};});}}] });
fs.writeFileSync(path.join(local,'diagnostic.cjs'),built.outputFiles[0].contents);
const assets=['brand/sabalan-logo.jpg','yekan-bakh/YekanBakh-Regular.woff2','yekan-bakh/YekanBakh-SemiBold.woff2','yekan-bakh/YekanBakh-Bold.woff2'];
fs.writeFileSync(path.join(local,'print-assets.json'),JSON.stringify(assets.map((target,i)=>{const bytes=capture('backend/public/'+target),file='print-asset-'+i;fs.writeFileSync(path.join(local,file),bytes);return{target,file,bytes:bytes.length,sha256:sha(bytes)};})));
docker(['exec',service,'node','-e',`process.umask(0o077);require('fs').mkdirSync(process.argv[1],{mode:0o700});require('fs').mkdirSync(process.argv[1]+'/app',{mode:0o700});`,root]);
docker(['cp',local+'/.',service+':'+root]);
docker(['exec',service,'node','-e',`const fs=require('fs'),p=process.argv[1];for(const n of fs.readdirSync(p)){const f=p+'/'+n;if(fs.statSync(f).isFile())fs.chmodSync(f,0o600);}`,root]);
verify();
const child=spawn('docker',['exec','-e','NODE_ENV=test','-e','NODE_PATH=/app/node_modules',service,'node','-e',`process.umask(0o077);process.chdir(process.argv[1]+'/app');require(process.argv[1]+'/diagnostic.cjs');`,root],{stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;process.stdout.write(b);});child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});
const outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
const after=identities();assert.deepEqual(after,before);for(const[n,h]of Object.entries(sources))assert.equal(sha(fs.readFileSync(path.join(repository,n))),h);
const report={format:'sabalan-dispatch-renderer-diagnostic/v1',operation,root,local,before,after,sources,outcome,stdout,stderr,nativeAuthorityQualified:false,sourceUnchanged:true,servicesUnchanged:true};
const file=path.join(repository,'reports/qa/dispatch-renderer-diagnostic-'+operation+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:file,...outcome}));process.exitCode=outcome.code===0?0:1;