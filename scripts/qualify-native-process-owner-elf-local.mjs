/** Strict extraction of the original reviewed SSH build, then an actual
 * existing-slot ELF probe. No source/report can issue deployment authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {originalBackendBaseCommands} from './lib/production-backend-base-process.mjs';
const repository=path.resolve(import.meta.dirname,'..'),base='D:/sabalanerp/docker-compose.local.yml',operation='5eaf0c83a7ec4bf424ffe7f51314f98b';
const controller='D:/sabalanerp-online-qa/native-process-owner-remote-build-'+operation+'-remote.py',expectedController='0127b66eeffd587ae8ae42465d27cffabccbb94619f85b77bdfec92d4ec84197';
const source=path.join(repository,'deploy/scripts/native-process-owner.c'),receipt=path.join(repository,'reports/qa/native-process-owner-remote-build-'+operation+'.json');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const raw=fs.readFileSync(receipt),receiptSha256=sha(raw),outer=JSON.parse(raw);assert.equal(outer.sshExitCode,0);assert.equal(outer.remoteEnvelopeSha256,expectedController);assert.equal(sha(fs.readFileSync(controller)),expectedController);
const built=JSON.parse(outer.stdout);assert.equal(built.format,'sabalan-original-remote-native-owner-build/v1');assert.equal(built.operation,operation);assert.equal(built.passResult,true);assert.equal(built.allForeignIdentitiesUnchanged,true);assert.deepEqual(built.foreignBefore,built.foreignAfter);assert.equal(built.allOriginalChildrenClosed,true);assert.equal(built.sourceSha256,sha(fs.readFileSync(source)));
assert.ok(built.command.includes('-static'));assert.equal(built.command[0],built.compiler.path);assert.ok(built.originalCommands.some(row=>row.originalPid===built.originalCompilePid&&row.returncode===0&&!row.outputBoundExceeded));for(const row of built.originalCommands){assert.equal(row.returncode,0);assert.equal(row.outputBoundExceeded,false);}
const elf=Buffer.from(built.elfBase64,'base64');assert.equal(elf.toString('base64'),built.elfBase64);assert.equal(elf.length,built.elfBytes);assert.ok(elf.length<=8*1024*1024);assert.equal(sha(elf),built.elfSha256);assert.deepEqual([...elf.subarray(0,7)],[127,69,76,70,2,1,1]);assert.equal(elf.readUInt16LE(18),62);
const phoff=Number(elf.readBigUInt64LE(32)),phsize=elf.readUInt16LE(54),phcount=elf.readUInt16LE(56);assert.ok(phsize>=56&&phcount<=128&&phoff+phsize*phcount<=elf.length);for(let i=0;i<phcount;i++)assert.notEqual(elf.readUInt32LE(phoff+i*phsize),3,'STATIC_ELF_MUST_NOT_HAVE_INTERPRETER');
const nonce=randomBytes(16).toString('hex'),scratch=path.join('D:/sabalanerp-online-qa','native-process-owner-qualified-'+nonce);fs.mkdirSync(scratch,{mode:0o700});const elfFile=path.join(scratch,'native-process-owner');const fd=fs.openSync(elfFile,'wx',0o600);try{fs.writeFileSync(fd,elf);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.equal(sha(fs.readFileSync(elfFile)),built.elfSha256);
const owner=originalBackendBaseCommands(),commands=[],names=['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained','frontend-candidate','frontend-retained'].sort();
const parse=raw=>{try{const v=JSON.parse(raw);return Array.isArray(v)?v:[v];}catch{return raw.trim().split(/\r?\n/).map(JSON.parse);}};
const template='{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}},"health":{{if (index .State "Health")}}{{json .State.Health.Status}}{{else}}null{{end}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"project":{{json (index .Config.Labels "com.docker.compose.project")}}}';
async function run(args){const result=await owner.run('docker',args,{maximum:1024*1024});commands.push({args,...result});owner.assertSuccessful(result);return result.stdout;}
async function inspect(){const rows=parse(await run(['compose','-f',base,'ps','--all','--format','json']));assert.equal(rows.length,10);assert.deepEqual(rows.map(row=>row.Service).sort(),names);for(const row of rows)assert.equal(row.Project,'sabalanerp-local');const values=parse(await run(['inspect','--format',template,...rows.map(row=>row.ID??row.Name)]));assert.equal(values.length,10);for(const row of values){assert.equal(row.project,'sabalanerp-local');assert.equal(row.running,true);assert.equal(row.health,'healthy');}return values.sort((a,b)=>a.service.localeCompare(b.service));}
const report={format:'sabalan-native-process-owner-qualified-elf/v1',pass:false,productionAdmission:false,elfFile,elfSha256:built.elfSha256,elfBytes:elf.length,sourceFile:source,sourceSha256:built.sourceSha256,remoteReceiptFile:receipt,remoteReceiptSha256:receiptSha256,remoteEnvelopeSha256:expectedController,staticElf:true,elfClass:64,machine:'x86_64',commands};
let failure;let before;
try{
 before=await inspect();report.before=before;const candidate=before.find(row=>row.service==='backend-candidate');
 async function docker(args){assert.deepEqual(await inspect(),before);return run(args);}
 const remote='/app/online-runtime-acceptance/native-owner-qualified-'+nonce;await docker(['exec',candidate.id,'python3','-I','-B','-c','import os,sys;os.mkdir(sys.argv[1],0o700)',remote]);await docker(['cp',elfFile,candidate.id+':'+remote+'/native-process-owner']);
 const script=`import os,sys,hashlib,subprocess,json
file,expected=sys.argv[1:];assert hashlib.sha256(open(file,'rb').read()).hexdigest()==expected;os.chmod(file,0o500)
f=os.open(file,os.O_RDONLY);os.fsync(f);os.close(f)
child=subprocess.Popen([file,'5','qualification-native-owner','/bin/true'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE);out,err=child.communicate()
assert child.returncode==0 and out==b'' and err==b'\\nSABALAN_NATIVE_REAPED qualification-native-owner 0\\n'
assert hashlib.sha256(open(file,'rb').read()).hexdigest()==expected
print(json.dumps(dict(originalPid=child.pid,returncode=child.returncode,stdoutSha256=hashlib.sha256(out).hexdigest(),stderrSha256=hashlib.sha256(err).hexdigest(),stderr=err.decode(),originalChildClosed=True)))`;
 report.probe=JSON.parse(await docker(['exec',candidate.id,'python3','-I','-B','-c',script,remote+'/native-process-owner',built.elfSha256]));report.runtimeFile=remote+'/native-process-owner';report.pass=true;
}catch(error){failure=error;report.failure={name:error.name,message:error.message};}
finally{try{report.after=await inspect();assert.deepEqual(report.after,before);assert.equal(sha(fs.readFileSync(source)),built.sourceSha256);assert.equal(sha(fs.readFileSync(receipt)),receiptSha256);}catch(error){failure??=error;report.finalFailure=error.message;}report.originalClosure=await owner.close();report.pass=report.pass&&!failure;fs.writeFileSync(path.join(scratch,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
process.stdout.write(JSON.stringify({pass:report.pass,elfFile,elfSha256:built.elfSha256,reportFile:path.join(scratch,'receipt.json'),originalClosure:report.originalClosure})+'\n');if(!report.pass)process.exitCode=1;
