/** Copy authenticated existing host tool bytes only; never installs/builds/generates. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';import {createRequire} from 'node:module';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
const source=path.resolve('C:/Users/mahan/.codex/worktrees/immutable-final-package-413/sabalanerp/backend/node_modules');
const target=path.resolve('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp/backend/node_modules');
const sha=b=>createHash('sha256').update(b).digest('hex'),packages=['typescript','esbuild','@esbuild/win32-x64'];
assert.ok(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--install');
const install=process.argv[2]==='--install',rows=[];
function regular(file){assert.equal(fs.realpathSync(file),file);const s=fs.lstatSync(file,{bigint:true});assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&s.size<=32n*1024n**2n);return s;}
function bytes(file){const before=regular(file),raw=fs.readFileSync(file),after=regular(file);for(const k of ['dev','ino','size','mtimeNs','ctimeNs','mode','nlink'])assert.equal(after[k],before[k]);return raw;}
function walk(relative){const folder=path.join(source,relative);assert.equal(fs.realpathSync(folder),folder);assert.ok(fs.lstatSync(folder).isDirectory()&&!fs.lstatSync(folder).isSymbolicLink());for(const e of fs.readdirSync(folder,{withFileTypes:true})){assert.ok(!e.isSymbolicLink());const name=path.join(relative,e.name);if(e.isDirectory())walk(name);else{const raw=bytes(path.join(source,name));rows.push({relative:name,bytes:raw.length,sha256:sha(raw)});}}}
function parent(folder){const rel=path.relative(path.dirname(target),folder);assert.ok(!rel.startsWith('..')&&!path.isAbsolute(rel));if(!fs.existsSync(folder)){assert.ok(rel);parent(path.dirname(folder));fs.mkdirSync(folder);}assert.equal(fs.realpathSync(folder),folder);assert.ok(fs.lstatSync(folder).isDirectory()&&!fs.lstatSync(folder).isSymbolicLink());}
const operation=randomBytes(16).toString('hex'),report={format:'sabalan-c3-existing-host-dependency-copy/v1',operation,install,pass:false,source,target,compilerExecuted:false,imageBuilt:false,masterStarted:false,productionAdmission:false};let lease;
try{
 if(install){lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};await assert.rejects(acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);report.lease.contenderRefused=true;}
 for(const p of packages)walk(p);assert.ok(rows.length>0&&rows.length<1000);const total=rows.reduce((n,r)=>n+r.bytes,0);assert.ok(total<75*1024**2);
 report.files=rows;report.bytes=total;report.capacity=[];
 for(const root of ['C:/','D:/']){const s=fs.statfsSync(root,{bigint:true}),available=s.bavail*s.bsize,required=16n*1024n**3n+512n*1024n**2n+BigInt(total);assert.ok(available>=required);report.capacity.push({root,availableBytes:String(available),requiredBytes:String(required)});}
 for(const r of rows){const destination=path.join(target,r.relative);if(fs.existsSync(destination))assert.equal(sha(bytes(destination)),r.sha256);}
 if(install){for(const r of rows){lease.assertHeld();const raw=bytes(path.join(source,r.relative));assert.equal(sha(raw),r.sha256);const destination=path.join(target,r.relative);if(!fs.existsSync(destination)){parent(path.dirname(destination));const fd=fs.openSync(destination,'wx',0o600);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}assert.equal(sha(bytes(destination)),r.sha256);}
 const require=createRequire(path.join(target,'../package.json'));report.versions={typescript:require('./node_modules/typescript/package.json').version,esbuild:require('./node_modules/esbuild/package.json').version};}
 report.pass=true;
}catch(error){report.error={code:error.code??error.name,message:error.message};process.exitCode=1;}
finally{if(lease){await lease.release();report.lease.closed=true;}const file=path.join(import.meta.dirname,'C3-HOST-DEPENDENCY-'+(install?'COPY':'PLAN')+'-'+operation+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({file,pass:report.pass,bytes:report.bytes,error:report.error}));}
