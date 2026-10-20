import {snapshotArguments} from './lib/production-inquiry-snapshot.mjs';
import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{randomBytes,createHash}from'node:crypto';import{originalBackendBaseCommands}from'./lib/production-backend-base-process.mjs';
const root=path.resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2);assert.equal(args[0],'--preflight');const preflightFile=fs.realpathSync(args[1]);const snapshot=snapshotArguments(args,2);
const rawPreflight=fs.readFileSync(preflightFile),preflight=JSON.parse(rawPreflight);assert.equal(preflight.sshExitCode,0);const both=JSON.parse(preflight.stdout);assert.equal(both.exitCode,0);assert.equal(both.lockHeldThroughBothHostPreflight,true);assert.equal(both.productionCommitBefore,both.productionCommitAfter);const age=Date.now()-Date.parse(preflight.observedAt);assert.ok(age>=0&&age<=600000,'FRESH_BOTH_HOST_PREFLIGHT_REQUIRED');
const operation='actual-inquiry-image-export-'+randomBytes(16).toString('hex'),directory=path.join('D:/sabalanerp-online-qa',operation);fs.mkdirSync(directory,{mode:0o700});const remote='/root/'+operation;
const source=String.raw`import os,sys,json,subprocess,selectors,hashlib,signal,base64
BASELINE=json.loads(base64.b64decode('__BASELINE__'));ROOT='__ROOT__';IMAGE=BASELINE['services']['inquiry']['image']if BASELINE else 'sha256:ab6e2933e2d0d397f0b1a514dba69206e21856fa7d4275ab33383020bf9dd66e';children=[];history=[];interrupted=False
os.umask(0o077)
def interrupted_handler(*_):
 global interrupted
 interrupted=True
for signal_number in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):signal.signal(signal_number,interrupted_handler)
def run(argv):
 c=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE);children.append(c);selector=selectors.DefaultSelector();buffers={c.stdout:bytearray(),c.stderr:bytearray()};overflow=False
 for stream in buffers:selector.register(stream,selectors.EVENT_READ)
 while selector.get_map():
  for key,_ in selector.select(.2):
   value=os.read(key.fd,65536)
   if not value:selector.unregister(key.fileobj);continue
   if len(buffers[key.fileobj])+len(value)<=1048576:buffers[key.fileobj].extend(value)
   else:overflow=True
 c.wait();selector.close();out=bytes(buffers[c.stdout]);err=bytes(buffers[c.stderr]);history.append(dict(argv=argv,originalPid=c.pid,returncode=c.returncode,stdoutSha256=hashlib.sha256(out).hexdigest(),stderrSha256=hashlib.sha256(err).hexdigest()));assert c.returncode==0 and not overflow and not interrupted,(c.returncode,err[:512]);return out
def ps():
 raw=run(['docker','compose','-f','/opt/sabalanerp/docker-compose.prod.yml','ps','--format','json']);v=json.loads(raw)if raw.lstrip().startswith(b'[')else[json.loads(x)for x in raw.splitlines()if x];assert len(v)==6 and len(set(x['Service']for x in v))==6 and all(x['Project']=='sabalanerp'and x['State']=='running'and x['Health']=='healthy'for x in v);return v
def inspect():
 rows=ps();template='{"id":{{json .Id}},"image":{{json .Image}},"birth":{{json .State.StartedAt}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}'
 return sorted([json.loads(x)for x in run(['docker','inspect','--format',template,*[x['Name']for x in rows]]).splitlines()],key=lambda x:x['service'])
def pin(file):
 before=os.stat(file);identity=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink,s.st_uid);h=hashlib.sha256()
 with open(file,'rb')as stream:
  while True:
   block=stream.read(262144)
   if not block:break
   h.update(block)
  assert identity(os.fstat(stream.fileno()))==identity(before)
 assert identity(os.stat(file))==identity(before)
 return dict(path=file,bytes=before.st_size,sha256=h.hexdigest(),device=str(before.st_dev),inode=str(before.st_ino))
r=dict(format='sabalan-actual-production-inquiry-image-export/v1',passResult=False,productionAdmission=False)
try:
 before=inspect();target=next(x for x in before if x['service']=='inquiry');assert target['image']==IMAGE
 if BASELINE:
  assert run(['git','-C','/opt/sabalanerp','rev-parse','HEAD']).decode().strip()==BASELINE['deployedHead']
  for row in before:
   expected=BASELINE['services'][row['service']];assert(row['id'],row['image'],row['birth'])==(expected['id'],expected['image'],expected['startedAt'])
 os.mkdir(ROOT,0o700);raw=ROOT+'/inquiry.docker.tar';compressed=raw+'.gz'
 ps();image=json.loads(run(['docker','image','inspect','--format','{"id":{{json .Id}},"rootfs":{{json .RootFS.Layers}}}',IMAGE]));assert image['id']==IMAGE
 ps();run(['docker','image','save','--output',raw,IMAGE]);os.chmod(raw,0o400)
 with open(raw,'rb')as f:os.fsync(f.fileno())
 raw_pin=pin(raw);run(['gzip','-1','-k',raw]);os.chmod(compressed,0o400)
 with open(compressed,'rb')as f:os.fsync(f.fileno())
 compressed_pin=pin(compressed);after=inspect();assert before==after
 if BASELINE:assert run(['git','-C','/opt/sabalanerp','rev-parse','HEAD']).decode().strip()==BASELINE['deployedHead']
 r.update(passResult=True,before=before,after=after,image=image,sourceImage=IMAGE,rawArchive=raw_pin,compressedArchive=compressed_pin,allSixIdentitiesUnchanged=True)
except BaseException as error:r['error']=type(error).__name__+': '+str(error)
finally:
 for c in children:c.wait()
 r.update(originalCommands=history,allOriginalChildrenClosed=all(c.poll()is not None for c in children))
print(json.dumps(r));sys.exit(0 if r['passResult']else 1)
`.replace('__ROOT__',remote).replace('__BASELINE__',Buffer.from(JSON.stringify(snapshot)).toString('base64'));
const sourceFile=path.join(directory,'remote.py');fs.writeFileSync(sourceFile,source,{flag:'wx'});const owner=originalBackendBaseCommands();let report={format:'sabalan-actual-inquiry-image-export-ssh/v1',operation,directory,snapshotBaseline:snapshot,sourceFile,sourceSha256:sha(Buffer.from(source)),preflightFile,preflightSha256:sha(rawPreflight),passResult:false};
try{assert.ok(Date.now()-Date.parse(preflight.observedAt)<=600000);const child=await owner.run('ssh',['-i','C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','root@94.182.85.254','python3 -I -B -'],{input:source,maximum:2*1024**2});report.originalSsh=child;owner.assertSuccessful(child);const result=JSON.parse(child.stdout);report.remote=result;assert.equal(result.passResult,true);assert.equal(result.allSixIdentitiesUnchanged,true);const output=path.join(directory,'inquiry.docker.tar.gz');assert.equal(fs.existsSync(output),false);report.originalTransfer=await owner.run('scp',['-i','C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','root@94.182.85.254:'+result.compressedArchive.path,output]);owner.assertSuccessful(report.originalTransfer);const h=createHash('sha256');let bytes=0;for await(const block of fs.createReadStream(output)){bytes+=block.length;h.update(block);}assert.equal(bytes,result.compressedArchive.bytes);assert.equal(h.digest('hex'),result.compressedArchive.sha256);report.localArchive={path:output,bytes,sha256:result.compressedArchive.sha256};report.passResult=true;}catch(error){report.error=String(error.message).slice(0,512);}finally{report.originalClosure=await owner.close();const file=path.join(root,'reports/qa',operation+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({reportFile:file,passResult:report.passResult,archive:report.localArchive,allOriginalChildrenClosed:report.originalClosure.allOriginalChildrenClosed,error:report.error}));if(!report.passResult)process.exitCode=1;}
