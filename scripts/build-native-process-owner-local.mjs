/** Compile only in an existing local backend slot; never a builder container. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {originalBackendBaseCommands} from './lib/production-backend-base-process.mjs';
const repository=path.resolve(import.meta.dirname,'..'),base='D:/sabalanerp/docker-compose.local.yml';
const source=path.join(repository,'deploy/scripts/native-process-owner.c');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const parse=raw=>{try{const value=JSON.parse(raw);return Array.isArray(value)?value:[value];}catch{return raw.trim().split(/\r?\n/).map(JSON.parse);}};
const names=['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained','frontend-candidate','frontend-retained'].sort();
const format='{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}},"health":{{if (index .State "Health")}}{{json .State.Health.Status}}{{else}}null{{end}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"project":{{json (index .Config.Labels "com.docker.compose.project")}}}';
export async function buildOriginalNativeProcessOwnerElf(){
 assert.equal(process.platform,'win32');const owner=originalBackendBaseCommands(),operation=randomBytes(16).toString('hex');
 const scratch=path.join('D:/sabalanerp-online-qa','native-process-owner-elf-'+operation);fs.mkdirSync(scratch,{mode:0o700});
 const raw=fs.readFileSync(source),sourceSha256=sha(raw),remote='/app/online-runtime-acceptance/native-process-owner-elf-'+operation;
 const report={format:'sabalan-native-process-owner-elf/v1',operation,sourceFile:source,sourceSha256,pass:false,productionAdmission:false,commands:[]};
 async function run(args){const result=await owner.run('docker',args,{maximum:1024*1024});report.commands.push({...result,args});owner.assertSuccessful(result);return result.stdout;}
 async function inspect(){const rows=parse(await run(['compose','-f',base,'ps','--all','--format','json']));assert.equal(rows.length,10);assert.deepEqual(rows.map(row=>row.Service).sort(),names);for(const row of rows)assert.equal(row.Project,'sabalanerp-local');const values=parse(await run(['inspect','--format',format,...rows.map(row=>row.ID??row.Name)]));assert.equal(values.length,10);for(const row of values){assert.equal(row.project,'sabalanerp-local');assert.equal(row.running,true);assert.equal(row.health,'healthy');}return values.sort((a,b)=>a.service.localeCompare(b.service));}
 const initial=await inspect(),candidate=initial.find(row=>row.service==='backend-candidate');report.initial=initial;
 async function docker(args){assert.deepEqual(await inspect(),initial);return run(args);}
 let failure;
 try{
  const probe=JSON.parse(await docker(['exec',candidate.id,'python3','-I','-B','-c','import shutil,json;print(json.dumps(dict(cc=shutil.which("cc"),gcc=shutil.which("gcc"),clang=shutil.which("clang"))))']));report.compilerProbe=probe;
  const compiler=probe.cc??probe.gcc??probe.clang;assert.ok(compiler&&compiler.startsWith('/'),'EXISTING_CANDIDATE_C_COMPILER_UNAVAILABLE');
  await docker(['exec',candidate.id,'python3','-I','-B','-c','import os,sys;os.mkdir(sys.argv[1],0o700)',remote]);
  const copied=path.join(scratch,'native-process-owner.c');fs.writeFileSync(copied,raw,{flag:'wx',mode:0o600});await docker(['cp',copied,candidate.id+':'+remote+'/native-process-owner.c']);
  const script=`import os,sys,hashlib,subprocess,json,struct
root,cc,expected=sys.argv[1:]; source=root+'/native-process-owner.c'; binary=root+'/native-process-owner'
assert hashlib.sha256(open(source,'rb').read()).hexdigest()==expected
assert os.path.realpath(cc)==cc or os.path.isfile(os.path.realpath(cc))
ccraw=open(os.path.realpath(cc),'rb').read(); version=subprocess.run([cc,'--version'],capture_output=True,check=True).stdout.decode()
command=[cc,'-std=c11','-O2','-Wall','-Wextra','-Werror','-Wl,-z,relro,-z,now',source,'-o',binary]
child=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE); out,err=child.communicate(); assert len(out)+len(err)<=1048576 and child.returncode==0,(out,err)
os.chmod(binary,0o500); f=os.open(binary,os.O_RDONLY);os.fsync(f);os.close(f); data=open(binary,'rb').read()
assert data[:7]==bytes([127,69,76,70,2,1,1]) and struct.unpack('<H',data[18:20])[0]==62
probe=subprocess.Popen([binary,'5','qualification-native-owner','/bin/true'],stdout=subprocess.PIPE,stderr=subprocess.PIPE); pout,perr=probe.communicate()
assert probe.returncode==0 and pout==b'' and perr==b'\\nSABALAN_NATIVE_REAPED qualification-native-owner 0\\n'
assert hashlib.sha256(open(source,'rb').read()).hexdigest()==expected
print(json.dumps(dict(compiler=cc,compilerRealpath=os.path.realpath(cc),compilerSha256=hashlib.sha256(ccraw).hexdigest(),compilerVersion=version,command=command,originalCompilerPid=child.pid,compilerReturncode=child.returncode,originalProbePid=probe.pid,probeReturncode=probe.returncode,probeStderr=perr.decode(),elfBytes=len(data),elfSha256=hashlib.sha256(data).hexdigest(),elfClass=64,machine='x86_64')))
`;
  report.compilation=JSON.parse(await docker(['exec',candidate.id,'python3','-I','-B','-c',script,remote,compiler,sourceSha256]));
  const elfFile=path.join(scratch,'native-process-owner');await docker(['cp',candidate.id+':'+remote+'/native-process-owner',elfFile]);const elf=fs.readFileSync(elfFile);assert.equal(sha(elf),report.compilation.elfSha256);assert.equal(elf.length,report.compilation.elfBytes);assert.equal(sha(fs.readFileSync(source)),sourceSha256);report.elfFile=elfFile;report.pass=true;
 }catch(error){failure=error;report.failure={name:error.name,code:error.code??null,message:error.message};}
 finally{try{report.final=await inspect();assert.deepEqual(report.final,initial);assert.equal(sha(fs.readFileSync(source)),sourceSha256);}catch(error){failure??=error;report.pass=false;report.finalFailure=error.message;}report.originalClosure=await owner.close();report.pass=report.pass&&!failure;fs.writeFileSync(path.join(scratch,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
 return {report,reportFile:path.join(scratch,'receipt.json')};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.deepEqual(process.argv.slice(2),['--build']);const result=await buildOriginalNativeProcessOwnerElf();process.stdout.write(JSON.stringify({reportFile:result.reportFile,pass:result.report.pass,compilerProbe:result.report.compilerProbe,elfFile:result.report.elfFile,originalClosure:result.report.originalClosure})+'\n');if(!result.report.pass)process.exitCode=1;}
